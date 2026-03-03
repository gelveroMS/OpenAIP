"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getCitizenChatRepo } from "@/lib/repos/citizen-chat/repo";
import type { CitizenChatMessage, CitizenChatSession } from "@/lib/repos/citizen-chat/repo";
import { buildCitizenAuthHref, setReturnToInSessionStorage } from "@/features/citizen/auth/utils/auth-query";
import { addCitizenAuthChangedListener } from "@/features/citizen/auth/utils/auth-sync";
import { CITIZEN_CHAT_LIMITS } from "../constants/ui";
import { mapEvidenceFromCitations, mapFollowUpsFromRetrievalMeta } from "../mappers/chat-message-presenter";
import type {
  CitizenChatComposerMode,
  CitizenChatErrorState,
  CitizenChatMessageVM,
  CitizenChatReplyResult,
  CitizenChatSessionVM,
} from "../types/citizen-chatbot.types";

const EXAMPLE_QUERIES = [
  "What is the total budget for FY 2025?",
  "Show Social Services allocation trends from 2020-2026.",
  "List infrastructure projects in my barangay.",
] as const;

function formatTimeLabel(value: string | null | undefined) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sortSessionsByUpdatedAt(sessions: CitizenChatSession[]) {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function toSessionItem(params: {
  session: CitizenChatSession;
  messages: CitizenChatMessage[];
  isActive: boolean;
}): CitizenChatSessionVM {
  const { session, messages, isActive } = params;
  const lastMessage = messages[messages.length - 1] ?? null;

  return {
    id: session.id,
    title: session.title?.trim() || "New chat",
    timeLabel: formatTimeLabel(lastMessage?.createdAt ?? session.lastMessageAt ?? session.updatedAt),
    isActive,
  };
}

function toMessageVm(message: CitizenChatMessage): CitizenChatMessageVM {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timeLabel: formatTimeLabel(message.createdAt),
    citations: message.citations,
    retrievalMeta: message.retrievalMeta,
    evidence: mapEvidenceFromCitations(message.citations),
    followUps: mapFollowUpsFromRetrievalMeta(message.retrievalMeta),
  };
}

async function requestAssistantReply(params: {
  sessionId: string;
  userMessage: string;
}): Promise<CitizenChatReplyResult> {
  const response = await fetch("/api/citizen/chat/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      user_message: params.userMessage,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as
    | CitizenChatReplyResult
    | { error?: string };

  if (!response.ok) {
    const error = "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "Failed to fetch assistant response.";
    throw new Error(error);
  }

  return payload as CitizenChatReplyResult;
}

type ProfileStatusPayload = {
  ok?: boolean;
  isComplete?: boolean;
  userId?: string;
  isBlocked?: boolean;
  blockedUntil?: string | null;
  blockedReason?: string | null;
};

export function useCitizenChatbot() {
  const repo = useMemo(() => getCitizenChatRepo(), []);
  const supabase = useMemo(() => supabaseBrowser(), []);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isProfileResolved, setIsProfileResolved] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CitizenChatSession[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, CitizenChatMessage[]>>({});
  const [loadedSessionIds, setLoadedSessionIds] = useState<Record<string, true>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [errorState, setErrorState] = useState<CitizenChatErrorState>("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sanitizedNext = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("auth");
    params.delete("authStep");
    params.delete("completeProfile");
    params.delete("next");
    params.delete("returnTo");
    const queryValue = params.toString();
    return queryValue ? `${pathname}?${queryValue}` : pathname;
  }, [pathname, searchParams]);

  const openAuthModal = useCallback((forceCompleteProfile: boolean) => {
    setReturnToInSessionStorage(sanitizedNext);
    const href = buildCitizenAuthHref({
      pathname,
      searchParams,
      mode: forceCompleteProfile ? null : "login",
      launchStep: "email",
      completeProfile: forceCompleteProfile,
      next: sanitizedNext,
    });
    router.replace(href, { scroll: false });
  }, [pathname, router, sanitizedNext, searchParams]);

  const clearAuthDependentState = useCallback(() => {
    setUserId(null);
    setIsProfileComplete(false);
    setIsBlocked(false);
    setBlockedUntil(null);
    setBlockedReason(null);
    setSessions([]);
    setMessagesBySession({});
    setLoadedSessionIds({});
    setActiveSessionId(null);
    setErrorState("none");
    setErrorMessage(null);
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    setIsAuthResolved(false);
    setIsProfileResolved(false);
    try {
      const response = await fetch("/profile/status", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ProfileStatusPayload | null;

      if (response.status === 401) {
        clearAuthDependentState();
        return;
      }

      if (
        !response.ok ||
        !payload?.ok ||
        typeof payload.userId !== "string" ||
        !payload.userId.trim().length
      ) {
        clearAuthDependentState();
        return;
      }

      setUserId(payload.userId);
      setIsProfileComplete(payload.isComplete === true);
      setIsBlocked(payload.isBlocked === true);
      setBlockedUntil(typeof payload.blockedUntil === "string" ? payload.blockedUntil : null);
      setBlockedReason(
        typeof payload.blockedReason === "string" && payload.blockedReason.trim().length > 0
          ? payload.blockedReason.trim()
          : null
      );
      setErrorState("none");
      setErrorMessage(null);
    } catch {
      clearAuthDependentState();
    } finally {
      setIsAuthResolved(true);
      setIsProfileResolved(true);
    }
  }, [clearAuthDependentState]);

  useEffect(() => {
    void refreshAuthStatus();

    const cleanupAuthChanged = addCitizenAuthChangedListener(() => {
      void refreshAuthStatus();
    });
    const handleFocus = () => {
      void refreshAuthStatus();
    };
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      void refreshAuthStatus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      void refreshAuthStatus();
    });

    return () => {
      cleanupAuthChanged();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      authListener.subscription.unsubscribe();
    };
  }, [refreshAuthStatus, supabase.auth]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setIsBootstrapping(false);
      return;
    }
    const currentUserId = userId;

    async function bootstrapSessions() {
      setIsBootstrapping(true);
      setActiveSessionId(null);
      setMessagesBySession({});
      setLoadedSessionIds({});
      try {
        const list = await repo.listSessions(currentUserId);
        if (!active) return;
        setSessions(sortSessionsByUpdatedAt(list));
        setErrorState("none");
        setErrorMessage(null);
      } catch (error) {
        if (!active) return;
        setErrorState("retrieval_failed");
        setErrorMessage(error instanceof Error ? error.message : "Failed to load sessions.");
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrapSessions();

    return () => {
      active = false;
    };
  }, [repo, userId]);

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      if (!activeSessionId || loadedSessionIds[activeSessionId]) return;
      try {
        const messages = await repo.listMessages(activeSessionId);
        if (!active) return;

        setMessagesBySession((prev) => ({
          ...prev,
          [activeSessionId]: messages,
        }));
        setLoadedSessionIds((prev) => ({
          ...prev,
          [activeSessionId]: true,
        }));
      } catch (error) {
        if (!active) return;
        setErrorState("retrieval_failed");
        setErrorMessage(error instanceof Error ? error.message : "Failed to load messages.");
      }
    }

    loadMessages();

    return () => {
      active = false;
    };
  }, [activeSessionId, loadedSessionIds, repo]);

  const sessionItems = useMemo(() => {
    if (!userId) return [] as CitizenChatSessionVM[];

    const lowered = query.trim().toLowerCase();

    return sessions
      .map((session) =>
        toSessionItem({
          session,
          messages: messagesBySession[session.id] ?? [],
          isActive: session.id === activeSessionId,
        })
      )
      .filter((session) => {
        if (!lowered) return true;
        return (
          session.title.toLowerCase().includes(lowered) ||
          session.timeLabel.toLowerCase().includes(lowered)
        );
      });
  }, [activeSessionId, messagesBySession, query, sessions, userId]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  const messages = useMemo(() => {
    const activeMessages = activeSessionId ? messagesBySession[activeSessionId] ?? [] : [];
    return activeMessages.map(toMessageVm);
  }, [activeSessionId, messagesBySession]);

  const composerMode: CitizenChatComposerMode = !userId
    ? "sign_in"
    : !isProfileComplete
      ? "complete_profile"
      : "send";

  const composerPlaceholder = composerMode === "sign_in"
    ? "Sign in to use the AI Assistant."
    : composerMode === "complete_profile"
      ? "Complete your profile to use the AI Assistant."
      : isBlocked
        ? "You are temporarily blocked from using the AI Assistant."
        : "Ask about budgets, sectors, or projects...";

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const handleNewChat = useCallback(async () => {
    if (!userId) {
      openAuthModal(false);
      return;
    }

    if (!isProfileComplete) {
      openAuthModal(true);
      return;
    }

    try {
      const session = await repo.createSession(userId, { context: {} });
      setSessions((prev) => sortSessionsByUpdatedAt([session, ...prev.filter((item) => item.id !== session.id)]));
      setActiveSessionId(session.id);
      setMessagesBySession((prev) => ({ ...prev, [session.id]: [] }));
      setLoadedSessionIds((prev) => ({ ...prev, [session.id]: true }));
      setErrorState("none");
      setErrorMessage(null);
    } catch (error) {
      setErrorState("retrieval_failed");
      setErrorMessage(error instanceof Error ? error.message : "Failed to start a new chat.");
    }
  }, [isProfileComplete, openAuthModal, repo, userId]);

  const handleRenameSession = useCallback(
    async (sessionId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle.length || nextTitle.length > 200) {
        throw new Error("Title must be 1 to 200 characters.");
      }

      const renamed = await repo.renameSession(sessionId, nextTitle);
      if (!renamed) {
        throw new Error("Conversation not found.");
      }

      setSessions((prev) => sortSessionsByUpdatedAt(prev.map((session) => (
        session.id === sessionId ? renamed : session
      ))));
    },
    [repo]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const deleted = await repo.deleteSession(sessionId);
      if (!deleted) {
        throw new Error("Conversation not found.");
      }

      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
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

      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, repo]
  );

  const handleUseExample = useCallback((value: string) => {
    setMessageInput(value);
  }, []);

  const handleUseFollowUp = useCallback((value: string) => {
    setMessageInput(value);
  }, []);

  const handleSend = useCallback(async () => {
    if (!userId) {
      openAuthModal(false);
      return;
    }

    if (!isProfileComplete) {
      openAuthModal(true);
      return;
    }
    if (isBlocked) {
      const reasonSuffix = blockedReason ? ` Reason: ${blockedReason}.` : "";
      const untilSuffix = blockedUntil ? ` Blocked until ${blockedUntil}.` : "";
      setErrorState("retrieval_failed");
      setErrorMessage(`Your account is currently blocked from chatbot usage.${untilSuffix}${reasonSuffix}`);
      return;
    }

    const content = messageInput.trim();
    if (!content) return;
    if (content.length > CITIZEN_CHAT_LIMITS.contentMaxLength) {
      setErrorState("retrieval_failed");
      setErrorMessage(`Message must be ${CITIZEN_CHAT_LIMITS.contentMaxLength} characters or less.`);
      return;
    }

    setIsSending(true);
    setErrorState("none");
    setErrorMessage(null);

    let sessionId = activeSessionId;
    let optimisticId: string | null = null;

    try {
      if (!sessionId) {
        const created = await repo.createSession(userId, { context: {} });
        setSessions((prev) => sortSessionsByUpdatedAt([created, ...prev.filter((item) => item.id !== created.id)]));
        setActiveSessionId(created.id);
        setMessagesBySession((prev) => ({ ...prev, [created.id]: [] }));
        setLoadedSessionIds((prev) => ({ ...prev, [created.id]: true }));
        sessionId = created.id;
      }
      if (!sessionId) {
        throw new Error("Failed to create chat session.");
      }
      const resolvedSessionId = sessionId;

      optimisticId = `temp_user_${Date.now()}`;
      const optimisticMessage: CitizenChatMessage = {
        id: optimisticId,
        sessionId: resolvedSessionId,
        role: "user",
        content,
        citations: null,
        retrievalMeta: null,
        createdAt: new Date().toISOString(),
      };

      setMessageInput("");
      setMessagesBySession((prev) => ({
        ...prev,
        [resolvedSessionId]: [...(prev[resolvedSessionId] ?? []), optimisticMessage],
      }));

      const persistedUser = await repo.appendUserMessage(resolvedSessionId, content);

      setMessagesBySession((prev) => ({
        ...prev,
        [resolvedSessionId]: (prev[resolvedSessionId] ?? []).map((msg) =>
          msg.id === optimisticId ? persistedUser : msg
        ),
      }));

      setSessions((prev) =>
        sortSessionsByUpdatedAt(
          prev.map((session) =>
            session.id === resolvedSessionId
              ? {
                  ...session,
                  lastMessageAt: persistedUser.createdAt,
                  updatedAt: persistedUser.createdAt,
                }
              : session
          )
        )
      );

      const reply = await requestAssistantReply({
        sessionId: resolvedSessionId,
        userMessage: content,
      });

      const assistantMessage: CitizenChatMessage = {
        id: reply.message.id,
        sessionId: reply.message.sessionId,
        role: "assistant",
        content: reply.message.content,
        citations: reply.message.citations,
        retrievalMeta: {
          ...(reply.message.retrievalMeta && typeof reply.message.retrievalMeta === "object" && !Array.isArray(reply.message.retrievalMeta)
            ? reply.message.retrievalMeta
            : {}),
          suggestedFollowUps: reply.suggestedFollowUps,
        },
        createdAt: reply.message.createdAt,
      };

      setMessagesBySession((prev) => ({
        ...prev,
        [resolvedSessionId]: [...(prev[resolvedSessionId] ?? []), assistantMessage],
      }));

      setSessions((prev) =>
        sortSessionsByUpdatedAt(
          prev.map((session) =>
            session.id === resolvedSessionId
              ? {
                  ...session,
                  lastMessageAt: assistantMessage.createdAt,
                  updatedAt: assistantMessage.createdAt,
                }
              : session
          )
        )
      );
    } catch (error) {
      if (sessionId && optimisticId) {
        const rollbackSessionId = sessionId;
        setMessagesBySession((prev) => ({
          ...prev,
          [rollbackSessionId]: (prev[rollbackSessionId] ?? []).filter(
            (msg) => msg.id !== optimisticId
          ),
        }));
      }

      const message = error instanceof Error ? error.message : "Failed to retrieve assistant response.";
      if (message.toLowerCase().includes("published aip")) {
        setErrorState("no_published_aip");
      } else {
        setErrorState("retrieval_failed");
      }
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  }, [
    activeSessionId,
    blockedReason,
    blockedUntil,
    isBlocked,
    isProfileComplete,
    messageInput,
    openAuthModal,
    repo,
    userId,
  ]);

  const handleComposerPrimaryAction = useCallback(() => {
    if (composerMode === "sign_in") {
      openAuthModal(false);
      return;
    }
    if (composerMode === "complete_profile") {
      openAuthModal(true);
      return;
    }
    void handleSend();
  }, [composerMode, handleSend, openAuthModal]);

  return {
    activeSession,
    activeSessionId,
    canManageConversations: Boolean(userId),
    composerMode,
    composerPlaceholder,
    errorMessage,
    errorState,
    exampleQueries: EXAMPLE_QUERIES,
    isBootstrapping: !isAuthResolved || !isProfileResolved || isBootstrapping,
    isComposerDisabled: composerMode === "send" ? isSending || isBlocked : false,
    isSending,
    messageInput,
    messages,
    query,
    sessionItems,
    setMessageInput,
    setQuery,
    handleComposerPrimaryAction,
    handleDeleteSession,
    handleNewChat,
    handleRenameSession,
    handleSelectSession,
    handleSend,
    handleUseExample,
    handleUseFollowUp,
  };
}
