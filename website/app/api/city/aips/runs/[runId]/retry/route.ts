import { NextResponse } from "next/server";
import {
  insertExtractionRun,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { enforceCsrfProtection } from "@/lib/security/csrf";

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
      .select("id,aip_id,uploaded_file_id,status")
      .eq("id", runId)
      .maybeSingle();

    if (runError) {
      return NextResponse.json({ message: runError.message }, { status: 400 });
    }
    if (!run) {
      return NextResponse.json({ message: "Run not found." }, { status: 404 });
    }
    if (run.status !== "failed") {
      return NextResponse.json(
        { message: "Only failed runs can be retried." },
        { status: 409 }
      );
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

    let newRun: { id: string; status: string };
    try {
      newRun = await insertExtractionRun({
        actor: toPrivilegedActorContext(actor),
        aipId: run.aip_id,
        uploadedFileId: run.uploaded_file_id,
        createdBy: actor.userId,
        modelName: "gpt-5.2",
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
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected retry error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
