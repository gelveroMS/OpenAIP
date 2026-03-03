const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type CsrfGuardOptions = {
  requireToken?: boolean;
  allowedOrigins?: Iterable<string>;
  cookieName?: string;
  headerName?: string;
};

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeOriginFromReferer(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function parseCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const needle = `${name}=`;
  const entries = cookieHeader.split(";");
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(needle)) continue;
    const value = trimmed.slice(needle.length);
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

function makeRandomToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replace(/-/g, "");

  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function collectConfiguredOrigins(): string[] {
  const origins = new Set<string>();
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_STAGING_URL,
    process.env.BASE_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) {
      origins.add(normalized);
    }
  }

  if (process.env.NODE_ENV !== "production" || process.env.VITEST) {
    origins.add("http://localhost");
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1");
    origins.add("http://127.0.0.1:3000");
    origins.add("https://localhost");
    origins.add("https://localhost:3000");
    origins.add("https://127.0.0.1");
    origins.add("https://127.0.0.1:3000");
  }

  return Array.from(origins);
}

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

export function getAllowedCsrfOrigins(): string[] {
  return collectConfiguredOrigins();
}

export function getCsrfCookieToken(request: Request, cookieName = CSRF_COOKIE_NAME): string | null {
  return parseCookieValue(request.headers.get("cookie"), cookieName);
}

export function csrfForbiddenResponse(): Response {
  return Response.json({ message: "Forbidden." }, { status: 403 });
}

export function validateRequestOrigin(
  request: Request,
  allowedOrigins: Iterable<string> = getAllowedCsrfOrigins()
): boolean {
  const allowlist = new Set(Array.from(allowedOrigins));
  if (allowlist.size === 0) return false;

  const rawOrigin = request.headers.get("origin");
  if (rawOrigin !== null) {
    const normalizedOrigin = normalizeOrigin(rawOrigin);
    if (!normalizedOrigin) return false;
    return allowlist.has(normalizedOrigin);
  }

  const normalizedRefererOrigin = normalizeOriginFromReferer(request.headers.get("referer"));
  if (!normalizedRefererOrigin) return false;
  return allowlist.has(normalizedRefererOrigin);
}

export function enforceCsrfProtection(
  request: Request,
  options: CsrfGuardOptions = {}
): { ok: true } | { ok: false; response: Response } {
  if (!isStateChangingMethod(request.method)) {
    return { ok: true };
  }

  const allowedOrigins = options.allowedOrigins ?? getAllowedCsrfOrigins();
  if (!validateRequestOrigin(request, allowedOrigins)) {
    return { ok: false, response: csrfForbiddenResponse() };
  }

  if (options.requireToken) {
    const cookieName = options.cookieName ?? CSRF_COOKIE_NAME;
    const headerName = (options.headerName ?? CSRF_HEADER_NAME).toLowerCase();
    const cookieToken = getCsrfCookieToken(request, cookieName);
    const headerToken = request.headers.get(headerName);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return { ok: false, response: csrfForbiddenResponse() };
    }
  }

  return { ok: true };
}

function readBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const entries = document.cookie.split(";");
  const needle = `${name}=`;
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(needle)) continue;
    const value = trimmed.slice(needle.length);
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

export function ensureBrowserCsrfToken(cookieName = CSRF_COOKIE_NAME): string {
  if (typeof document === "undefined") {
    throw new Error("ensureBrowserCsrfToken can only be used in a browser context.");
  }

  const existing = readBrowserCookie(cookieName);
  if (existing) return existing;

  const token = makeRandomToken();
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const cookieParts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (secure) {
    cookieParts.push("Secure");
  }
  document.cookie = cookieParts.join("; ");
  return token;
}

export function withCsrfHeader(init: RequestInit = {}, token?: string): RequestInit {
  const csrfToken = token ?? ensureBrowserCsrfToken();
  const headers = new Headers(init.headers ?? {});
  headers.set(CSRF_HEADER_NAME, csrfToken);
  return {
    ...init,
    headers,
  };
}
