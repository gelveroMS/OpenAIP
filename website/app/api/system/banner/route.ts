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
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const messagePreview =
      error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
    console.error("[SYSTEM_BANNER][READ_FAILED]", {
      route: "/api/system/banner",
      errorName,
      messagePreview,
    });
    return NextResponse.json({ message: "Unable to load system banner." }, { status: 500 });
  }
}

