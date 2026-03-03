import { NextResponse } from "next/server";
import { enforceCsrfProtection } from "@/lib/security/csrf";

type ReplyRequestBody = {
  session_id?: string;
  user_message?: string;
};

function buildAssistantReply(content: string): string {
  if (content.toLowerCase().includes("budget")) {
    return (
      "For AIP budgeting, prioritize by outcomes and urgency.\n\n" +
      "1. Essential services first\n" +
      "2. Compliance and legal requirements\n" +
      "3. High-impact community projects\n" +
      "4. Contingency and sustainability\n\n" +
      "Share your project category and I can suggest a draft allocation structure."
    );
  }

  return "Thanks. I can help with AIP drafting, project scope, and compliance checks. What would you like to work on next?";
}

export async function POST(request: Request) {
  const csrf = enforceCsrfProtection(request);
  if (!csrf.ok) {
    return csrf.response;
  }

  const body = (await request.json().catch(() => null)) as ReplyRequestBody | null;
  const sessionId = body?.session_id?.trim();
  const userMessage = body?.user_message?.trim();

  if (!sessionId || !userMessage) {
    return NextResponse.json(
      { error: "Missing required fields: session_id, user_message" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  return NextResponse.json({
    id: `assistant_${Date.now()}`,
    sessionId,
    role: "assistant",
    content: buildAssistantReply(userMessage),
    createdAt: now,
    citations: null,
    retrievalMeta: null,
  });
}
