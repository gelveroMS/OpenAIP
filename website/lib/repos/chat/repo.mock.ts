import { CHAT_MESSAGES_FIXTURE, CHAT_SESSIONS_FIXTURE } from "@/mocks/fixtures/chat/chat.fixture";
import type { ChatMessageRole } from "@/lib/contracts/databasev2";
import { formatFirstChatSessionTitle } from "@/lib/chat/session-title";
import { ChatRepoErrors } from "./types";
import type { ChatMessage, ChatRepo, ChatSession } from "./repo";

// [DATAFLOW] Mock `ChatRepo` implementation backed by in-memory arrays.
// [DBV2] Supabase adapter should map sessions/messages to `public.chat_sessions`/`public.chat_messages` and keep messages append-only.

let sessionSequence = 1;
let messageSequence = 1;

let sessionsStore: ChatSession[] = [...CHAT_SESSIONS_FIXTURE];
let messagesStore: ChatMessage[] = [...CHAT_MESSAGES_FIXTURE];

function nextSessionId() {
  const id = `chat_${String(sessionSequence).padStart(3, "0")}`;
  sessionSequence += 1;
  return id;
}

function nextMessageId() {
  const id = `cmsg_${String(messageSequence).padStart(4, "0")}`;
  messageSequence += 1;
  return id;
}

function sortByCreatedAtAsc(a: { createdAt: string }, b: { createdAt: string }) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function __resetMockChatState() {
  sessionSequence = 1;
  messageSequence = 1;
  sessionsStore = [...CHAT_SESSIONS_FIXTURE];
  messagesStore = [...CHAT_MESSAGES_FIXTURE];
}

export function createMockChatRepo(): ChatRepo {
  return {
    async listSessions(userId: string, options?: { query?: string }): Promise<ChatSession[]> {
      const loweredQuery = options?.query?.trim().toLowerCase() ?? "";
      let filtered = sessionsStore
        .filter((session) => session.userId === userId)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

      if (!loweredQuery) {
        return filtered;
      }

      filtered = filtered.filter((session) => {
        const title = (session.title ?? "").toLowerCase();
        if (title.includes(loweredQuery)) {
          return true;
        }

        return messagesStore.some((message) => {
          if (message.sessionId !== session.id) return false;
          return message.content.toLowerCase().includes(loweredQuery);
        });
      });

      return filtered;
    },

    async getSession(sessionId: string): Promise<ChatSession | null> {
      return sessionsStore.find((session) => session.id === sessionId) ?? null;
    },

    async createSession(
      userId: string,
      payload?: { title?: string; context?: unknown }
    ): Promise<ChatSession> {
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: nextSessionId(),
        userId,
        title: payload?.title ?? null,
        context: payload?.context ?? null,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now,
      };

      sessionsStore = [...sessionsStore, session];
      return session;
    },

    async renameSession(sessionId: string, title: string): Promise<ChatSession | null> {
      const index = sessionsStore.findIndex((session) => session.id === sessionId);
      if (index === -1) {
        return null;
      }

      const updated: ChatSession = {
        ...sessionsStore[index],
        title,
        updatedAt: new Date().toISOString(),
      };

      sessionsStore = [
        ...sessionsStore.slice(0, index),
        updated,
        ...sessionsStore.slice(index + 1),
      ];

      return updated;
    },

    async deleteSession(sessionId: string): Promise<boolean> {
      const beforeCount = sessionsStore.length;
      sessionsStore = sessionsStore.filter((session) => session.id !== sessionId);
      if (sessionsStore.length === beforeCount) {
        return false;
      }

      messagesStore = messagesStore.filter((message) => message.sessionId !== sessionId);
      return true;
    },

    async listMessages(sessionId: string): Promise<ChatMessage[]> {
      return messagesStore
        .filter((message) => message.sessionId === sessionId)
        .sort(sortByCreatedAtAsc);
    },

    async appendUserMessage(
      sessionId: string,
      content: string
    ): Promise<ChatMessage> {
      const sessionIndex = sessionsStore.findIndex(
        (session) => session.id === sessionId
      );
      if (sessionIndex === -1) {
        throw new Error(`Chat session not found: ${sessionId}`);
      }

      const now = new Date().toISOString();
      const message: ChatMessage = {
        id: nextMessageId(),
        sessionId,
        role: "user",
        content,
        createdAt: now,
      };

      messagesStore = [...messagesStore, message];

      const session = sessionsStore[sessionIndex];
      const generatedTitle = !session.title ? formatFirstChatSessionTitle(now) : null;
      const updatedSession: ChatSession = {
        ...session,
        title: session.title ?? generatedTitle ?? null,
        lastMessageAt: now,
        updatedAt: now,
      };

      sessionsStore = [
        ...sessionsStore.slice(0, sessionIndex),
        updatedSession,
        ...sessionsStore.slice(sessionIndex + 1),
      ];

      return message;
    },
  };
}

export async function __unsafeAddMessage(
  repo: ChatRepo,
  sessionId: string,
  role: ChatMessageRole,
  content: string
) {
  if (role !== "user") {
    throw new Error(ChatRepoErrors.INVALID_ROLE);
  }

  return repo.appendUserMessage(sessionId, content);
}
