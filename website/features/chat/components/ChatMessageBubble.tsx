"use client";

import { formatMatchMetric } from "@/lib/chat/match-metric";
import { cn } from "@/lib/ui/utils";
import type { ChatMessageBubble as ChatMessageBubbleType } from "../types/chat.types";

export default function ChatMessageBubble({
  message,
}: {
  message: ChatMessageBubbleType;
}) {
  const isUser = message.role === "user";
  const resolvedStatus =
    message.retrievalMeta?.status ??
    (message.retrievalMeta?.refused ? "refusal" : "answer");

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[92%] rounded-xl px-3.5 py-3 text-[13px] leading-6 md:max-w-[85%] md:px-4 md:text-[13.5px] md:leading-relaxed lg:max-w-130",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.content}
        </div>

        {!isUser && resolvedStatus === "clarification" && (
          <div className="mt-2 rounded-md border border-sky-300/60 bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
            Clarification needed.
          </div>
        )}

        {!isUser && resolvedStatus === "refusal" && (
          <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            Grounded refusal: insufficient or unverified evidence.
          </div>
        )}

        {!isUser &&
          Array.isArray(message.retrievalMeta?.suggestions) &&
          message.retrievalMeta.suggestions.length > 0 && (
            <div className="mt-2 rounded-md border border-muted-foreground/20 bg-background px-2 py-1 text-[11px] text-muted-foreground">
              <div className="font-medium">Try:</div>
              <div className="mt-1 whitespace-pre-line">
                {message.retrievalMeta.suggestions.slice(0, 3).map((suggestion, index) =>
                  `${index + 1}. ${suggestion}`
                ).join("\n")}
              </div>
            </div>
          )}

        {!isUser && message.citations.length > 0 && (
          <div className="mt-3 space-y-2 border-t pt-2">
            {message.citations.map((citation) => {
              const metric = formatMatchMetric({
                distance: citation.distance,
                matchScore: citation.matchScore,
                similarity: citation.similarity,
              });

              return (
                <div key={`${message.id}:${citation.sourceId}:${citation.chunkId ?? "chunk"}`} className="rounded-md border bg-background px-2 py-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
                  <span className="break-words">{citation.sourceId}</span>
                  <span className="break-words">{citation.scopeName ?? "Unknown scope"}</span>
                  <span>{citation.scopeType ?? "unknown"}</span>
                  {typeof citation.fiscalYear === "number" && <span>FY {citation.fiscalYear}</span>}
                  {metric.label && metric.value ? <span>{metric.label} {metric.value}</span> : null}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[12px] leading-snug">
                  {citation.snippet}
                </div>
              </div>
              );
            })}
          </div>
          )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className={cn(isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
            {message.timeLabel}
          </div>
          {isUser && message.deliveryStatus === "pending" && (
            <div className="text-primary-foreground/70">Sending...</div>
          )}
          {isUser && message.deliveryStatus === "failed" && (
            <div className="flex items-center gap-2">
              <div className="text-primary-foreground/80">Failed to send.</div>
              {message.onRetry ? (
                <button
                  type="button"
                  onClick={message.onRetry}
                  className="underline decoration-primary-foreground/60 underline-offset-2 hover:decoration-primary-foreground"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
