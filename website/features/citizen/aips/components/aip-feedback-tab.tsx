"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addCitizenAuthChangedListener } from "@/features/citizen/auth/utils/auth-sync";
import {
  getCitizenProfileStatus,
  invalidateCitizenProfileStatusCache,
} from "@/features/citizen/auth/utils/profile-status-client";
import { FeedbackComposer } from "@/features/projects/shared/feedback";
import type { CitizenProjectFeedbackKind } from "@/features/projects/shared/feedback";
import {
  type AipFeedbackDisplayKind,
  type AipFeedbackItem,
  AipFeedbackRequestError,
  createCitizenAipFeedback,
  createCitizenAipFeedbackReply,
  listAipFeedback,
  normalizeAipFeedbackApiError,
} from "./aip-feedback.api";

type AipFeedbackThread = {
  root: AipFeedbackItem;
  replies: AipFeedbackItem[];
};

type ReplyComposerState = {
  rootId: string;
  parentFeedbackId: string;
  replyToAuthor: string;
};

type Props = {
  aipId: string;
  feedbackCount: number;
};

function readSearchParam(
  searchParams: ReturnType<typeof useSearchParams>,
  key: string
): string | null {
  if (typeof (searchParams as { get?: unknown })?.get === "function") {
    return (searchParams as { get(name: string): string | null }).get(key);
  }

  const rawQuery =
    typeof (searchParams as { toString?: unknown })?.toString === "function"
      ? (searchParams as { toString(): string }).toString()
      : "";
  if (!rawQuery) return null;
  return new URLSearchParams(rawQuery).get(key);
}

function sortByCreatedNewestFirst(items: AipFeedbackItem[]): AipFeedbackItem[] {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function sortByCreatedOldestFirst(items: AipFeedbackItem[]): AipFeedbackItem[] {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return leftTime - rightTime;
  });
}

function groupFeedbackThreads(items: AipFeedbackItem[]): AipFeedbackThread[] {
  const roots = sortByCreatedNewestFirst(items.filter((item) => item.parentFeedbackId === null));
  const replies = items.filter((item) => item.parentFeedbackId !== null);
  const repliesByRootId = new Map<string, AipFeedbackItem[]>();

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

function buildFeedbackSignInHref(currentPath: string): string {
  const params = new URLSearchParams();
  params.set("next", currentPath);
  params.set("returnTo", currentPath);
  return `/sign-in?${params.toString()}`;
}

function formatFeedbackTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  const dateLabel = parsed.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  const timeLabel = parsed.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Manila",
  });
  return `${dateLabel} | ${timeLabel}`;
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

const KIND_LABELS: Record<AipFeedbackDisplayKind, string> = {
  commend: "Commend",
  suggestion: "Suggestion",
  concern: "Concern",
  question: "Question",
  lgu_note: "LGU Note",
};

const KIND_BADGE_CLASSES: Record<AipFeedbackDisplayKind, string> = {
  commend: "border-emerald-200 text-emerald-700",
  suggestion: "border-amber-200 text-amber-700",
  concern: "border-rose-200 text-rose-700",
  question: "border-slate-200 text-slate-700",
  lgu_note: "border-sky-200 text-sky-700",
};

function FeedbackCard({
  item,
  onReply,
  replyDisabled,
  showReplyButton,
  highlighted = false,
}: {
  item: AipFeedbackItem;
  onReply: (item: AipFeedbackItem) => void;
  replyDisabled: boolean;
  showReplyButton?: boolean;
  highlighted?: boolean;
}) {
  const isHidden = item.isHidden === true;
  const isNested = item.parentFeedbackId !== null;
  const shouldShowKindBadge = item.kind !== "lgu_note";
  const authorInitial = item.author.fullName.trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      data-feedback-id={item.id}
      data-hidden-comment={isHidden ? "true" : "false"}
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        isHidden ? "border-slate-300 bg-slate-50/80" : "border-slate-200"
      } ${highlighted ? "border-sky-300 ring-2 ring-sky-200" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B6676] text-sm font-semibold text-white">
            {authorInitial}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[1.05rem] font-semibold leading-none text-slate-900">{item.author.fullName}</p>
              <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {item.author.lguLabel}
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">{formatFeedbackTimestamp(item.createdAt)}</p>
      </div>

      {shouldShowKindBadge ? (
        <div className="mt-3">
          <Badge variant="outline" className={`rounded-full ${KIND_BADGE_CLASSES[item.kind]}`}>
            {KIND_LABELS[item.kind]}
          </Badge>
        </div>
      ) : null}

      {isHidden ? (
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Hidden comment
        </p>
      ) : null}

      <p
        className={`mt-3 whitespace-pre-wrap text-sm leading-6 ${
          isHidden ? "text-slate-500 italic" : "text-slate-700"
        }`}
      >
        {item.body}
      </p>

      {isHidden && (item.hiddenReason || item.violationCategory) ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {item.hiddenReason ? <div>Reason: {item.hiddenReason}</div> : null}
          {item.violationCategory ? <div>Violation Category: {item.violationCategory}</div> : null}
        </div>
      ) : null}

      {showReplyButton === false || isHidden || isNested ? null : (
        <div className="mt-4 flex items-center gap-4">
          <p className="text-[11px] text-slate-400">
            • {formatFeedbackTimestamp(item.createdAt)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-xs font-semibold text-slate-700 hover:bg-transparent hover:text-slate-900"
            aria-label={`Reply to feedback from ${item.author.fullName}`}
            onClick={() => onReply(item)}
            disabled={replyDisabled}
          >
            Reply
          </Button>
        </div>
      )}
    </article>
  );
}

function ThreadList({
  threads,
  postingReplyRootId,
  isPostingRoot,
  isAuthLoading,
  replyComposer,
  onReply,
  onCancelReply,
  onSubmitReply,
  readOnly,
  selectedThreadId,
  selectedFeedbackId,
  setThreadRef,
  setFeedbackRef,
  threadTestId,
}: {
  threads: AipFeedbackThread[];
  postingReplyRootId: string | null;
  isPostingRoot: boolean;
  isAuthLoading: boolean;
  replyComposer: ReplyComposerState | null;
  onReply: (item: AipFeedbackItem) => void;
  onCancelReply: () => void;
  onSubmitReply: (input: { kind: CitizenProjectFeedbackKind; body: string }) => Promise<void>;
  readOnly?: boolean;
  selectedThreadId?: string | null;
  selectedFeedbackId?: string | null;
  setThreadRef?: (threadId: string) => (node: HTMLDivElement | null) => void;
  setFeedbackRef?: (feedbackId: string) => (node: HTMLDivElement | null) => void;
  threadTestId?: string;
}) {
  if (threads.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => {
        const isPostingReply = postingReplyRootId === thread.root.id;
        const isReplyingHere = replyComposer?.rootId === thread.root.id;
        const isSelectedThread = selectedThreadId === thread.root.id;
        const isRootFeedbackSelected = selectedFeedbackId === thread.root.id;

        return (
          <div
            key={thread.root.id}
            ref={setThreadRef?.(thread.root.id)}
            data-testid={threadTestId}
            className={`space-y-3 rounded-2xl border border-slate-200 p-4 ${
              isSelectedThread ? "border-sky-300 ring-2 ring-sky-200" : ""
            }`}
            data-thread-id={thread.root.id}
          >
            <div ref={setFeedbackRef?.(thread.root.id)}>
              <FeedbackCard
                item={thread.root}
                onReply={onReply}
                replyDisabled={readOnly || isPostingReply || isPostingRoot || isAuthLoading}
                showReplyButton={!readOnly}
                highlighted={isRootFeedbackSelected}
              />
            </div>

            {thread.replies.length > 0 ? (
              <div className="ml-4 space-y-3 border-l border-slate-200 pl-4">
                {thread.replies.map((reply) => {
                  const isReplySelected = selectedFeedbackId === reply.id;
                  return (
                    <div key={reply.id} ref={setFeedbackRef?.(reply.id)}>
                      <FeedbackCard
                        item={reply}
                        onReply={onReply}
                        replyDisabled={readOnly || isPostingReply || isPostingRoot || isAuthLoading}
                        showReplyButton={!readOnly}
                        highlighted={isReplySelected}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}

            {isReplyingHere && !readOnly ? (
              <div className="ml-4 space-y-2 border-l border-slate-200 pl-4">
                <p className="text-xs text-slate-500">
                  Replying to {replyComposer?.replyToAuthor}
                </p>
                <FeedbackComposer
                  submitLabel={isPostingReply ? "Posting..." : "Post reply"}
                  disabled={isPostingReply}
                  placeholder="Write your reply..."
                  initialKind="question"
                  onSubmit={onSubmitReply}
                  onCancel={onCancelReply}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function AipFeedbackTab({ aipId, feedbackCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedThreadId = readSearchParam(searchParams, "thread");
  const selectedFeedbackId = readSearchParam(searchParams, "comment");
  const [isAuthLoading, setIsAuthLoading] = React.useState(true);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [items, setItems] = React.useState<AipFeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isPostingRoot, setIsPostingRoot] = React.useState(false);
  const [postingReplyRootId, setPostingReplyRootId] = React.useState<string | null>(null);
  const [replyComposer, setReplyComposer] = React.useState<ReplyComposerState | null>(null);
  const [isBlocked, setIsBlocked] = React.useState(false);
  const [blockedUntil, setBlockedUntil] = React.useState<string | null>(null);
  const [blockedReason, setBlockedReason] = React.useState<string | null>(null);
  const threadRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const feedbackRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const setThreadRef = React.useCallback(
    (threadId: string) => (node: HTMLDivElement | null) => {
      threadRefs.current.set(threadId, node);
    },
    []
  );
  const setFeedbackRef = React.useCallback(
    (feedbackId: string) => (node: HTMLDivElement | null) => {
      feedbackRefs.current.set(feedbackId, node);
    },
    []
  );

  const currentDetailPath = React.useMemo(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    return `${path}#feedback`;
  }, [pathname, searchParams]);

  const redirectToCitizenSignIn = React.useCallback(() => {
    router.push(buildFeedbackSignInHref(currentDetailPath));
  }, [currentDetailPath, router]);

  const loadFeedback = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listAipFeedback(aipId);
      setItems(response.items);
    } catch (error) {
      setLoadError(normalizeAipFeedbackApiError(error, "Failed to load AIP feedback."));
    } finally {
      setLoading(false);
    }
  }, [aipId]);

  React.useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  React.useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();

    async function refreshAuthState(force = false) {
      const statusResult = await getCitizenProfileStatus({ force });
      if (!active) return;

      if (statusResult.kind === "anonymous" || statusResult.kind === "error") {
        setIsAuthenticated(false);
        setIsBlocked(false);
        setBlockedUntil(null);
        setBlockedReason(null);
        setIsAuthLoading(false);
        return;
      }

      setIsAuthenticated(true);
      setIsBlocked(statusResult.isBlocked);
      setBlockedUntil(statusResult.blockedUntil);
      setBlockedReason(
        typeof statusResult.blockedReason === "string" && statusResult.blockedReason.trim().length > 0
          ? statusResult.blockedReason.trim()
          : null
      );
      setIsAuthLoading(false);
    }

    void refreshAuthState(false);

    const cleanupAuthChanged = addCitizenAuthChangedListener(() => {
      invalidateCitizenProfileStatusCache();
      void refreshAuthState(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      invalidateCitizenProfileStatusCache();
      if (!session?.user?.id) {
        setIsAuthenticated(false);
        setIsBlocked(false);
        setBlockedUntil(null);
        setBlockedReason(null);
        setIsAuthLoading(false);
        return;
      }
      void refreshAuthState(true);
    });

    return () => {
      active = false;
      cleanupAuthChanged();
      listener.subscription.unsubscribe();
    };
  }, []);

  const threads = React.useMemo(() => groupFeedbackThreads(items), [items]);
  const citizenThreads = React.useMemo(
    () => threads.filter((thread) => thread.root.author.role === "citizen"),
    [threads]
  );
  const workflowThreads = React.useMemo(
    () => threads.filter((thread) => thread.root.author.role !== "citizen"),
    [threads]
  );

  React.useEffect(() => {
    if (isBlocked) {
      setReplyComposer(null);
    }
  }, [isBlocked]);

  React.useEffect(() => {
    const node = selectedFeedbackId
      ? feedbackRefs.current.get(selectedFeedbackId)
      : selectedThreadId
        ? threadRefs.current.get(selectedThreadId)
        : null;
    if (!node) return;
    requestAnimationFrame(() => {
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [selectedFeedbackId, selectedThreadId, citizenThreads, workflowThreads]);

  const handleReplyClick = React.useCallback(
    (item: AipFeedbackItem) => {
      if (!isAuthenticated) {
        redirectToCitizenSignIn();
        return;
      }
      if (isBlocked) {
        return;
      }

      const rootId = item.parentFeedbackId ?? item.id;
      setReplyComposer({
        rootId,
        parentFeedbackId: item.id,
        replyToAuthor: item.author.fullName,
      });
    },
    [isAuthenticated, isBlocked, redirectToCitizenSignIn]
  );

  const handleCreateRootFeedback = React.useCallback(
    async (input: { kind: CitizenProjectFeedbackKind; body: string }) => {
      if (!isAuthenticated) {
        redirectToCitizenSignIn();
        throw new Error("Please sign in to post feedback.");
      }
      if (isBlocked) {
        throw new Error("Your account is currently blocked from posting feedback.");
      }

      setIsPostingRoot(true);
      const optimisticId = `temp_root_${Date.now()}`;
      const optimisticItem: AipFeedbackItem = {
        id: optimisticId,
        aipId,
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
        const response = await createCitizenAipFeedback(aipId, input);
        setItems((current) =>
          current.map((item) => (item.id === optimisticId ? response.item : item))
        );
      } catch (error) {
        setItems((current) => current.filter((item) => item.id !== optimisticId));
        if (error instanceof AipFeedbackRequestError && error.status === 401) {
          redirectToCitizenSignIn();
        }
        throw new Error(normalizeAipFeedbackApiError(error, "Failed to post feedback."));
      } finally {
        setIsPostingRoot(false);
      }
    },
    [aipId, isAuthenticated, isBlocked, redirectToCitizenSignIn]
  );

  const handleCreateReplyFeedback = React.useCallback(
    async (input: { kind: CitizenProjectFeedbackKind; body: string }) => {
      if (!replyComposer) {
        throw new Error("Reply target is missing.");
      }
      if (!isAuthenticated) {
        redirectToCitizenSignIn();
        throw new Error("Please sign in to post a reply.");
      }
      if (isBlocked) {
        throw new Error("Your account is currently blocked from posting feedback.");
      }

      setPostingReplyRootId(replyComposer.rootId);
      const optimisticId = `temp_reply_${Date.now()}`;
      const optimisticReply: AipFeedbackItem = {
        id: optimisticId,
        aipId,
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
        const response = await createCitizenAipFeedbackReply(aipId, {
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
        if (error instanceof AipFeedbackRequestError && error.status === 401) {
          redirectToCitizenSignIn();
        }
        throw new Error(normalizeAipFeedbackApiError(error, "Failed to post reply."));
      } finally {
        setPostingReplyRootId(null);
      }
    },
    [aipId, isAuthenticated, isBlocked, redirectToCitizenSignIn, replyComposer]
  );

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-3xl text-slate-900">Citizen Feedback</CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-lg text-slate-600">Public citizen feedback for this AIP.</p>
          <p className="text-xs text-slate-500">Published threads: {feedbackCount}</p>

          {!isAuthenticated ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-6 py-10">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                  <MessageSquare className="h-7 w-7" aria-hidden="true" />
                </div>
                <p className="text-2xl font-semibold text-slate-900">Login Required</p>
                <p className="mt-2 text-sm text-slate-500">Please login to add feedback</p>
                <Button
                  type="button"
                  onClick={redirectToCitizenSignIn}
                  disabled={isAuthLoading}
                  className="mt-5 bg-[#03455f] px-6 hover:bg-[#02384d]"
                >
                  Login
                </Button>
              </div>
            </div>
          ) : isBlocked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">
                Your account is temporarily blocked from posting feedback.
              </p>
              <p className="mt-1">Blocked until: {formatBlockedUntilLabel(blockedUntil)}</p>
              <p className="mt-1">Reason: {blockedReason ?? "Policy violation"}</p>
            </div>
          ) : (
            <FeedbackComposer
              submitLabel={isPostingRoot ? "Posting..." : "Post feedback"}
              disabled={isPostingRoot}
              placeholder="Share your thoughts about this AIP."
              onSubmit={handleCreateRootFeedback}
            />
          )}

          {loading ? (
            <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : null}
          {!loading && loadError ? <p className="text-sm text-rose-600">{loadError}</p> : null}

          {!loading && !loadError && citizenThreads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
              No citizen feedback yet. Be the first to share a commendation, suggestion, concern, or question.
            </div>
          ) : null}

          {!loading && !loadError ? (
            <ThreadList
              threads={citizenThreads}
              postingReplyRootId={postingReplyRootId}
              isPostingRoot={isPostingRoot}
              isAuthLoading={isAuthLoading || isBlocked}
              replyComposer={replyComposer}
              onReply={handleReplyClick}
              onCancelReply={() => setReplyComposer(null)}
              onSubmitReply={handleCreateReplyFeedback}
              readOnly={isBlocked}
              selectedThreadId={selectedThreadId}
              selectedFeedbackId={selectedFeedbackId}
              setThreadRef={setThreadRef}
              setFeedbackRef={setFeedbackRef}
              threadTestId="citizen-feedback-thread"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-3xl text-slate-900">LGU Workflow Feedback</CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-lg text-slate-600">
            Official workflow feedback from the AIP submission and review process.
          </p>

          {loading ? (
            <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : null}
          {!loading && loadError ? <p className="text-sm text-rose-600">{loadError}</p> : null}

          {!loading && !loadError && workflowThreads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
              No workflow feedback available for this AIP yet.
            </div>
          ) : null}

          {!loading && !loadError ? (
            <ThreadList
              threads={workflowThreads}
              postingReplyRootId={null}
              isPostingRoot={false}
              isAuthLoading={isAuthLoading}
              replyComposer={null}
              onReply={() => {
                // Read-only workflow container
              }}
              onCancelReply={() => {
                // Read-only workflow container
              }}
              onSubmitReply={async () => {
                // Read-only workflow container
              }}
              readOnly
              selectedThreadId={selectedThreadId}
              selectedFeedbackId={selectedFeedbackId}
              setThreadRef={setThreadRef}
              setFeedbackRef={setFeedbackRef}
              threadTestId="workflow-feedback-thread"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
