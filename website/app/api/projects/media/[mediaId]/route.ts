import { NextResponse } from "next/server";
import { toImageResponse } from "@/app/api/projects/_shared/image-response";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { isInvariantError } from "@/lib/security/invariants";
import {
  readProjectMediaBlob,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";

function notFoundResponse() {
  return NextResponse.json({ message: "Media not found." }, { status: 404 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await context.params;
    if (!mediaId.trim()) {
      return notFoundResponse();
    }

    const actor = await getActorContext();
    const media = await readProjectMediaBlob({
      actor: toPrivilegedActorContext(actor),
      mediaId,
    });
    if (!media) {
      return notFoundResponse();
    }

    return toImageResponse(media.imageData, media.objectName, media.mimeType);
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected media error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
