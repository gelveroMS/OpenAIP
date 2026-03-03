import { NextResponse } from "next/server";
import {
  dispatchEmbedCategorize,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { isEmbedSkipNoArtifactMessage } from "@/lib/constants/embedding";

export async function POST(
  _request: Request,
  context: { params: Promise<{ aipId: string }> }
) {
  try {
    const actor = await getActorContext();
    if (!actor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    if (actor.role !== "city_official" && actor.role !== "admin") {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const { aipId } = await context.params;
    const client = await supabaseServer();
    const { data: canRead, error: canReadError } = await client.rpc("can_read_aip", {
      p_aip_id: aipId,
    });
    if (canReadError) {
      return NextResponse.json({ message: canReadError.message }, { status: 400 });
    }
    if (!canRead) {
      return NextResponse.json({ message: "You cannot access this AIP." }, { status: 403 });
    }

    const { data: aipRow, error: aipError } = await client
      .from("aips")
      .select("status")
      .eq("id", aipId)
      .maybeSingle();
    if (aipError) {
      return NextResponse.json({ message: aipError.message }, { status: 400 });
    }
    if (!aipRow) {
      return NextResponse.json({ message: "AIP not found." }, { status: 404 });
    }
    if (aipRow.status !== "published") {
      return NextResponse.json(
        { message: "Manual indexing is only available for published AIPs." },
        { status: 409 }
      );
    }

    const { data: latestEmbedRun, error: latestEmbedRunError } = await client
      .from("extraction_runs")
      .select("id,status,progress_message")
      .eq("aip_id", aipId)
      .eq("stage", "embed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestEmbedRunError) {
      return NextResponse.json({ message: latestEmbedRunError.message }, { status: 400 });
    }

    let reason: "missing" | "failed" | "skipped" | null = null;
    if (!latestEmbedRun) {
      reason = "missing";
    } else if (latestEmbedRun.status === "failed") {
      reason = "failed";
    } else if (
      latestEmbedRun.status === "succeeded" &&
      isEmbedSkipNoArtifactMessage(latestEmbedRun.progress_message)
    ) {
      reason = "skipped";
    } else if (
      latestEmbedRun.status === "queued" ||
      latestEmbedRun.status === "running"
    ) {
      return NextResponse.json(
        { message: "Search indexing is already in progress." },
        { status: 409 }
      );
    } else if (latestEmbedRun.status === "succeeded") {
      return NextResponse.json(
        { message: "Search index is already ready." },
        { status: 409 }
      );
    } else {
      return NextResponse.json(
        { message: "Unable to dispatch indexing for the current run state." },
        { status: 409 }
      );
    }

    let dispatchRequestId: unknown;
    try {
      dispatchRequestId = await dispatchEmbedCategorize({
        actor: toPrivilegedActorContext(actor),
        aipId,
      });
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Failed to dispatch indexing." },
        { status: 500 }
      );
    }
    if (dispatchRequestId === null) {
      return NextResponse.json(
        {
          message:
            "Indexing dispatch is not configured. Set app.embed_categorize_url and job secret, then retry.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        aipId,
        dispatchRequestId,
        reason,
        message:
          reason === "failed"
            ? "Search indexing retry dispatched."
            : "Search indexing job dispatched.",
      },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected embed retry error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
