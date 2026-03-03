import { CitizenChatRepoErrors } from "./types";
import type { CitizenChatMessage, CitizenChatRepo, CitizenChatSession } from "./repo";
import type { Json } from "@/lib/contracts/databasev2";

let sessionSequence = 1;
let messageSequence = 1;

let sessionsStore: CitizenChatSession[] = [];
let messagesStore: CitizenChatMessage[] = [];

function nextSessionId() {
  const id = `cit_chat_${String(sessionSequence).padStart(3, "0")}`;
  sessionSequence += 1;
  return id;
}

function nextMessageId() {
  const id = `cit_msg_${String(messageSequence).padStart(4, "0")}`;
  messageSequence += 1;
  return id;
}

function sortSessionsDesc(a: CitizenChatSession, b: CitizenChatSession) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function sortMessagesAsc(a: CitizenChatMessage, b: CitizenChatMessage) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function __resetMockCitizenChatState() {
  sessionSequence = 1;
  messageSequence = 1;
  sessionsStore = [];
  messagesStore = [];
}

export function createMockCitizenChatRepo(): CitizenChatRepo {
  return {
    async listSessions(userId: string): Promise<CitizenChatSession[]> {
      return sessionsStore
        .filter((session) => session.userId === userId)
        .sort(sortSessionsDesc);
    },

    async getSession(sessionId: string): Promise<CitizenChatSession | null> {
      return sessionsStore.find((session) => session.id === sessionId) ?? null;
    },

    async createSession(
      userId: string,
      payload?: { title?: string; context?: Record<string, unknown> }
    ): Promise<CitizenChatSession> {
      const now = new Date().toISOString();
      const context = (payload?.context ?? {}) as Json;
      const session: CitizenChatSession = {
        id: nextSessionId(),
        userId,
        title: payload?.title ?? null,
        context,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now,
      };

      sessionsStore = [session, ...sessionsStore];
      return session;
    },

    async renameSession(sessionId: string, title: string): Promise<CitizenChatSession | null> {
      const normalized = title.trim();
      if (!normalized.length || normalized.length > 200) {
        throw new Error(CitizenChatRepoErrors.INVALID_CONTENT);
      }

      const sessionIndex = sessionsStore.findIndex((session) => session.id === sessionId);
      if (sessionIndex < 0) {
        return null;
      }

      const nextSession: CitizenChatSession = {
        ...sessionsStore[sessionIndex],
        title: normalized,
        updatedAt: new Date().toISOString(),
      };

      sessionsStore = [
        ...sessionsStore.slice(0, sessionIndex),
        nextSession,
        ...sessionsStore.slice(sessionIndex + 1),
      ].sort(sortSessionsDesc);

      return nextSession;
    },

    async deleteSession(sessionId: string): Promise<boolean> {
      const found = sessionsStore.some((session) => session.id === sessionId);
      if (!found) {
        return false;
      }

      sessionsStore = sessionsStore.filter((session) => session.id !== sessionId);
      messagesStore = messagesStore.filter((message) => message.sessionId !== sessionId);
      return true;
    },

    async listMessages(sessionId: string): Promise<CitizenChatMessage[]> {
      return messagesStore
        .filter((message) => message.sessionId === sessionId)
        .sort(sortMessagesAsc);
    },

    async appendUserMessage(sessionId: string, content: string): Promise<CitizenChatMessage> {
      const normalized = content.trim();
      if (!normalized.length || normalized.length > 12000) {
        throw new Error(CitizenChatRepoErrors.INVALID_CONTENT);
      }

      const sessionIndex = sessionsStore.findIndex((session) => session.id === sessionId);
      if (sessionIndex < 0) {
        throw new Error(CitizenChatRepoErrors.NOT_FOUND);
      }

      const now = new Date().toISOString();
      const message: CitizenChatMessage = {
        id: nextMessageId(),
        sessionId,
        role: "user",
        content: normalized,
        citations: null,
        retrievalMeta: null,
        createdAt: now,
      };

      messagesStore = [...messagesStore, message];

      const nextSession: CitizenChatSession = {
        ...sessionsStore[sessionIndex],
        lastMessageAt: now,
        updatedAt: now,
      };

      sessionsStore = [
        ...sessionsStore.slice(0, sessionIndex),
        nextSession,
        ...sessionsStore.slice(sessionIndex + 1),
      ].sort(sortSessionsDesc);

      return message;
    },
  };
}
