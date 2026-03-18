"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";
import {
  type AipFeedbackDisplayKind,
  type AipFeedbackItem,
  createScopedAipFeedbackReply,
  listAipFeedback,
  normalizeAipFeedbackApiError,
} from "@/features/citizen/aips/components/aip-feedback.api";

type ReplyComposerState = {
  rootId: string;
  parentFeedbackId: string;
  replyToAuthor: string;
};

type AipFeedbackThread = {
  root: AipFeedbackItem;
  replies: AipFeedbackItem[];
};

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
  const roots = sortByCreatedNewestFirst(
    items.filter((item) => item.parentFeedbackId === null && item.author.role === "citizen")
  );
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

function FeedbackCard({
  item,
  onReply,
  replyDisabled,
  highlighted = false,
}: {
  item: AipFeedbackItem;
  onReply: (item: AipFeedbackItem) => void;
  replyDisabled?: boolean;
  highlighted?: boolean;
}) {
  const isHidden = item.isHidden === true;
  const isNested = item.parentFeedbackId !== null;
  const showKindBadge = item.kind !== "lgu_note";

  return (
    <article
      data-feedback-id={item.id}
      data-hidden-comment={isHidden ? "true" : "false"}
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        isHidden && "border-slate-300 bg-slate-50/80",
        highlighted && "border-sky-300 ring-2 ring-sky-200"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{item.author.fullName}</p>
          <p className="text-xs text-slate-500">
            {item.author.roleLabel} | {item.author.lguLabel}
          </p>
        </div>
        <p className="text-xs text-slate-500">{formatFeedbackTimestamp(item.createdAt)}</p>
      </div>

      {showKindBadge ? (
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

      <p className={cn("mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700", isHidden && "italic text-slate-500")}>
        {item.body}
      </p>

      {isHidden && (item.hiddenReason || item.violationCategory) ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {item.hiddenReason ? <div>Reason: {item.hiddenReason}</div> : null}
          {item.violationCategory ? <div>Violation Category: {item.violationCategory}</div> : null}
        </div>
      ) : null}

      {!isHidden && !isNested ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-slate-600 hover:text-slate-900"
            aria-label={`Reply to feedback from ${item.author.fullName}`}
            onClick={() => onReply(item)}
            disabled={replyDisabled}
          >
            Reply
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function LguAipFeedbackThread({
  aipId,
  scope,
  selectedThreadId,
  selectedFeedbackId,
}: {
  aipId: string;
  scope: "barangay" | "city";
  selectedThreadId?: string | null;
  selectedFeedbackId?: string | null;
}) {
  const [items, setItems] = React.useState<AipFeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [postingReplyRootId, setPostingReplyRootId] = React.useState<string | null>(null);
  const [replyComposer, setReplyComposer] = React.useState<ReplyComposerState | null>(null);
  const [replyBody, setReplyBody] = React.useState("");
  const [replyError, setReplyError] = React.useState<string | null>(null);

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

  const threads = React.useMemo(() => groupFeedbackThreads(items), [items]);

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
  }, [selectedFeedbackId, selectedThreadId, threads]);

  const handleReplyClick = React.useCallback((item: AipFeedbackItem) => {
    const rootId = item.parentFeedbackId ?? item.id;
    setReplyComposer({
      rootId,
      parentFeedbackId: item.id,
      replyToAuthor: item.author.fullName,
    });
    setReplyBody("");
    setReplyError(null);
  }, []);

  const handleCreateReply = React.useCallback(async () => {
    if (!replyComposer) return;

    const normalizedBody = replyBody.trim();
    if (!normalizedBody) {
      setReplyError("Reply content is required.");
      return;
    }

    setReplyError(null);
    setPostingReplyRootId(replyComposer.rootId);

    const optimisticId = `temp_reply_${Date.now()}`;
    const optimisticReply: AipFeedbackItem = {
      id: optimisticId,
      aipId,
      parentFeedbackId: replyComposer.rootId,
      kind: "lgu_note",
      body: normalizedBody,
      createdAt: new Date().toISOString(),
      author: {
        id: null,
        fullName: "You",
        role: scope === "city" ? "city_official" : "barangay_official",
        roleLabel: scope === "city" ? "City Official" : "Barangay Official",
        lguLabel: scope === "city" ? "City of Unknown" : "Brgy. Unknown",
      },
    };

    setItems((current) => [...current, optimisticReply]);

    try {
      const response = await createScopedAipFeedbackReply({
        scope,
        aipId,
        parentFeedbackId: replyComposer.parentFeedbackId,
        body: normalizedBody,
      });

      setItems((current) =>
        current.map((item) => (item.id === optimisticId ? response.item : item))
      );
      setReplyComposer(null);
      setReplyBody("");
      setReplyError(null);
    } catch (error) {
      setItems((current) => current.filter((item) => item.id !== optimisticId));
      setReplyError(normalizeAipFeedbackApiError(error, "Failed to post reply."));
    } finally {
      setPostingReplyRootId(null);
    }
  }, [aipId, replyBody, replyComposer, scope]);

  if (loading) return <p className="text-sm text-slate-500">Loading feedback...</p>;
  if (loadError) return <p className="text-sm text-rose-600">{loadError}</p>;

  if (threads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
        No citizen feedback yet. Feedback threads will appear here once citizens post.
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="LGU AIP feedback thread">
      {threads.map((thread) => {
        const isPostingReply = postingReplyRootId === thread.root.id;
        const isReplyingHere = replyComposer?.rootId === thread.root.id;
        const isSelected = selectedThreadId === thread.root.id;
        const isRootFeedbackSelected = selectedFeedbackId === thread.root.id;

        return (
          <div
            key={thread.root.id}
            ref={setThreadRef(thread.root.id)}
            className="space-y-3"
            data-thread-id={thread.root.id}
            data-thread-selected={isSelected ? "true" : "false"}
          >
            <div ref={setFeedbackRef(thread.root.id)}>
              <FeedbackCard
                item={thread.root}
                onReply={handleReplyClick}
                replyDisabled={isPostingReply}
                highlighted={isRootFeedbackSelected || isSelected}
              />
            </div>

            {thread.replies.length > 0 ? (
              <div className="ml-4 space-y-3 border-l border-slate-200 pl-4">
                {thread.replies.map((reply) => {
                  const isReplySelected = selectedFeedbackId === reply.id;
                  return (
                    <div key={reply.id} ref={setFeedbackRef(reply.id)}>
                      <FeedbackCard
                        item={reply}
                        onReply={handleReplyClick}
                        replyDisabled={isPostingReply}
                        highlighted={isReplySelected}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}

            {isReplyingHere ? (
              <div className="ml-4 space-y-2 border-l border-slate-200 pl-4">
                <p className="text-xs text-slate-500">Replying to {replyComposer.replyToAuthor}</p>
                <Textarea
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  placeholder="Write your response..."
                  className="min-h-[112px]"
                  disabled={isPostingReply}
                />
                {replyError ? <p className="text-sm text-rose-600">{replyError}</p> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setReplyComposer(null);
                      setReplyBody("");
                      setReplyError(null);
                    }}
                    disabled={isPostingReply}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleCreateReply} disabled={isPostingReply}>
                    {isPostingReply ? "Posting..." : "Post reply"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
