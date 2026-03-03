"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatSession } from "@/lib/repos/chat/repo";
import type { ChatCitation, ChatRetrievalMeta } from "@/lib/repos/chat/types";
import type {
  ChatMessageBubble,
  ChatMessageDeliveryStatus,
  ChatSessionListItem,
} from "../types/chat.types";

const SEARCH_DEBOUNCE_MS = 250;

export function mapLguChatbotErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  const rawMessage = error instanceof Error ? error.message.trim() : "";

  if (rawMessage === "Use /api/city/chat/messages for city officials.") {
    return "This account belongs to the city chatbot. Open /city/chatbot.";
  }

  if (rawMessage === "Use /api/barangay/chat/messages for barangay officials.") {
    return "This account belongs to the barangay chatbot. Open /barangay/chatbot.";
  }

  if (rawMessage === "Authentication required." || rawMessage === "Unauthorized.") {
    return "Authentication required. Please sign in again.";
  }

  if (rawMessage === "Only barangay and city officials can use the LGU chatbot.") {
    return "This account is not allowed to use the LGU chatbot.";
  }

  if (rawMessage === "Forbidden. Missing required LGU scope.") {
    return "Your account is missing its required LGU assignment. Contact an administrator.";
  }

  return rawMessage || fallbackMessage;
}

type LocalChatMessage = ChatMessage & {
  deliveryStatus: ChatMessageDeliveryStatus;
};

function formatTimeLabel(value: string | null | undefined) {
  if (!value) return "Just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";

  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sortSessionsByUpdatedAt(sessions: ChatSession[]) {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function toSentMessage(message: ChatMessage): LocalChatMessage {
  return {
    ...message,
    deliveryStatus: "sent",
  };
}

function toSessionListItem(params: {
  session: ChatSession;
  messages: LocalChatMessage[];
  isActive: boolean;
}): ChatSessionListItem {
  const { session, messages, isActive } = params;
  const lastMessage = messages[messages.length - 1] ?? null;

  return {
    id: session.id,
    title: session.title?.trim() || "New chat",
    timeLabel: formatTimeLabel(lastMessage?.createdAt ?? session.lastMessageAt ?? session.updatedAt),
    isActive,
  };
}

function toBubble(
  message: LocalChatMessage,
  onRetry: ((messageId: string) => void) | null
): ChatMessageBubble {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timeLabel: formatTimeLabel(message.createdAt),
    deliveryStatus: message.deliveryStatus,
    onRetry:
      message.role === "user" && message.deliveryStatus === "failed" && onRetry
        ? () => onRetry(message.id)
        : null,
    citations: (message.citations as ChatCitation[] | null) ?? [],
    retrievalMeta: (message.retrievalMeta as ChatRetrievalMeta | null) ?? null,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : "Request failed.";
    throw new Error(message);
  }

  return payload as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  return parseResponse<T>(response);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE" });
  return parseResponse<T>(response);
}

export function useLguChatbot(routePrefix = "/api/barangay/chat") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, LocalChatMessage[]>>({});
  const [loadedSessionIds, setLoadedSessionIds] = useState<Record<string, true>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchSessionIds, setSearchSessionIds] = useState<string[] | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeSessions = useCallback((incoming: ChatSession[]) => {
    setSessions((prev) => {
      const map = new Map<string, ChatSession>(prev.map((session) => [session.id, session]));
      for (const session of incoming) {
        map.set(session.id, session);
      }
      return sortSessionsByUpdatedAt(Array.from(map.values()));
    });
  }, []);

  const loadSessions = useCallback(async () => {
    const payload = await getJson<{ sessions: ChatSession[] }>(`${routePrefix}/sessions`);
    const fetchedSessions = sortSessionsByUpdatedAt(payload.sessions ?? []);
    setSessions(fetchedSessions);
    setActiveSessionId((prev) => {
      if (prev && fetchedSessions.some((session) => session.id === prev)) {
        return prev;
      }
      return fetchedSessions[0]?.id ?? null;
    });
  }, [routePrefix]);

  const createSession = useCallback(async (): Promise<ChatSession> => {
    const payload = await postJson<{ session: ChatSession }>(`${routePrefix}/sessions`, {});
    const session = payload.session;
    if (!session) {
      throw new Error("Invalid session payload.");
    }

    setSessions((prev) => sortSessionsByUpdatedAt([session, ...prev.filter((item) => item.id !== session.id)]));
    setActiveSessionId(session.id);
    setMessagesBySession((prev) => ({ ...prev, [session.id]: [] }));
    setLoadedSessionIds((prev) => ({ ...prev, [session.id]: true }));
    return session;
  }, [routePrefix]);

  const searchSessions = useCallback(
    async (term: string) => {
      const payload = await getJson<{ sessions: ChatSession[] }>(
        `${routePrefix}/sessions?q=${encodeURIComponent(term)}`
      );
      return sortSessionsByUpdatedAt(payload.sessions ?? []);
    },
    [routePrefix]
  );

  const applySearchResults = useCallback(
    (matches: ChatSession[]) => {
      mergeSessions(matches);
      setSearchSessionIds(matches.map((session) => session.id));
    },
    [mergeSessions]
  );

  const refreshSearch = useCallback(async () => {
    const lowered = query.trim();
    if (!lowered) return;
    const matches = await searchSessions(lowered);
    applySearchResults(matches);
  }, [applySearchResults, query, searchSessions]);

  useEffect(() => {
    let isMounted = true;

    loadSessions().catch((err) => {
      if (!isMounted) return;
      setError(mapLguChatbotErrorMessage(err, "Failed to load chat sessions."));
    });

    return () => {
      isMounted = false;
    };
  }, [loadSessions]);

  useEffect(() => {
    let isMounted = true;

    async function loadMessages() {
      if (!activeSessionId || loadedSessionIds[activeSessionId]) return;

      const payload = await getJson<{ messages: ChatMessage[] }>(
        `${routePrefix}/sessions/${activeSessionId}/messages`
      );
      if (!isMounted) return;

      setMessagesBySession((prev) => ({
        ...prev,
        [activeSessionId]: (payload.messages ?? []).map(toSentMessage),
      }));
      setLoadedSessionIds((prev) => ({
        ...prev,
        [activeSessionId]: true,
      }));
    }

    loadMessages().catch((err) => {
      if (!isMounted) return;
      setError(mapLguChatbotErrorMessage(err, "Failed to load messages."));
    });

    return () => {
      isMounted = false;
    };
  }, [activeSessionId, loadedSessionIds, routePrefix]);

  useEffect(() => {
    const lowered = query.trim();
    if (!lowered) {
      setSearchSessionIds(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      searchSessions(lowered)
        .then((matches) => {
          if (cancelled) return;
          applySearchResults(matches);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(mapLguChatbotErrorMessage(err, "Failed to search conversations."));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [applySearchResults, query, searchSessions]);

  const visibleSessions = useMemo(() => {
    if (!searchSessionIds) return sessions;

    const byId = new Map<string, ChatSession>(sessions.map((session) => [session.id, session]));
    return searchSessionIds
      .map((id) => byId.get(id))
      .filter((session): session is ChatSession => Boolean(session));
  }, [searchSessionIds, sessions]);

  const sessionListItems = useMemo<ChatSessionListItem[]>(() => {
    return visibleSessions.map((session) =>
      toSessionListItem({
        session,
        messages: messagesBySession[session.id] ?? [],
        isActive: session.id === activeSessionId,
      })
    );
  }, [activeSessionId, messagesBySession, visibleSessions]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeMessages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] ?? [] : []),
    [activeSessionId, messagesBySession]
  );

  const handleSelect = useCallback((id: string) => {
    setActiveSessionId(id);
    setError(null);
  }, []);

  const handleNewChat = useCallback(async () => {
    setError(null);
    try {
      await createSession();
    } catch (err) {
      setError(mapLguChatbotErrorMessage(err, "Failed to create chat."));
    }
  }, [createSession]);

  const sendMessage = useCallback(
    async (rawContent: string, retryMessageId?: string) => {
      const content = rawContent.trim();
      if (!content || isSending) return;

      setError(null);
      setIsSending(true);

      let sessionId = activeSessionId;
      if (!sessionId) {
        try {
          const created = await createSession();
          sessionId = created.id;
        } catch (err) {
          setError(mapLguChatbotErrorMessage(err, "Failed to create chat."));
          setIsSending(false);
          return;
        }
      }

      const optimisticId = retryMessageId ?? `temp_user_${Date.now()}`;
      const now = new Date().toISOString();
      if (retryMessageId) {
        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: (prev[sessionId] ?? []).map((message) =>
            message.id === retryMessageId ? { ...message, deliveryStatus: "pending" } : message
          ),
        }));
      } else {
        setMessageInput("");
        const optimisticMessage: LocalChatMessage = {
          id: optimisticId,
          sessionId,
          role: "user",
          content,
          createdAt: now,
          citations: null,
          retrievalMeta: null,
          deliveryStatus: "pending",
        };
        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: [...(prev[sessionId] ?? []), optimisticMessage],
        }));
        setSessions((prev) =>
          sortSessionsByUpdatedAt(
            prev.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    lastMessageAt: now,
                    updatedAt: now,
                  }
                : session
            )
          )
        );
      }
      setLoadedSessionIds((prev) => ({ ...prev, [sessionId]: true }));

      try {
        const payload = await postJson<{
          sessionId: string;
          userMessage: ChatMessage;
          assistantMessage: ChatMessage;
        }>(`${routePrefix}/messages`, {
          sessionId,
          content,
        });

        const resolvedSessionId = payload.sessionId;
        const userMessage = payload.userMessage;
        const assistantMessage = payload.assistantMessage;

        if (!resolvedSessionId || !userMessage || !assistantMessage) {
          throw new Error("Invalid chatbot response payload.");
        }

        setActiveSessionId(resolvedSessionId);
        setLoadedSessionIds((prev) => ({ ...prev, [resolvedSessionId]: true }));
        setMessagesBySession((prev) => {
          const next: Record<string, LocalChatMessage[]> = {};
          for (const [key, list] of Object.entries(prev)) {
            next[key] = list.filter((message) => message.id !== optimisticId);
          }
          next[resolvedSessionId] = [
            ...(next[resolvedSessionId] ?? []),
            toSentMessage(userMessage),
            toSentMessage(assistantMessage),
          ];
          return next;
        });

        await loadSessions();
        await refreshSearch();
      } catch (err) {
        setMessagesBySession((prev) => {
          if (!sessionId) return prev;
          return {
            ...prev,
            [sessionId]: (prev[sessionId] ?? []).map((message) =>
              message.id === optimisticId ? { ...message, deliveryStatus: "failed" } : message
            ),
          };
        });
        setError(mapLguChatbotErrorMessage(err, "Failed to send message."));
      } finally {
        setIsSending(false);
      }
    },
    [activeSessionId, createSession, isSending, loadSessions, refreshSearch, routePrefix]
  );

  const handleSend = useCallback(async () => {
    await sendMessage(messageInput);
  }, [messageInput, sendMessage]);

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!activeSessionId) return;
      const failedMessage = (messagesBySession[activeSessionId] ?? []).find(
        (message) => message.id === messageId
      );
      if (!failedMessage || failedMessage.deliveryStatus !== "failed") return;
      await sendMessage(failedMessage.content, failedMessage.id);
    },
    [activeSessionId, messagesBySession, sendMessage]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, title: string) => {
      setError(null);
      try {
        const payload = await patchJson<{ session: ChatSession }>(`${routePrefix}/sessions/${sessionId}`, {
          title,
        });

        const renamed = payload.session;
        if (!renamed) {
          throw new Error("Failed to rename conversation.");
        }

        mergeSessions([renamed]);
        await refreshSearch();
      } catch (err) {
        const message = mapLguChatbotErrorMessage(err, "Failed to rename conversation.");
        setError(message);
        throw new Error(message);
      }
    },
    [mergeSessions, refreshSearch, routePrefix]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      setError(null);
      try {
        await deleteJson<{ ok: boolean }>(`${routePrefix}/sessions/${sessionId}`);

        let fallbackSessionId: string | null = null;
        setSessions((prev) => {
          const next = prev.filter((session) => session.id !== sessionId);
          fallbackSessionId = next[0]?.id ?? null;
          return next;
        });

        setMessagesBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setLoadedSessionIds((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setSearchSessionIds((prev) => (prev ? prev.filter((id) => id !== sessionId) : null));

        if (activeSessionId === sessionId) {
          if (fallbackSessionId) {
            setActiveSessionId(fallbackSessionId);
          } else {
            await createSession();
          }
        }

        await refreshSearch();
      } catch (err) {
        const message = mapLguChatbotErrorMessage(err, "Failed to delete conversation.");
        setError(message);
        throw new Error(message);
      }
    },
    [activeSessionId, createSession, refreshSearch, routePrefix]
  );

  const bubbles = useMemo(
    () => activeMessages.map((message) => toBubble(message, handleRetry)),
    [activeMessages, handleRetry]
  );

  return {
    activeSessionId,
    query,
    messageInput,
    isSending,
    error,
    sessionListItems,
    activeSession,
    bubbles,
    setQuery,
    setMessageInput,
    handleSelect,
    handleNewChat,
    handleSend,
    handleRenameSession,
    handleDeleteSession,
  };
}
