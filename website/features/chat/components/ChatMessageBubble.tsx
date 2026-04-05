"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import {
  formatEvidenceDisplayLine,
  isSystemEvidenceCitation,
  isTotalsEvidenceCitation,
} from "@/lib/chat/evidence-display";
import { cn } from "@/lib/ui/utils";
import type { ChatMessageBubble as ChatMessageBubbleType } from "../types/chat.types";
import type { ChatCitation } from "@/lib/repos/chat/types";

type LguRouteScope = "barangay" | "city";

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildCitationProjectHref(citation: ChatCitation, routeScope: LguRouteScope | null): string | null {
  if (!routeScope) return null;
  const aipId = normalizeText(citation.aipId) ?? "";
  const projectId = normalizeText(citation.projectId) ?? "";
  if (!aipId || !projectId) return null;

  return `/${routeScope}/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(projectId)}`;
}

function buildCitationAipTotalsHref(citation: ChatCitation, routeScope: LguRouteScope | null): string | null {
  if (!routeScope) return null;
  const metadata =
    citation.metadata && typeof citation.metadata === "object" && !Array.isArray(citation.metadata)
      ? (citation.metadata as Record<string, unknown>)
      : null;
  const aipId = normalizeText(citation.aipId) ?? normalizeText(metadata?.aip_id) ?? "";
  if (!aipId) return null;
  return `/${routeScope}/aips/${encodeURIComponent(aipId)}`;
}

export default function ChatMessageBubble({
  message,
  routeScope = null,
}: {
  message: ChatMessageBubbleType;
  routeScope?: LguRouteScope | null;
}) {
  const isUser = message.role === "user";
  const resolvedStatus =
    message.retrievalMeta?.status ??
    (message.retrievalMeta?.refused ? "refusal" : "answer");
  const visibleCitations = message.citations.filter(
    (citation) => !isSystemEvidenceCitation(citation)
  );

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

        {!isUser && visibleCitations.length > 0 && (
          <details data-testid="chat-evidence-details" className="group mt-3 rounded-md border bg-background px-2 py-2">
            <summary
              data-testid="chat-evidence-summary"
              className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold text-muted-foreground"
            >
              <span>Evidence ({visibleCitations.length})</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-2 space-y-2 border-t pt-2">
              {visibleCitations.map((citation, index) => {
                const citationProjectHref = buildCitationProjectHref(citation, routeScope);
                const citationTotalsHref = buildCitationAipTotalsHref(citation, routeScope);
                const shouldRenderProjectLink =
                  typeof citationProjectHref === "string" &&
                  citationProjectHref.length > 0;
                const shouldRenderTotalsLink =
                  !shouldRenderProjectLink &&
                  isTotalsEvidenceCitation(citation) &&
                  typeof citationTotalsHref === "string" &&
                  citationTotalsHref.length > 0;
                const citationHref = shouldRenderProjectLink
                  ? citationProjectHref
                  : shouldRenderTotalsLink
                    ? citationTotalsHref
                    : null;
                const displayLine = formatEvidenceDisplayLine(citation, index);

                return (
                  <div
                    key={`${message.id}:${citation.sourceId}:${citation.chunkId ?? "chunk"}`}
                    className="rounded-md border bg-background px-2 py-1.5"
                  >
                    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[12px] leading-snug">
                      {citationHref ? (
                        <Link
                          href={citationHref}
                          className="text-[#0247A1] underline decoration-[#0247A1]/60 underline-offset-2 hover:decoration-[#0247A1]"
                        >
                          {displayLine}
                        </Link>
                      ) : (
                        displayLine
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
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
