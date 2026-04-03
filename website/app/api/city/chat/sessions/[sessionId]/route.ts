import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getChatRepo } from "@/lib/repos/chat/repo.server";
import { enforceCsrfProtection } from "@/lib/security/csrf";

function parseTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    if (!actor || actor.role !== "city_official") {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { sessionId } = await context.params;
    const repo = getChatRepo();
    const session = await repo.getSession(sessionId);
    if (!session || session.userId !== actor.userId) {
      return NextResponse.json({ message: "Session not found." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    const title = parseTitle(body.title);
    if (!title) {
      return NextResponse.json({ message: "Title must be 1 to 200 characters." }, { status: 400 });
    }

    const renamed = await repo.renameSession(sessionId, title);
    if (!renamed || renamed.userId !== actor.userId) {
      return NextResponse.json({ message: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ session: renamed }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat session rename error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    if (!actor || actor.role !== "city_official") {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { sessionId } = await context.params;
    const repo = getChatRepo();
    const session = await repo.getSession(sessionId);
    if (!session || session.userId !== actor.userId) {
      return NextResponse.json({ message: "Session not found." }, { status: 404 });
    }

    const deleted = await repo.deleteSession(sessionId);
    if (!deleted) {
      return NextResponse.json({ message: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat session delete error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
