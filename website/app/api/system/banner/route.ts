import { NextResponse } from "next/server";
import { getActiveSystemBanner } from "@/lib/system-banner/system-banner.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const banner = await getActiveSystemBanner();
    return NextResponse.json(
      { banner },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load system banner.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

