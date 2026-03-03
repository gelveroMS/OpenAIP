"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/ui/utils";
import {
  CITIZEN_PROJECT_FEEDBACK_KINDS,
  type ProjectFeedbackItem,
  type ProjectFeedbackThread,
} from "./feedback.types";
import {
  createProjectLguFeedbackReply,
  listProjectFeedback,
  ProjectFeedbackRequestError,
} from "./feedback.api";
import { FeedbackCard } from "./feedback-card";

type ReplyComposerState = {
  rootId: string;
  parentFeedbackId: string;
  replyToAuthor: string;
};

type LguProjectFeedbackThreadProps = {
  projectId: string;
  scope: "barangay" | "city";
  selectedThreadId?: string | null;
};

const EMPTY_STATE_TEXT =
  "No citizen feedback yet. Feedback threads will appear here once citizens post.";

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

function isCitizenRootKind(kind: string) {
  return (CITIZEN_PROJECT_FEEDBACK_KINDS as readonly string[]).includes(kind);
}

function groupFeedbackThreads(items: ProjectFeedbackItem[]): ProjectFeedbackThread[] {
  const roots = sortByCreatedNewestFirst(
    items.filter((item) => item.parentFeedbackId === null && isCitizenRootKind(item.kind))
  );
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

export function LguProjectFeedbackThread({
  projectId,
  scope,
  selectedThreadId,
}: LguProjectFeedbackThreadProps) {
  const [items, setItems] = React.useState<ProjectFeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [postingReplyRootId, setPostingReplyRootId] = React.useState<string | null>(null);
  const [replyComposer, setReplyComposer] = React.useState<ReplyComposerState | null>(null);
  const [replyBody, setReplyBody] = React.useState("");
  const [replyError, setReplyError] = React.useState<string | null>(null);

  const threadRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const setThreadRef = React.useCallback(
    (threadId: string) => (node: HTMLDivElement | null) => {
      threadRefs.current.set(threadId, node);
    },
    []
  );

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

  const threads = React.useMemo(() => groupFeedbackThreads(items), [items]);

  React.useEffect(() => {
    if (!selectedThreadId) return;
    const node = threadRefs.current.get(selectedThreadId);
    if (!node) return;
    requestAnimationFrame(() => {
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [selectedThreadId, threads]);

  const handleReplyClick = React.useCallback((item: ProjectFeedbackItem) => {
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
    const optimisticReply: ProjectFeedbackItem = {
      id: optimisticId,
      projectId,
      parentFeedbackId: replyComposer.rootId,
      kind: "lgu_note",
      isHidden: false,
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
      const response = await createProjectLguFeedbackReply({
        scope,
        projectId,
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
      setReplyError(normalizeApiError(error, "Failed to post reply."));
    } finally {
      setPostingReplyRootId(null);
    }
  }, [projectId, replyBody, replyComposer, scope]);

  if (loading) return <p className="text-sm text-slate-500">Loading feedback...</p>;
  if (loadError) return <p className="text-sm text-rose-600">{loadError}</p>;

  if (threads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
        {EMPTY_STATE_TEXT}
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="LGU project feedback thread">
      {threads.map((thread) => {
        const isPostingReply = postingReplyRootId === thread.root.id;
        const isReplyingHere = replyComposer?.rootId === thread.root.id;
        const isSelected = selectedThreadId === thread.root.id;

        return (
          <div
            key={thread.root.id}
            ref={setThreadRef(thread.root.id)}
            className={cn(
              "space-y-3 rounded-2xl border border-slate-200 bg-white p-4",
              isSelected && "border-sky-300 ring-2 ring-sky-200"
            )}
            data-thread-id={thread.root.id}
            data-thread-selected={isSelected ? "true" : "false"}
          >
            <FeedbackCard
              item={thread.root}
              onReply={handleReplyClick}
              replyDisabled={isPostingReply}
            />

            {thread.replies.length > 0 ? (
              <div className="ml-4 space-y-3 border-l border-slate-200 pl-4">
                {thread.replies.map((reply) => (
                  <FeedbackCard
                    key={reply.id}
                    item={reply}
                    onReply={handleReplyClick}
                    replyDisabled={isPostingReply}
                    isReply
                  />
                ))}
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
