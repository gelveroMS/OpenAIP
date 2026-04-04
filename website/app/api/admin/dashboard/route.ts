import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import {
  createDefaultAdminDashboardFilters,
  loadAdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/snapshot.server";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

export async function GET(_request: Request) {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") return unauthorized();

  try {
    const filters = createDefaultAdminDashboardFilters();
    const snapshot = await loadAdminDashboardSnapshot(filters);
    return NextResponse.json(snapshot, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load admin dashboard data.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
