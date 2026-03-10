import { processScopedAipUpload } from "@/lib/upload-gating/server-upload";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    return await processScopedAipUpload(request, { scope: "city" });
  } catch (error) {
    console.error("[CITY_AIP_UPLOAD_ROUTE][UNHANDLED]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      },
      { status: 500 }
    );
  }
}
