import { NextResponse } from "next/server";
import { getLguChatAuthFailure } from "@/lib/chat/lgu-route-auth";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getChatRepo } from "@/lib/repos/chat/repo.server";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { isInvariantError, assertPrivilegedWriteAccess } from "@/lib/security/invariants";

export async function GET(request: Request) {
  try {
    const actor = await getActorContext();
    const authFailure = getLguChatAuthFailure("barangay", actor, "sessions");
    if (authFailure) {
      return NextResponse.json({ message: authFailure.message }, { status: authFailure.status });
    }
    if (!actor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    assertPrivilegedWriteAccess({
      actor,
      allowlistedRoles: ["barangay_official", "city_official"],
      scopeByRole: {
        barangay_official: "barangay",
        city_official: "city",
      },
      requireScopeId: true,
      message: "Forbidden. Missing required LGU scope.",
    });

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? undefined;

    const repo = getChatRepo();
    const sessions = await repo.listSessions(actor.userId, { query });
    return NextResponse.json({ sessions }, { status: 200 });
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected chat session lookup error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    const authFailure = getLguChatAuthFailure("barangay", actor, "sessions");
    if (authFailure) {
      return NextResponse.json({ message: authFailure.message }, { status: authFailure.status });
    }
    if (!actor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    assertPrivilegedWriteAccess({
      actor,
      allowlistedRoles: ["barangay_official", "city_official"],
      scopeByRole: {
        barangay_official: "barangay",
        city_official: "city",
      },
      requireScopeId: true,
      message: "Forbidden. Missing required LGU scope.",
    });

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      context?: unknown;
    };

    const repo = getChatRepo();
    const session = await repo.createSession(actor.userId, {
      title: body.title,
      context: body.context,
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected chat session creation error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
