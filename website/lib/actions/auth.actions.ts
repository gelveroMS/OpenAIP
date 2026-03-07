import { supabaseServer } from "../supabase/server";
import type { RoleType } from "@/lib/contracts/databasev2";
import { cache } from "react";

type RouteRole = "citizen" | "barangay" | "city" | "municipality" | "admin";

export type GetUserResult = {
  userId: string;
  id: string;
  fullName: string;
  email: string;
  role: RoleType;
  routeRole: RouteRole;
  officeLabel: string;
  scopeName: string | null;
  barangayId: string | null;
  cityId: string | null;
  municipalityId: string | null;
  isActive: boolean;
  // Compatibility aliases for existing call sites.
  userRole: RouteRole;
  userLocale: string;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  baseURL: string;
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

function toRouteRole(role: RoleType): RouteRole {
  if (role === "barangay_official") return "barangay";
  if (role === "city_official") return "city";
  if (role === "municipal_official") return "municipality";
  return role;
}

function toOfficeLabel(role: RoleType): string {
  if (role === "city_official") return "City Hall";
  if (role === "municipal_official") return "Municipal Hall";
  if (role === "barangay_official" || role === "citizen") return "Barangay Hall";
  return "System Administration";
}

function toScopeRelationName(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("name" in value)) return null;
  const name = (value as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveBaseUrlFromHeaderValues(input: {
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
}): string {
  const configuredBaseUrl = process.env.BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const forwardedHost = input.forwardedHost?.split(",")[0]?.trim() ?? "";
  if (forwardedHost.length > 0) {
    const forwardedProto = input.forwardedProto?.split(",")[0]?.trim() ?? "";
    const protocol = forwardedProto.length > 0 ? forwardedProto : "https";
    return `${protocol}://${forwardedHost}`;
  }

  const host = input.host?.split(",")[0]?.trim() ?? "";
  if (host.length > 0) {
    return `http://${host}`;
  }

  return "http://localhost:3000";
}

export const getUser = cache(async (): Promise<GetUserResult> => {

  const baseURL = process.env.BASE_URL;

  if (!baseURL) {
    throw new Error('BASE_URL environment variable is not set');
  }

  const supabase = await supabaseServer();

  const { data: authData, error: authError } = await supabase.auth.getUser();

  const authUser = authData.user;
  if(authError || !authUser?.id) {
    throw new Error(
      authError?.message ||
      'Failed to fetch user info.'
    )
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,role,full_name,email,barangay_id,city_id,municipality_id,is_active,barangay:barangays!profiles_barangay_id_fkey(name),city:cities!profiles_city_id_fkey(name),municipality:municipalities!profiles_municipality_id_fkey(name)"
    )
    .eq("id", authUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error(
      profileError?.message || "Failed to fetch profile info."
    );
  }

  if (!isRoleType(profile.role)) {
    throw new Error("Invalid profile role.");
  }

  if (!profile.is_active) {
    throw new Error("Inactive user profile.");
  }

  const role = profile.role;
  const userId = profile.id;
  const routeRole = toRouteRole(role);
  const officeLabel = toOfficeLabel(role);
  const fullName = profile.full_name ?? authUser.email ?? "";
  const email = profile.email ?? authUser.email ?? "";
  const barangayName = toScopeRelationName(profile.barangay);
  const cityName = toScopeRelationName(profile.city);
  const municipalityName = toScopeRelationName(profile.municipality);
  const scopeName =
    role === "city_official"
      ? cityName
      : role === "municipal_official"
        ? municipalityName
        : role === "barangay_official" || role === "citizen"
          ? barangayName
          : null;

  return {
    userId,
    id: userId,
    fullName,
    email,
    role,
    routeRole,
    officeLabel,
    scopeName,
    barangayId: profile.barangay_id,
    cityId: profile.city_id,
    municipalityId: profile.municipality_id,
    isActive: profile.is_active,
    userRole: routeRole,
    userLocale: officeLabel,
    barangay_id: profile.barangay_id,
    city_id: profile.city_id,
    municipality_id: profile.municipality_id,
    baseURL
  };
});
