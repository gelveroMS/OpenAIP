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
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_PIE_COLORS: Record<string, string> = {
  pending_review: "#EAB308",
  under_review: "#3B82F6",
  for_revision: "#F97316",
  published: "#22C55E",
  draft: "#94A3B8",
};

export function AipCoverageCard({
  selectedAip,
  scope,
  fiscalYear,
  createDraftAction,
}: {
  selectedAip: DashboardAip | null;
  scope?: "city" | "barangay";
  fiscalYear?: number;
  createDraftAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardTitle className="text-base font-medium text-foreground sm:text-lg">AIP Coverage</CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {selectedAip ? (
          <div className="min-h-[96px] rounded-lg border border-border bg-card p-4 text-sm">
            <div className="text-muted-foreground">FY {selectedAip.fiscalYear}</div>
            <Badge
              className={`mt-2 w-fit border text-xs font-medium ${STATUS_STYLES[selectedAip.status] ?? STATUS_STYLES.draft}`}
            >
              {formatStatusLabel(selectedAip.status)}
            </Badge>
          </div>
        ) : (
          <MissingAipState scope={scope} fiscalYear={fiscalYear} createDraftAction={createDraftAction} />
        )}
      </CardContent>
    </Card>
  );
}

function MissingAipState({
  scope,
  fiscalYear,
  createDraftAction,
}: {
  scope?: "city" | "barangay";
  fiscalYear?: number;
  createDraftAction?: (formData: FormData) => Promise<void>;
}) {
  const scopeLabel = scope === "barangay" ? "Barangay" : "City";

  return (
    <div className="space-y-3">
      <div className="min-h-[96px] rounded-lg border border-border bg-[color:var(--color-warning-soft)] p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium text-foreground">Missing AIP</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">No AIP uploaded for selected year.</div>
      </div>
      {createDraftAction ? (
        <form action={createDraftAction}>
          {typeof fiscalYear === "number" ? <input type="hidden" name="fiscalYear" value={fiscalYear} /> : null}
          <Button className="h-10 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" size="sm">
            <FileUp className="mr-2 h-4 w-4" />
            Upload {scopeLabel} AIP
          </Button>
        </form>
      ) : (
        <Button className="h-10 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" size="sm" disabled>
          <FileUp className="mr-2 h-4 w-4" />
          Upload {scopeLabel} AIP
        </Button>
      )}
    </div>
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
      <CardHeader className="grid-rows-[auto] items-center gap-0 border-b border-border px-4 py-3 sm:px-5">
        <CardTitle className="leading-none text-base font-medium text-foreground sm:text-lg">AIPs by Year</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm sm:min-w-[620px]">
            <thead>
              <tr className="bg-secondary text-left text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2">Year</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Uploaded By</th>
                <th className="px-3 py-2">Upload Date</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map(({ year, aip }) => (
                <tr key={year} className="border-b border-border hover:bg-accent">
                  <td className="px-3 py-2 font-medium tabular-nums">{year}</td>
                  <td className="px-3 py-2">
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
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{aip?.uploadedBy ?? "None"}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {aip ? formatDate(aip.uploadedDate ?? aip.statusUpdatedAt) : "None"}
                  </td>
                  <td className="px-3 py-2">
                    {aip ? (
                      <Button asChild size="sm" variant="ghost" className="h-auto p-0 text-primary hover:underline">
                        <Link href={`${basePath}/aips/${aip.id}`}>
                          <Eye className="mr-1 h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
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
        <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardTitle className="text-sm font-medium text-foreground">Pending Review Aging</CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm sm:p-5">
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

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardTitle className="text-sm font-medium text-foreground">Status Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 text-sm sm:p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative h-32 w-32 shrink-0 rounded-full sm:h-44 sm:w-44" style={{ background: pieBackground }}>
            <div className="absolute inset-[22%] rounded-full bg-white" />
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-[11px] text-muted-foreground">Total</div>
                <div className="text-lg font-semibold text-foreground sm:text-xl">{totalStatusCount}</div>
              </div>
            </div>
          </div>

          <div className="w-full min-w-0 space-y-2 sm:max-w-[220px]">
            {statusDistribution.map((item) => {
              const percentage = totalStatusCount > 0 ? Math.round((item.count / totalStatusCount) * 100) : 0;
              return (
                <div key={item.status} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_PIE_COLORS[item.status] ?? "#94A3B8" }}
                      aria-hidden
                    />
                    <span className="truncate text-muted-foreground">{formatStatusLabel(item.status)}</span>
                  </div>
                  <span className="shrink-0 font-medium text-foreground">{percentage}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
