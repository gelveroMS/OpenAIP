import type { ChatMessage } from "@/lib/repos/chat/repo";

type ReplyRequestInput = {
  sessionId: string;
  userMessage: string;
};

type ReplyResponse = {
  id: string;
  sessionId: string;
  role: "assistant";
  content: string;
  createdAt: string;
  citations?: ChatMessage["citations"];
  retrievalMeta?: ChatMessage["retrievalMeta"];
};

export async function requestAssistantReply(input: ReplyRequestInput): Promise<ChatMessage> {
  const response = await fetch("/api/chat/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: input.sessionId,
      user_message: input.userMessage,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to retrieve assistant reply.");
  }

  const data = (await response.json()) as ReplyResponse;

  return {
    id: data.id,
    sessionId: data.sessionId,
    role: data.role,
    content: data.content,
    createdAt: data.createdAt,
    citations: data.citations ?? null,
    retrievalMeta: data.retrievalMeta ?? null,
  };
}
