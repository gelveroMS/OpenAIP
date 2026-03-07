/**
 * AIP Card Component
 * 
 * Displays a summary card for an Annual Investment Plan (AIP) record.
 * Shows key information including title, description, budget, year, status,
 * and upload/publish dates. The card is clickable and navigates to the detail view.
 * 
 * @module feature/aips/aip-card
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { AipHeader } from "../types";
import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PhilippinePeso,
  TriangleAlert,
} from "lucide-react";
import { formatPeso } from "@/lib/formatting";
import { getAipStatusBadgeClass } from "../utils";
import {
  getAipChatbotReadinessStatus,
  type AipChatbotReadinessKind,
  type AipChatbotReadinessTone,
} from "../lib/chatbot-readiness";

function getChatbotStatusBadgeClass(tone: AipChatbotReadinessTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "warning":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function ChatbotStatusIcon({ kind }: { kind: AipChatbotReadinessKind }) {
  if (kind === "chatbot_ready") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (kind === "embedding") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (kind === "failed") return <TriangleAlert className="h-3.5 w-3.5" />;
  return <CircleDashed className="h-3.5 w-3.5" />;
}

/**
 * AipCard Component
 * 
 * Renders a clickable card displaying AIP summary information.
 * Supports both city and barangay scope for proper routing.
 * 
 * @param aip - The AIP record to display
 * @param scope - The administrative scope (city or barangay) for routing
 */
export default function AipCard({ 
  aip, 
  scope = "barangay" 
}: { 
  aip: AipHeader;
  scope?: "city" | "barangay";
}) {
  const progressValue = aip.processing
    ? Math.min(100, Math.max(0, Math.round(aip.processing.overallProgressPct)))
    : 0;
  const isProcessingCard = Boolean(aip.processing);
  const progressMessage = aip.processing
    ? aip.processing.message ??
      (aip.processing.state === "finalizing"
        ? "Finalizing processed output..."
        : "Processing AIP submission...")
    : null;
  const isSummaryTruncated = Boolean(
    aip.summaryText &&
      typeof aip.description === "string" &&
      aip.summaryText.length > aip.description.length
  );
  const chatbotReadiness =
    aip.status === "published" ? getAipChatbotReadinessStatus(aip.embedding) : null;

  return (
    <Link href={`/${scope}/aips/${aip.id}`} className="block">
      <Card className="cursor-pointer border-slate-200 py-0 transition-all hover:border-slate-300 hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-slate-900 hover:text-[#022437] transition-colors">
                {aip.title}
              </h3>
              {isProcessingCard ? (
                <div className="max-w-md">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span>Overall Progress</span>
                    <span>{progressValue}%</span>
                  </div>
                  <Progress value={progressValue} className="h-2.5" />
                  {progressMessage ? (
                    <p className="text-xs text-slate-500">{progressMessage}</p>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600">
                    {aip.description}
                    {isSummaryTruncated ? (
                      <span className="ml-1 text-xs font-medium text-slate-500">...See More</span>
                    ) : null}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-x-10 gap-y-2 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-400" />
                      <span>AIP Year: {aip.year}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <PhilippinePeso className="h-4 w-4 text-slate-400" />
                      <span>
                        Budget: <span className="font-semibold text-[#022437]">{formatPeso(aip.budget)}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Uploaded:</span>
                      <span>{aip.uploadedAt}</span>
                    </div>

                    {aip.publishedAt ? (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Published:</span>
                        <span>{aip.publishedAt}</span>
                      </div>
                    ) : null}
                  </div>
                  {chatbotReadiness ? (
                    <div className="mt-2">
                      <Badge
                        variant="outline"
                        className={`h-6 gap-1 rounded-full px-2 text-[11px] font-medium ${getChatbotStatusBadgeClass(
                          chatbotReadiness.tone
                        )}`}
                      >
                        <ChatbotStatusIcon kind={chatbotReadiness.kind} />
                        {chatbotReadiness.label}
                      </Badge>
                    </div>
                  ) : null}
                </>
              )}

            </div>

            <Badge variant="outline" className={`rounded-full ${getAipStatusBadgeClass(aip.status)}`}>
              {aip.status}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
