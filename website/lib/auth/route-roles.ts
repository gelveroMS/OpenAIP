export type RouteRole = "citizen" | "barangay" | "city" | "municipality" | "admin";

export function isRouteRole(value: unknown): value is RouteRole {
  return (
    value === "citizen" ||
    value === "barangay" ||
    value === "city" ||
    value === "municipality" ||
    value === "admin"
  );
}

export function dbRoleToRouteRole(value: unknown): RouteRole | null {
  if (value === "citizen") return "citizen";
  if (value === "barangay_official") return "barangay";
  if (value === "city_official") return "city";
  if (value === "municipal_official") return "municipality";
  if (value === "admin") return "admin";
  return null;
}

