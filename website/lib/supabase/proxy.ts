import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { RoleType } from "@/lib/contracts/databasev2";
import { isMockModeEnabled } from "@/lib/auth/dev-bypass";
import { dbRoleToRouteRole, type RouteRole } from "@/lib/auth/route-roles";
import {
  parseNumericCookie,
  SESSION_LAST_ACTIVITY_COOKIE,
  SESSION_TIMEOUT_COOKIE,
  SESSION_WARNING_COOKIE,
} from "@/lib/security/session-timeout";

type UpdateSessionOptions = {
  extraHeaders?: Headers;
};

function isRoleType(value: unknown): value is RoleType {
  return (
    value === "citizen" ||
    value === "barangay_official" ||
    value === "city_official" ||
    value === "municipal_official" ||
    value === "admin"
  );
}

export function toRouteRole(role: RoleType): RouteRole {
  const mapped = dbRoleToRouteRole(role);
  return mapped ?? "citizen";
}

function clearPolicyCookies(response: NextResponse) {
  const options = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  };
  response.cookies.set(SESSION_TIMEOUT_COOKIE, "", options);
  response.cookies.set(SESSION_WARNING_COOKIE, "", options);
  response.cookies.set(SESSION_LAST_ACTIVITY_COOKIE, "", options);
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function buildForwardedHeaders(request: NextRequest, extraHeaders?: Headers): Headers {
  const headers = new Headers(request.headers);
  if (extraHeaders) {
    extraHeaders.forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function nextPassThroughResponse(request: NextRequest, extraHeaders?: Headers) {
  return NextResponse.next({
    request: {
      headers: buildForwardedHeaders(request, extraHeaders),
    },
  });
}

export async function updateSession(request: NextRequest, options?: UpdateSessionOptions) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableOrAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableOrAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  let supabaseResponse = nextPassThroughResponse(request, options?.extraHeaders);

  const supabase = createServerClient(url, publishableOrAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = nextPassThroughResponse(request, options?.extraHeaders);
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  let userId = authError ? null : authData.user?.id ?? null;
  let userRole: RouteRole | null = null;
  let sessionExpired = false;

  const pathname = request.nextUrl.pathname;
  const pathArray =
    pathname.includes("/") && pathname.trim() !== "/" ? pathname.split("/") : [];

  const pathRole =
    pathArray.indexOf("barangay") > 0
      ? "barangay"
      : pathArray.indexOf("municipality") > 0
        ? "municipality"
        : pathArray.indexOf("city") > 0
          ? "city"
          : pathArray.indexOf("admin") > 0
            ? "admin"
            : "citizen";

  if (userId) {
    const timeoutMs = parseNumericCookie(request.cookies.get(SESSION_TIMEOUT_COOKIE)?.value);
    const lastActivityAtMs = parseNumericCookie(
      request.cookies.get(SESSION_LAST_ACTIVITY_COOKIE)?.value
    );
    if (timeoutMs && lastActivityAtMs) {
      const elapsed = Date.now() - lastActivityAtMs;
      if (elapsed > timeoutMs) {
        sessionExpired = true;
        userId = null;
        await supabase.auth.signOut().catch(() => undefined);
      }
    }
  }

  if (sessionExpired && isApiRoute(pathname)) {
    const response = NextResponse.json(
      { message: "Session expired due to inactivity." },
      { status: 401 }
    );
    clearPolicyCookies(response);
    return response;
  }

  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (isRoleType(profile?.role)) {
      userRole = toRouteRole(profile.role);
    }
  }

  const isPublicAuthRoute =
    request.nextUrl.pathname.endsWith("/sign-in") ||
    request.nextUrl.pathname.endsWith("/sign-up") ||
    request.nextUrl.pathname.endsWith("/forgot-password") ||
    request.nextUrl.pathname.endsWith("/update-password") ||
    request.nextUrl.pathname.endsWith("/confirm");

  const isCitizenProtectedRoute =
    pathRole === "citizen" && (pathname === "/account" || pathname.startsWith("/account/"));

  const requiresAuth = pathRole !== "citizen" || isCitizenProtectedRoute;
  const isCitizenPublicRoute =
    pathRole === "citizen" && !isCitizenProtectedRoute && !isPublicAuthRoute;

  const isMockBypassForCitizen = isMockModeEnabled() && pathRole === "citizen";

  if (!userId && !isPublicAuthRoute && requiresAuth && !isMockBypassForCitizen) {
    const url = request.nextUrl.clone();
    url.pathname = `${pathRole === "citizen" ? "" : `/${pathRole}`}/sign-in`;
    const response = NextResponse.redirect(url);
    if (sessionExpired) clearPolicyCookies(response);
    return response;
  }

  if (userId && !userRole && pathRole !== "citizen") {
    const unauthorizedPath = `/${pathRole}/unauthorized`;
    if (pathname !== unauthorizedPath) {
      const url = request.nextUrl.clone();
      url.pathname = unauthorizedPath;
      return NextResponse.redirect(url);
    }
  }

  if (userId && userRole && pathRole !== userRole && !isCitizenPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = `${userRole === "citizen" ? "" : `/${userRole}`}/unauthorized`;
    return NextResponse.redirect(url);
  }

  if (
    userId &&
    (request.nextUrl.pathname.endsWith("/sign-in") ||
      request.nextUrl.pathname.endsWith("/sign-up") ||
      request.nextUrl.pathname.endsWith("/forgot-password"))
  ) {
    const signedInRole = userRole ?? "citizen";
    const url = request.nextUrl.clone();
    url.pathname = `${signedInRole === "citizen" ? "" : `/${signedInRole}`}/`;
    return NextResponse.redirect(url);
  }

  if (sessionExpired) {
    clearPolicyCookies(supabaseResponse);
  }

  return supabaseResponse;
}
