import { NextResponse } from "next/server";
import { toImageResponse } from "@/app/api/projects/_shared/image-response";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { isInvariantError } from "@/lib/security/invariants";
import { readProjectCoverBlob, toPrivilegedActorContext } from "@/lib/supabase/privileged-ops";

function notFoundResponse() {
  return NextResponse.json({ message: "Project cover not found." }, { status: 404 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const normalized = projectId.trim();
    if (!normalized) {
      return notFoundResponse();
    }

    const actor = await getActorContext();
    const projectCover = await readProjectCoverBlob({
      actor: toPrivilegedActorContext(actor),
      projectIdOrRef: normalized,
    });
    if (!projectCover) {
      return notFoundResponse();
    }

    return toImageResponse(projectCover.imageData, projectCover.imagePath);
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Unexpected project cover media error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
