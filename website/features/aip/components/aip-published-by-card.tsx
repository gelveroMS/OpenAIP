"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { AipHeader } from "@/lib/repos/aip/repo";

function formatPublishedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

export function AipPublishedByCard({
  publishedBy,
}: {
  publishedBy: NonNullable<AipHeader["publishedBy"]>;
}) {
  const publisherName =
    typeof publishedBy.reviewerName === "string" && publishedBy.reviewerName.trim().length > 0
      ? publishedBy.reviewerName.trim()
      : publishedBy.reviewerId;

  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-3 px-5">
        <h3 className="text-lg font-bold text-slate-900">Publication Details</h3>
        <div className="space-y-1 text-sm text-slate-700">
          <p>
            <span className="font-medium text-slate-900">Published by:</span> {publisherName}
          </p>
          <p>
            <span className="font-medium text-slate-900">Published on:</span>{" "}
            {formatPublishedDate(publishedBy.createdAt)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
