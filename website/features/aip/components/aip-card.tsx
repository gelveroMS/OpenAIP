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
import { CalendarDays, PhilippinePeso } from "lucide-react";
import { formatPeso } from "@/lib/formatting";
import { getAipStatusBadgeClass } from "../utils";

function getEmbeddingStatusLabel(
  embedding: AipHeader["embedding"]
): string | null {
  if (!embedding) return null;
  if (embedding.status === "queued" || embedding.status === "running") {
    return "Indexing for search...";
  }
  if (embedding.status === "succeeded") {
    return "Search index ready";
  }
  if (embedding.status === "failed") {
    return "Indexing failed";
  }
  return null;
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
  const embeddingStatusLabel =
    aip.status === "published" ? getEmbeddingStatusLabel(aip.embedding) : null;

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
                  {embeddingStatusLabel ? (
                    <p className="mt-2 text-xs text-slate-500">{embeddingStatusLabel}</p>
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
