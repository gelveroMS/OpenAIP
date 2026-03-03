import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { isInvariantError } from "@/lib/security/invariants";
import {
  readExtractionRunStatusForBarangay,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const actor = await getActorContext();
    const privilegedActor = toPrivilegedActorContext(actor);
    if (!privilegedActor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { runId } = await context.params;
    const data = await readExtractionRunStatusForBarangay({
      actor: privilegedActor,
      runId,
    });
    if (!data) {
      return NextResponse.json({ message: "Run not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        runId: data.id,
        aipId: data.aip_id,
        uploadedFileId: data.uploaded_file_id,
        stage: data.stage,
        status: data.status,
        errorCode: data.error_code,
        errorMessage: data.error_message,
        startedAt: data.started_at,
        finishedAt: data.finished_at,
        createdAt: data.created_at,
        overallProgressPct: data.overall_progress_pct,
        stageProgressPct: data.stage_progress_pct,
        progressMessage: data.progress_message,
        progressUpdatedAt: data.progress_updated_at,
      },
      { status: 200 }
    );
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected run status error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
