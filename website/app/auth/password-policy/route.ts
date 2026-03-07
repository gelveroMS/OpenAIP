import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const settings = await getSecuritySettings();
    return NextResponse.json(
      {
        ok: true,
        passwordPolicy: settings.passwordPolicy,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load password policy.";
    return NextResponse.json(
      {
        ok: false,
        error: { message },
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }
}
