import { NextResponse } from "next/server";
import {
  insertExtractionRun,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { deriveRetryResumeStage } from "@/features/aip/server/retry-resume-stage";

type RetryMode = "scratch" | "failed_stage";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const csrf = enforceCsrfProtection(request, { requireToken: true });
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    if (!actor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { runId } = await context.params;
    const client = await supabaseServer();

    const { data: run, error: runError } = await client
      .from("extraction_runs")
      .select("id,aip_id,uploaded_file_id,stage,status")
      .eq("id", runId)
      .maybeSingle();

    if (runError) {
      return NextResponse.json({ message: runError.message }, { status: 400 });
    }
    if (!run) {
      return NextResponse.json({ message: "Run not found." }, { status: 404 });
    }
    if (run.status !== "failed") {
      return NextResponse.json({ message: "Only failed runs can be retried." }, { status: 409 });
    }

    const { data: canEdit, error: canEditError } = await client.rpc("can_edit_aip", {
      p_aip_id: run.aip_id,
    });
    if (canEditError) {
      return NextResponse.json({ message: canEditError.message }, { status: 400 });
    }
    if (!canEdit) {
      return NextResponse.json({ message: "You cannot retry this run." }, { status: 403 });
    }

    let retryMode: RetryMode = "failed_stage";
    try {
      const rawBody = await request.text();
      if (rawBody.trim().length > 0) {
        const parsed = JSON.parse(rawBody) as { retryMode?: unknown };
        if (typeof parsed.retryMode !== "undefined") {
          if (
            parsed.retryMode !== "scratch" &&
            parsed.retryMode !== "failed_stage" &&
            parsed.retryMode !== "latest_success"
          ) {
            return NextResponse.json(
              {
                message:
                  "Invalid retry mode. Use 'scratch' or 'failed_stage'.",
              },
              { status: 400 }
            );
          }
          retryMode =
            parsed.retryMode === "latest_success" ? "failed_stage" : parsed.retryMode;
        }
      }
    } catch {
      return NextResponse.json({ message: "Invalid retry request body." }, { status: 400 });
    }

    let newRun: { id: string; status: string };
    const resumeFromStage =
      retryMode === "scratch" ? "extract" : deriveRetryResumeStage(run.stage);
    try {
      newRun = await insertExtractionRun({
        actor: toPrivilegedActorContext(actor),
        aipId: run.aip_id,
        uploadedFileId: run.uploaded_file_id,
        createdBy: actor.userId,
        modelName: "gpt-5.2",
        retryOfRunId: run.id,
        resumeFromStage,
      });
    } catch (error) {
      return NextResponse.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Failed to create retry run.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        runId: newRun.id,
        status: newRun.status,
        aipId: run.aip_id,
        retryMode,
        resumeFromStage,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected retry error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
