"use client";

import Link from "next/link";
import { formatMatchMetric } from "@/lib/chat/match-metric";
import { cn } from "@/lib/ui/utils";
import type { ChatMessageBubble as ChatMessageBubbleType } from "../types/chat.types";
import type { ChatCitation } from "@/lib/repos/chat/types";

type LguRouteScope = "barangay" | "city";

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCitationMetadata(citation: ChatCitation): Record<string, unknown> {
  if (!citation.metadata || typeof citation.metadata !== "object" || Array.isArray(citation.metadata)) {
    return {};
  }
  return citation.metadata as Record<string, unknown>;
}

function isAipTotalsCitation(citation: ChatCitation): boolean {
  const metadata = normalizeCitationMetadata(citation);
  const type = normalizeText(metadata.type)?.toLowerCase() ?? null;
  if (type === "aip_totals") return true;
  const aggregateType = normalizeText(metadata.aggregate_type)?.toLowerCase() ?? null;
  return type === "aip_line_items" && aggregateType === "total_investment_program";
}

function buildCitationProjectHref(citation: ChatCitation, routeScope: LguRouteScope | null): string | null {
  if (!routeScope) return null;
  const aipId = typeof citation.aipId === "string" ? citation.aipId.trim() : "";
  const projectId = typeof citation.projectId === "string" ? citation.projectId.trim() : "";
  if (!aipId || !projectId) return null;

  return `/${routeScope}/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(projectId)}`;
}

function buildCitationProjectLabel(citation: ChatCitation): string | null {
  const lguName = typeof citation.lguName === "string" ? citation.lguName.trim() : "";
  const fiscalYear =
    typeof citation.resolvedFiscalYear === "number"
      ? citation.resolvedFiscalYear
      : typeof citation.fiscalYear === "number"
        ? citation.fiscalYear
        : null;
  const projectTitle = typeof citation.projectTitle === "string" ? citation.projectTitle.trim() : "";

  if (!lguName || fiscalYear === null || !projectTitle) return null;
  return `${lguName} FY ${fiscalYear} ${projectTitle}`;
}

function buildCitationAipTotalsHref(citation: ChatCitation, routeScope: LguRouteScope | null): string | null {
  if (!routeScope) return null;
  const aipId = typeof citation.aipId === "string" ? citation.aipId.trim() : "";
  if (!aipId) return null;
  return `/${routeScope}/aips/${encodeURIComponent(aipId)}`;
}

function buildCitationAipTotalsLabel(citation: ChatCitation): string | null {
  const lguName = typeof citation.lguName === "string" ? citation.lguName.trim() : "";
  const fiscalYear =
    typeof citation.resolvedFiscalYear === "number"
      ? citation.resolvedFiscalYear
      : typeof citation.fiscalYear === "number"
        ? citation.fiscalYear
        : null;
  if (!lguName || fiscalYear === null) return null;
  return `${lguName} FY ${fiscalYear} AIP`;
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
              const citationProjectHref = buildCitationProjectHref(citation, routeScope);
              const citationProjectLabel = buildCitationProjectLabel(citation);
              const citationTotalsHref = buildCitationAipTotalsHref(citation, routeScope);
              const citationTotalsLabel = buildCitationAipTotalsLabel(citation);
              const shouldRenderProjectLink =
                typeof citationProjectHref === "string" &&
                citationProjectHref.length > 0 &&
                typeof citationProjectLabel === "string" &&
                citationProjectLabel.length > 0;
              const shouldRenderTotalsLink =
                !shouldRenderProjectLink &&
                isAipTotalsCitation(citation) &&
                typeof citationTotalsHref === "string" &&
                citationTotalsHref.length > 0 &&
                typeof citationTotalsLabel === "string" &&
                citationTotalsLabel.length > 0;
              const citationHref = shouldRenderProjectLink
                ? citationProjectHref
                : shouldRenderTotalsLink
                  ? citationTotalsHref
                  : null;
              const citationLabel = shouldRenderProjectLink
                ? citationProjectLabel
                : shouldRenderTotalsLink
                  ? citationTotalsLabel
                  : null;

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
                  {citationHref && citationLabel ? (
                    <Link
                      href={citationHref}
                      className="text-[#0247A1] underline decoration-[#0247A1]/60 underline-offset-2 hover:decoration-[#0247A1]"
                    >
                      {citationLabel}
                    </Link>
                  ) : (
                    citation.snippet
                  )}
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
