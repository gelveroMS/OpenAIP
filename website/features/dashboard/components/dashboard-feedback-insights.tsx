import { Button } from "@/components/ui/button";
import { FeedbackCategorySummaryChart } from "@/components/chart";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MessageSquare } from "lucide-react";
import type { FeedbackCategorySummaryItem } from "@/lib/constants/feedback-category-summary";
import type { DashboardFeedback } from "@/features/dashboard/types/dashboard-types";

export function FeedbackCategorySummaryCard({
  items,
  fiscalYear,
}: {
  items: FeedbackCategorySummaryItem[];
  fiscalYear: number;
}) {
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardContent className="p-4 sm:p-5">
        <FeedbackCategorySummaryChart
          items={items}
          footerLabel={`${fiscalYear} Data`}
          tone="light"
          className="rounded-lg border border-dashed border-border bg-transparent p-3 sm:p-4"
        />
      </CardContent>
    </Card>
  );
}

export function FeedbackTargetsCard({ targets }: { targets: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...targets.map((target) => target.value));
  const isEmptyState = targets.every((target) => target.value === 0);
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-2 text-base font-medium text-foreground sm:text-lg">Feedback Targets</div>
        <div className="border border-dashed border-border rounded-lg p-4 text-sm text-muted-foreground sm:p-6">
          <div className="grid grid-cols-3 items-end gap-2 border-b border-border pb-1 pt-3 sm:gap-3 sm:pt-4">
            {targets.map((target) => (
              <div key={target.label} className="space-y-2 text-center">
                <div
                  data-testid={`feedback-target-bar-${target.label.toLowerCase()}`}
                  className={`mx-auto w-full max-w-[140px] rounded-t-sm ${isEmptyState ? "bg-slate-300" : "bg-chart-2"}`}
                  style={{ height: `${Math.max(14, Math.round((target.value / max) * 120))}px` }}
                />
                <div className="text-[11px] text-muted-foreground sm:text-xs">{target.label}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RecentFeedbackCard({
  rows,
  replyAction,
}: {
  rows: DashboardFeedback[];
  replyAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-2 text-base font-medium text-foreground sm:text-lg">Recent Feedback</div>
        <div className="max-h-[460px] space-y-3 overflow-auto sm:max-h-[520px]">
          {rows.map((item) => (
            <div key={item.id} className="rounded-lg border border-border bg-secondary p-3 hover:bg-accent">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="truncate text-sm font-medium text-foreground capitalize">{item.kind.replaceAll("_", " ")}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{formatDateTime(item.createdAt)}</div>
              </div>
              <div className="mt-2 text-sm text-foreground line-clamp-2">{item.body}</div>
              <div className="mt-2 text-xs text-muted-foreground">Status: {item.parentFeedbackId ? "Replied" : "Awaiting reply"}</div>
              {replyAction && (
                <form action={replyAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="parentFeedbackId" value={item.id} />
                  <Input name="body" placeholder="Write quick reply..." className="h-10" />
                  <Button type="submit" variant="outline" className="h-10 sm:w-auto">Reply</Button>
                </form>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">No recent citizen feedback.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export function CitizenEngagementPulseColumn({
  selectedFiscalYear,
  feedbackCategorySummary,
  feedbackTargets,
  recentFeedback,
  replyAction,
}: {
  selectedFiscalYear: number;
  newThisWeek: number;
  awaitingReply: number;
  lguNotesPosted: number;
  feedbackCategorySummary: FeedbackCategorySummaryItem[];
  feedbackTargets: Array<{ label: string; value: number }>;
  recentFeedback: DashboardFeedback[];
  replyAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-foreground" />
        <h2 className="text-lg font-semibold text-foreground sm:text-xl">Citizen Engagement Pulse</h2>
      </div>
      <FeedbackCategorySummaryCard items={feedbackCategorySummary} fiscalYear={selectedFiscalYear} />
      <FeedbackTargetsCard targets={feedbackTargets} />
      <RecentFeedbackCard rows={recentFeedback} replyAction={replyAction} />
    </section>
  );
}
