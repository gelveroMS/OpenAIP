import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import Link from "next/link";
import type { AipSubmissionRow } from "@/lib/repos/submissions/repo";
import {
  getAipStatusBadgeClass,
  getAipStatusLabel,
} from "../presentation/submissions.presentation";

interface SubmissionTableProps {
  aips: AipSubmissionRow[];
}

const getTimeSince = (dateStr: string) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Unknown";
  
  const now = Date.now();
  const diffInMs = now - date.getTime();
  
  if (diffInMs < 0) return "just now";  
  const seconds = Math.floor(diffInMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (seconds > 0) return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
  
  return "just now";
};

function formatDateSubmitted(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function SubmissionTable({ aips }: SubmissionTableProps) {
  return (
    <Card className="min-w-0 border-slate-200">
      <CardContent className="px-4 py-4 sm:p-6">
        <h2 className="mb-4 break-words text-base font-semibold text-slate-900 sm:mb-6 sm:text-lg">Submitted AIP Lists</h2>

        <div className="max-w-full overflow-x-auto rounded-lg border border-slate-100 [scrollbar-width:thin]">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Barangay
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Date Submitted
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Assigned Reviewer
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Duration
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {aips.map((aip, index) => (
                <tr
                  key={aip.id ?? `aip-${index}`}
                  data-testid={`city-submission-row-${aip.id ?? index}`}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-3 text-sm text-slate-900 sm:px-4 sm:py-4">
                    {aip.barangayName || "Barangay"}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600 sm:px-4 sm:py-4">
                    {formatDateSubmitted(aip.uploadedAt)}
                  </td>
                  <td className="px-3 py-3 sm:px-4 sm:py-4">
                    <Badge
                      data-testid={`city-submission-status-badge-${aip.id ?? index}`}
                      variant="outline"
                      className={`rounded-full ${getAipStatusBadgeClass(aip.status)}`}
                    >
                      {getAipStatusLabel(aip.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600 sm:px-4 sm:py-4">
                    {aip.reviewerName ?? "Not yet assigned"}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600 sm:px-4 sm:py-4">
                    {getTimeSince(aip.uploadedAt)}
                  </td>
                  <td className="px-3 py-3 sm:px-4 sm:py-4">
                    {(() => {
                      const isPending = aip.status === "pending_review";
                      const isUnderReview = aip.status === "under_review";
                      const href = isPending
                        ? `/city/submissions/aip/${aip.id}?mode=review&intent=review`
                        : isUnderReview
                          ? `/city/submissions/aip/${aip.id}?mode=review`
                          : `/city/submissions/aip/${aip.id}`;
                      const label = isPending
                        ? "Review"
                        : isUnderReview
                          ? "Continue Review"
                          : "View";

                      return (
                    <Button
                      data-testid={`city-submission-action-${aip.id ?? index}`}
                      variant={isPending ? "default" : "outline"}
                      size="sm"
                      className={
                        isPending
                          ? "h-8 gap-1.5 bg-teal-600 px-2.5 text-xs text-white hover:bg-teal-700 sm:h-9 sm:gap-2 sm:px-3 sm:text-sm"
                          : "h-8 gap-1.5 px-2.5 text-xs sm:h-9 sm:gap-2 sm:px-3 sm:text-sm"
                      }
                      asChild
                    >
                      <Link href={href}>
                        <Eye className="h-4 w-4" />
                        {label}
                      </Link>
                    </Button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
