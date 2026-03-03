import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuditActionLabel, getAuditEntityLabel, getAuditRoleLabel } from "@/features/audit/types/audit";
import type { DashboardProjectUpdateLog } from "@/features/dashboard/types/dashboard-types";
import type { ActivityLogRow } from "@/lib/repos/audit/repo";

function formatDateTime(value: string | null): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMetadataString(
  metadata: ActivityLogRow["metadata"],
  key: string
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function RecentActivityFeed({
  logs,
  auditHref,
  compact = false,
}: {
  logs: ActivityLogRow[];
  auditHref: "/barangay/audit" | "/city/audit";
  compact?: boolean;
}) {
  const sortedLogs = [...logs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  return (
    <Card className="bg-card text-card-foreground rounded-xl border border-border py-5">
      <CardHeader>
        <CardTitle className="text-lg font-medium text-foreground">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent
        className={compact
          ? "max-h-[320px] space-y-2 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] px-4"
          : "max-h-[728px] space-y-2 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] px-5"}
      >
        {sortedLogs.map((log) => {
          const actionLabel = getAuditActionLabel(log.action);
          const roleLabel = getAuditRoleLabel(log.actorRole ?? null);
          const actorName = getMetadataString(log.metadata, "actor_name") ?? roleLabel;
          const details =
            getMetadataString(log.metadata, "details") ??
            `${actionLabel} (${getAuditEntityLabel(log.entityType)})`;

          return (
            <div
              key={log.id}
              className={compact
                ? "rounded-lg border border-border bg-secondary p-2.5 hover:bg-accent"
                : "rounded-lg border border-border bg-secondary p-3 hover:bg-accent"}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-semibold text-foreground">{actionLabel}</span>
                <Badge className="rounded-md border border-border bg-card text-muted-foreground">
                  {roleLabel}
                </Badge>
              </div>
              <div className="mt-1 truncate text-sm text-foreground">{details}</div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                {`${actorName} | ${formatDateTime(log.createdAt)}`}
              </div>
            </div>
          );
        })}
        {sortedLogs.length === 0 && (
          <div className="rounded-lg border border-border bg-secondary p-3 text-sm text-muted-foreground">
            No official activity logs yet.
          </div>
        )}
      </CardContent>
      <div className={compact ? "px-4 pt-3" : "px-5 pt-3"}>
        <Button
          asChild
          variant="ghost"
          className="h-auto w-full rounded-lg border border-border bg-card p-3 text-center text-sm text-primary hover:underline"
        >
          <Link href={auditHref}>View Audit and Accountability</Link>
        </Button>
      </div>
    </Card>
  );
}

export function RecentProjectUpdatesCard({
  logs,
}: {
  logs: DashboardProjectUpdateLog[];
}) {
  const sortedLogs = [...logs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  const getTagLabel = (
    action: DashboardProjectUpdateLog["action"]
  ): "Add Information" | "Post Update" => {
    if (action === "project_info_updated") return "Add Information";
    return "Post Update";
  };

  return (
    <Card className="bg-card text-card-foreground rounded-xl border border-border py-0 w-full min-w-0 flex min-h-0 max-h-[418px] flex-col">
      <CardHeader className="shrink-0 p-5 pb-0">
        <CardTitle className="text-lg font-medium text-foreground">Recent Project Updates</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 space-y-2 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] pb-5 pr-4 text-sm">
        {sortedLogs.map((log) => (
          <div
            key={log.id}
            className="w-full rounded-lg border border-border bg-secondary p-3 hover:bg-accent"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 truncate text-sm font-semibold text-foreground">{log.title}</div>
              <Badge className="shrink-0 rounded-md border border-border bg-card text-muted-foreground">
                {getTagLabel(log.action)}
              </Badge>
            </div>
            <div className="mt-1 min-w-0 truncate text-sm text-foreground">
              {log.body || "No description provided."}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {`${log.projectRefCode} | ${log.actorName} | ${formatDateTime(log.createdAt)}`}
            </div>
          </div>
        ))}
        {sortedLogs.length === 0 && (
          <div className="rounded-lg border border-border bg-secondary p-3 text-sm text-muted-foreground">
            No add-information or project-update logs yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
