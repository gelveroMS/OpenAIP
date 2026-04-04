import type { ChatMessageRole, Json } from "@/lib/contracts/databasev2";

export type { ChatMessageRole };

export const CitizenChatRepoErrors = {
  FORBIDDEN: "FORBIDDEN",
  INVALID_ROLE: "INVALID_ROLE",
  NOT_FOUND: "NOT_FOUND",
  INVALID_CONTENT: "INVALID_CONTENT",
} as const;

export type CitizenChatEvidenceItem = {
  id: string;
  documentLabel: string;
  snippet: string;
  fiscalYear: string | null;
  pageOrSection: string | null;
};

export type CitizenChatSession = {
  id: string;
  userId: string;
  title: string | null;
  context: Json;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CitizenChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  citations: Json | null;
  retrievalMeta: Json | null;
};

export type CitizenChatReplyPayload = {
  sessionId: string;
  userMessage: CitizenChatMessage;
  assistantMessage: CitizenChatMessage;
};
