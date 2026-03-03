import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, FileUp, AlertTriangle } from "lucide-react";
import type { DashboardAip } from "@/features/dashboard/types/dashboard-types";

function formatStatusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-muted-foreground border-border",
  pending_review: "bg-accent text-foreground border-border",
  under_review: "bg-info-soft text-foreground border-border",
  for_revision: "bg-warning-soft text-foreground border-border",
  published: "bg-[color:var(--color-success-soft)] text-[color:var(--color-success)] border-border",
};

const STATUS_PIE_COLORS: Record<string, string> = {
  pending_review: "#EAB308",
  under_review: "#3B82F6",
  for_revision: "#F97316",
  published: "#22C55E",
  draft: "#94A3B8",
};

export function AipCoverageCard({ selectedAip }: { selectedAip: DashboardAip | null }) {
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardHeader className="p-5 pb-0"><CardTitle className="text-lg font-medium text-foreground">AIP Coverage</CardTitle></CardHeader>
      <CardContent className="p-5">
        {selectedAip ? (
          <div className="h-[101px] rounded-lg border border-border bg-card p-4 text-sm">
            <div className="text-muted-foreground">FY {selectedAip.fiscalYear}</div>
            <Badge className={`mt-2 w-fit border text-xs font-medium ${STATUS_STYLES[selectedAip.status] ?? STATUS_STYLES.draft}`}>{formatStatusLabel(selectedAip.status)}</Badge>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-[101px] rounded-lg border border-border bg-[color:var(--color-warning-soft)] p-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium text-foreground">Missing AIP</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">No AIP uploaded for selected year.</div>
            </div>
            <Button className="h-10 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" size="sm">
              <FileUp className="mr-2 h-4 w-4" />
              Upload City AIP
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function AipsByYearTable({
  rows,
  basePath,
}: {
  rows: DashboardAip[];
  basePath: "/barangay" | "/city";
}) {
  const yearRows = Array.from(new Set(rows.map((row) => row.fiscalYear)))
    .sort((left, right) => right - left)
    .map((year) => {
      const aip = rows
        .filter((row) => row.fiscalYear === year)
        .sort(
          (left, right) =>
            new Date(right.uploadedDate ?? right.statusUpdatedAt).getTime() -
            new Date(left.uploadedDate ?? left.statusUpdatedAt).getTime()
        )[0] ?? null;

      return { year, aip };
    });

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardHeader className="pt-3"><CardTitle className="text-lg font-medium text-foreground">AIPs by Year</CardTitle></CardHeader>
      <CardContent className="pb-5 space-y-2">
        <div className="grid grid-cols-[72px_140px_1fr_120px_auto] rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground"><span>Year</span><span>Status</span><span>Uploaded By</span><span>Upload Date</span><span className="text-right">Action</span></div>
        {yearRows.map(({ year, aip }) => (
          <div key={year} className="grid h-8 grid-cols-[72px_140px_1fr_120px_auto] items-center border-b border-border px-3 text-sm hover:bg-accent">
            <span className="font-medium tabular-nums truncate">{year}</span>
            <Badge
              className={`w-fit border text-xs font-medium ${
                aip?.status === "published"
                  ? STATUS_STYLES.published
                  : aip
                    ? "bg-secondary text-muted-foreground border-border"
                    : "bg-secondary text-muted-foreground border-border"
              }`}
            >
              {aip ? (aip.status === "published" ? "Published" : formatStatusLabel(aip.status)) : "None"}
            </Badge>
            <span className="truncate text-muted-foreground">{aip?.uploadedBy ?? "None"}</span>
            <span className="truncate tabular-nums text-muted-foreground">
              {aip ? formatDate(aip.uploadedDate ?? aip.statusUpdatedAt) : "None"}
            </span>
            {aip ? (
              <Button asChild size="sm" variant="ghost" className="justify-self-end text-primary hover:underline">
                <Link href={`${basePath}/aips/${aip.id}`}>
                  <Eye className="mr-1 h-4 w-4" />
                  View
                </Link>
              </Button>
            ) : (
              <span className="justify-self-end text-xs text-muted-foreground">None</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AipStatusColumn({
  statusDistribution,
  pendingReviewAging,
}: {
  statusDistribution: Array<{ status: string; count: number }>;
  pendingReviewAging: Array<{ bucket: string; count: number }>;
}) {
  const maxAgingCount = Math.max(1, ...pendingReviewAging.map((bucket) => bucket.count));
  const agingAxisMax = Math.max(2, maxAgingCount);

  return (
    <div className="space-y-4">
      <StatusDistributionCard statusDistribution={statusDistribution} />

      <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
        <CardHeader className="p-5 pb-0"><CardTitle className="text-sm font-medium text-foreground">Pending Review Aging</CardTitle></CardHeader>
        <CardContent className="p-5 text-sm">
          <div className="border border-dashed border-border rounded-lg p-3 space-y-2">
            {pendingReviewAging.map((item) => (
              <div key={item.bucket} className="grid grid-cols-[44px_1fr] items-center gap-2">
                <span className="text-muted-foreground leading-tight">
                  {item.bucket}
                  <br />
                  days
                </span>
                <div className="h-7 rounded-sm bg-secondary">
                  <div className="h-7 rounded-sm bg-chart-1" style={{ width: `${Math.max(0, Math.min(100, (item.count / agingAxisMax) * 100))}%` }} />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-5 text-xs text-muted-foreground pt-1 tabular-nums">
              <span className="text-left">0</span>
              <span className="text-center">{(agingAxisMax * 0.25).toFixed(1)}</span>
              <span className="text-center">{(agingAxisMax * 0.5).toFixed(0)}</span>
              <span className="text-center">{(agingAxisMax * 0.75).toFixed(1)}</span>
              <span className="text-right">{agingAxisMax}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function StatusDistributionCard({
  statusDistribution,
}: {
  statusDistribution: Array<{ status: string; count: number }>;
}) {
  const totalStatusCount = statusDistribution.reduce((sum, item) => sum + item.count, 0);
  const pieStops = statusDistribution.reduce(
    (acc, item) => {
      if (item.count <= 0) return acc;
      const start = acc.cursor;
      const slice = totalStatusCount > 0 ? (item.count / totalStatusCount) * 100 : 0;
      const end = start + slice;
      acc.parts.push(`${STATUS_PIE_COLORS[item.status] ?? "#94A3B8"} ${start}% ${end}%`);
      acc.cursor = end;
      return acc;
    },
    { parts: [] as string[], cursor: 0 }
  );
  const pieBackground = pieStops.parts.length > 0 ? `conic-gradient(${pieStops.parts.join(", ")})` : "conic-gradient(#e2e8f0 0 100%)";
  const labelPositionByStatus: Record<string, string> = {
    pending_review: "top-[-20px] left-1/2 -translate-x-1/2 text-center",
    under_review: "left-[-86px] top-[120px] text-left",
    for_revision: "right-[-80px] top-[122px] text-left",
    published: "right-[-76px] top-[74px] text-left",
    draft: "left-[-74px] top-[74px] text-left",
  };

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardHeader className="p-5 pb-0"><CardTitle className="text-sm font-medium text-foreground">Status Distribution</CardTitle></CardHeader>
      <CardContent className="p-5 space-y-2 text-sm">
        <div className="flex justify-center">
          <div className="relative h-44 w-44 rounded-full" style={{ background: pieBackground }}>
            {statusDistribution
              .filter((item) => item.count > 0)
              .map((item) => {
                const percentage = totalStatusCount > 0 ? Math.round((item.count / totalStatusCount) * 100) : 0;
                return (
                  <div
                    key={item.status}
                    className={`absolute text-xs leading-tight ${labelPositionByStatus[item.status] ?? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
                    style={{ color: STATUS_PIE_COLORS[item.status] ?? "#64748B" }}
                  >
                    {formatStatusLabel(item.status)}:
                    <br />
                    {percentage}%
                  </div>
                );
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
