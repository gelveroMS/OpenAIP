"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  buildCitizenAuthHref,
  setReturnToInSessionStorage,
} from "@/features/citizen/auth/utils/auth-query";
import { addCitizenAuthChangedListener } from "@/features/citizen/auth/utils/auth-sync";
import {
  createProjectFeedback,
  createProjectFeedbackReply,
  listProjectFeedback,
  ProjectFeedbackRequestError,
} from "./feedback.api";
import { FeedbackCard } from "./feedback-card";
import { FeedbackComposer } from "./feedback-composer";
import type {
  CitizenProjectFeedbackKind,
  ProjectFeedbackItem,
  ProjectFeedbackThread,
} from "./feedback.types";

type FeedbackThreadProps = {
  projectId: string;
  rootFilter?: "all" | "citizen" | "workflow";
  readOnly?: boolean;
  title?: string;
  description?: string;
  emptyStateText?: string;
  hideHeader?: boolean;
};

type ReplyComposerState = {
  rootId: string;
  parentFeedbackId: string;
  replyToAuthor: string;
};

type ProfileStatusPayload = {
  ok?: boolean;
  isComplete?: boolean;
  userId?: string;
  isBlocked?: boolean;
  blockedUntil?: string | null;
  blockedReason?: string | null;
};

const EMPTY_STATE_TEXT =
  "No feedback yet. Be the first to share a commendation, suggestion, concern, or question.";

function sortByCreatedNewestFirst(items: ProjectFeedbackItem[]): ProjectFeedbackItem[] {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function sortByCreatedOldestFirst(items: ProjectFeedbackItem[]): ProjectFeedbackItem[] {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return leftTime - rightTime;
  });
}

function groupFeedbackThreads(items: ProjectFeedbackItem[]): ProjectFeedbackThread[] {
  const roots = sortByCreatedNewestFirst(items.filter((item) => item.parentFeedbackId === null));
  const replies = items.filter((item) => item.parentFeedbackId !== null);

  const repliesByRootId = new Map<string, ProjectFeedbackItem[]>();
  for (const reply of replies) {
    const rootId = reply.parentFeedbackId;
    if (!rootId) continue;
    const list = repliesByRootId.get(rootId) ?? [];
    list.push(reply);
    repliesByRootId.set(rootId, list);
  }

  return roots.map((root) => ({
    root,
    replies: sortByCreatedOldestFirst(repliesByRootId.get(root.id) ?? []),
  }));
}

function normalizeApiError(error: unknown, fallback: string): string {
  if (error instanceof ProjectFeedbackRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function formatBlockedUntilLabel(value: string | null): string {
  if (!value) return "an unknown date";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}

function isCitizenRoot(thread: ProjectFeedbackThread): boolean {
  return thread.root.author.role === "citizen";
}

export function FeedbackThread({
  projectId,
  rootFilter = "all",
  readOnly = false,
  title = "Feedback",
  description = "Share a commendation, suggestion, concern, or question for this project.",
  emptyStateText = EMPTY_STATE_TEXT,
  hideHeader = false,
}: FeedbackThreadProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isAuthLoading, setIsAuthLoading] = React.useState(true);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [isProfileComplete, setIsProfileComplete] = React.useState(false);
  const [isBlocked, setIsBlocked] = React.useState(false);
  const [blockedUntil, setBlockedUntil] = React.useState<string | null>(null);
  const [blockedReason, setBlockedReason] = React.useState<string | null>(null);

  const [items, setItems] = React.useState<ProjectFeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [isPostingRoot, setIsPostingRoot] = React.useState(false);
  const [postingReplyRootId, setPostingReplyRootId] = React.useState<string | null>(null);
  const [replyComposer, setReplyComposer] = React.useState<ReplyComposerState | null>(null);
  const authStatusRequestRef = React.useRef<Promise<void> | null>(null);
  const mountedRef = React.useRef(true);

  const currentDetailPath = React.useMemo(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    return `${path}#feedback`;
  }, [pathname, searchParams]);

  const openAuthModal = React.useCallback(
    (input: { forceCompleteProfile?: boolean }) => {
      setReturnToInSessionStorage(currentDetailPath);
      const href = buildCitizenAuthHref({
        pathname,
        searchParams,
        mode: input.forceCompleteProfile ? null : "login",
        launchStep: "email",
        completeProfile: input.forceCompleteProfile === true,
        next: currentDetailPath,
      });
      router.replace(href, { scroll: false });
    },
    [currentDetailPath, pathname, router, searchParams]
  );

  const requireFeedbackAccess = React.useCallback((): boolean => {
    if (!isAuthenticated) {
      openAuthModal({ forceCompleteProfile: false });
      return false;
    }
    if (isBlocked) {
      return false;
    }

    if (!isProfileComplete) {
      openAuthModal({ forceCompleteProfile: true });
      return false;
    }

    return true;
  }, [isAuthenticated, isBlocked, isProfileComplete, openAuthModal]);

  const refreshAuthState = React.useCallback(async () => {
    if (authStatusRequestRef.current) {
      return authStatusRequestRef.current;
    }

    const request = (async () => {
      if (mountedRef.current) {
        setIsAuthLoading(true);
      }

      const response = await fetch("/profile/status", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ProfileStatusPayload | null;
      if (!mountedRef.current) return;

      if (
        !response.ok ||
        !payload?.ok ||
        typeof payload.userId !== "string" ||
        !payload.userId.trim().length
      ) {
        setIsAuthenticated(false);
        setIsProfileComplete(false);
        setIsBlocked(false);
        setBlockedUntil(null);
        setBlockedReason(null);
        setIsAuthLoading(false);
        return;
      }

      setIsAuthenticated(true);
      setIsProfileComplete(payload.isComplete === true);
      setIsBlocked(payload.isBlocked === true);
      setBlockedUntil(typeof payload.blockedUntil === "string" ? payload.blockedUntil : null);
      setBlockedReason(
        typeof payload.blockedReason === "string" && payload.blockedReason.trim().length > 0
          ? payload.blockedReason.trim()
          : null
      );
      setIsAuthLoading(false);
    })();

    authStatusRequestRef.current = request;
    try {
      await request;
    } finally {
      if (authStatusRequestRef.current === request) {
        authStatusRequestRef.current = null;
      }
    }
  }, []);

  const loadFeedback = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listProjectFeedback(projectId);
      setItems(response.items);
    } catch (error) {
      setLoadError(normalizeApiError(error, "Failed to load project feedback."));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  React.useEffect(() => {
    mountedRef.current = true;
    const supabase = supabaseBrowser();

    void refreshAuthState();

    const cleanupAuthChanged = addCitizenAuthChangedListener(() => {
      void refreshAuthState();
    });
    const handleFocus = () => {
      void refreshAuthState();
    };
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      void refreshAuthState();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      void refreshAuthState();
    });

    return () => {
      mountedRef.current = false;
      cleanupAuthChanged();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      listener.subscription.unsubscribe();
    };
  }, [refreshAuthState]);

  const threads = React.useMemo(() => {
    const grouped = groupFeedbackThreads(items);
    if (rootFilter === "all") return grouped;
    if (rootFilter === "citizen") return grouped.filter(isCitizenRoot);
    return grouped.filter((thread) => !isCitizenRoot(thread));
  }, [items, rootFilter]);

  React.useEffect(() => {
    if (isBlocked) {
      setReplyComposer(null);
    }
  }, [isBlocked]);

  const blockedNotice = React.useMemo(() => {
    if (!isAuthenticated || !isBlocked) return null;
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Your account is temporarily blocked from posting feedback.</p>
        <p className="mt-1">Blocked until: {formatBlockedUntilLabel(blockedUntil)}</p>
        <p className="mt-1">Reason: {blockedReason ?? "Policy violation"}</p>
      </div>
    );
  }, [blockedReason, blockedUntil, isAuthenticated, isBlocked]);

  const handleReplyClick = React.useCallback(
    (item: ProjectFeedbackItem) => {
      if (readOnly) {
        return;
      }
      if (!requireFeedbackAccess()) {
        return;
      }

      const rootId = item.parentFeedbackId ?? item.id;
      setReplyComposer({
        rootId,
        parentFeedbackId: item.id,
        replyToAuthor: item.author.fullName,
      });
    },
    [readOnly, requireFeedbackAccess]
  );

  const handleCreateRootFeedback = React.useCallback(
    async (input: { kind: CitizenProjectFeedbackKind; body: string }) => {
      if (readOnly) {
        throw new Error("Posting feedback is disabled.");
      }
      if (!requireFeedbackAccess()) {
        throw new Error("Complete sign in and profile setup to post feedback.");
      }

      setIsPostingRoot(true);
      const optimisticId = `temp_root_${Date.now()}`;
      const optimisticItem: ProjectFeedbackItem = {
        id: optimisticId,
        projectId,
        parentFeedbackId: null,
        kind: input.kind,
        isHidden: false,
        body: input.body,
        createdAt: new Date().toISOString(),
        author: {
          id: null,
          fullName: "You",
          role: "citizen",
          roleLabel: "Citizen",
          lguLabel: "Brgy. Unknown",
        },
      };

      setItems((current) => [optimisticItem, ...current]);
      try {
        const response = await createProjectFeedback({
          projectId,
          kind: input.kind,
          body: input.body,
        });
        setItems((current) =>
          current.map((item) => (item.id === optimisticId ? response.item : item))
        );
      } catch (error) {
        setItems((current) => current.filter((item) => item.id !== optimisticId));
        if (error instanceof ProjectFeedbackRequestError) {
          if (error.status === 401) {
            openAuthModal({ forceCompleteProfile: false });
          } else if (error.status === 403 && error.message.toLowerCase().includes("complete")) {
            openAuthModal({ forceCompleteProfile: true });
          }
        }
        throw new Error(normalizeApiError(error, "Failed to post feedback."));
      } finally {
        setIsPostingRoot(false);
      }
    },
    [openAuthModal, projectId, readOnly, requireFeedbackAccess]
  );

  const handleCreateReplyFeedback = React.useCallback(
    async (input: { kind: CitizenProjectFeedbackKind; body: string }) => {
      if (readOnly) {
        throw new Error("Replying is disabled.");
      }
      if (!replyComposer) {
        throw new Error("Reply target is missing.");
      }

      if (!requireFeedbackAccess()) {
        throw new Error("Complete sign in and profile setup to post a reply.");
      }

      setPostingReplyRootId(replyComposer.rootId);
      const optimisticId = `temp_reply_${Date.now()}`;
      const optimisticReply: ProjectFeedbackItem = {
        id: optimisticId,
        projectId,
        parentFeedbackId: replyComposer.rootId,
        kind: input.kind,
        isHidden: false,
        body: input.body,
        createdAt: new Date().toISOString(),
        author: {
          id: null,
          fullName: "You",
          role: "citizen",
          roleLabel: "Citizen",
          lguLabel: "Brgy. Unknown",
        },
      };

      setItems((current) => [...current, optimisticReply]);
      try {
        const response = await createProjectFeedbackReply({
          projectId,
          parentFeedbackId: replyComposer.parentFeedbackId,
          kind: input.kind,
          body: input.body,
        });
        setItems((current) =>
          current.map((item) => (item.id === optimisticId ? response.item : item))
        );
        setReplyComposer(null);
      } catch (error) {
        setItems((current) => current.filter((item) => item.id !== optimisticId));
        if (error instanceof ProjectFeedbackRequestError) {
          if (error.status === 401) {
            openAuthModal({ forceCompleteProfile: false });
          } else if (error.status === 403 && error.message.toLowerCase().includes("complete")) {
            openAuthModal({ forceCompleteProfile: true });
          }
        }
        throw new Error(normalizeApiError(error, "Failed to post reply."));
      } finally {
        setPostingReplyRootId(null);
      }
    },
    [openAuthModal, projectId, readOnly, replyComposer, requireFeedbackAccess]
  );

  return (
    <section className="space-y-4" aria-label="Project feedback thread">
      {!hideHeader ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-500">{description}</p>
            </div>

            {!readOnly && !isBlocked && (!isAuthenticated || !isProfileComplete) ? (
              <Button
                type="button"
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuthModal({ forceCompleteProfile: false });
                    return;
                  }
                  openAuthModal({ forceCompleteProfile: true });
                }}
                aria-label="Add project feedback"
                disabled={isAuthLoading}
              >
                Add feedback
              </Button>
            ) : null}
          </div>

          {!readOnly && isAuthenticated && isBlocked ? (
            <div className="mt-4">{blockedNotice}</div>
          ) : null}

          {!readOnly && isAuthenticated && isProfileComplete && !isBlocked ? (
            <div className="mt-4">
              <FeedbackComposer
                submitLabel={isPostingRoot ? "Posting..." : "Post feedback"}
                disabled={isPostingRoot}
                placeholder="Share your feedback with the community and LGU."
                onSubmit={handleCreateRootFeedback}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Loading feedback...</p> : null}
      {!loading && loadError ? <p className="text-sm text-rose-600">{loadError}</p> : null}

      {!loading && !loadError && threads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
          {emptyStateText}
        </div>
      ) : null}

      {!loading && !loadError && threads.length > 0 ? (
        <div className="space-y-4">
          {threads.map((thread) => {
            const isPostingReply = postingReplyRootId === thread.root.id;
            const isReplyingHere = replyComposer?.rootId === thread.root.id;

            return (
              <div key={thread.root.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <FeedbackCard
                  item={thread.root}
                  onReply={handleReplyClick}
                  replyDisabled={readOnly || isBlocked || isPostingReply || isPostingRoot || isAuthLoading}
                  hideReplyButton={readOnly || isBlocked}
                />

                {thread.replies.length > 0 ? (
                  <div className="ml-4 space-y-3 border-l border-slate-200 pl-4">
                    {thread.replies.map((reply) => (
                      <FeedbackCard
                        key={reply.id}
                        item={reply}
                        onReply={handleReplyClick}
                        replyDisabled={
                          readOnly || isBlocked || isPostingReply || isPostingRoot || isAuthLoading
                        }
                        hideReplyButton={readOnly || isBlocked}
                        isReply
                      />
                    ))}
                  </div>
                ) : null}

                {isReplyingHere && !readOnly && !isBlocked ? (
                  <div className="ml-4 space-y-2 border-l border-slate-200 pl-4">
                    <p className="text-xs text-slate-500">
                      Replying to {replyComposer.replyToAuthor}
                    </p>
                    <FeedbackComposer
                      submitLabel={isPostingReply ? "Posting..." : "Post reply"}
                      disabled={isPostingReply}
                      placeholder="Write your reply..."
                      initialKind="question"
                      onSubmit={handleCreateReplyFeedback}
                      onCancel={() => setReplyComposer(null)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
