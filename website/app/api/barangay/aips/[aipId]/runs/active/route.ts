import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ aipId: string }> }
) {
  try {
    const { aipId } = await context.params;
    const client = await supabaseServer();

    const { data: latestRun, error } = await client
      .from("extraction_runs")
      .select("id,aip_id,stage,status,error_message,created_at")
      .eq("aip_id", aipId)
      .in("stage", ["extract", "validate", "scale_amounts", "summarize", "categorize", "embed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    if (!latestRun) {
      return NextResponse.json({ run: null, failedRun: null }, { status: 200 });
    }

    if (latestRun.status === "queued" || latestRun.status === "running") {
      return NextResponse.json(
        {
          run: {
            runId: latestRun.id,
            aipId: latestRun.aip_id,
            stage: latestRun.stage,
            status: latestRun.status,
            errorMessage: latestRun.error_message,
            createdAt: latestRun.created_at,
          },
          failedRun: null,
        },
        { status: 200 }
      );
    }

    if (latestRun.status === "failed") {
      return NextResponse.json(
        {
          run: null,
          failedRun: {
            runId: latestRun.id,
            aipId: latestRun.aip_id,
            stage: latestRun.stage,
            status: latestRun.status,
            errorMessage: latestRun.error_message,
            createdAt: latestRun.created_at,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        run: null,
        failedRun: null,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected active run lookup error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
