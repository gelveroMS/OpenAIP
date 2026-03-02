import { Button } from "@/components/ui/button";
import { LineGraphCard } from "@/components/chart";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MessageSquare } from "lucide-react";
import type { DashboardFeedback } from "@/features/dashboard/types/dashboard-types";

export function FeedbackTrendCard({ points }: { points: Array<{ dayLabel: string; isoDate: string; count: number }> }) {
  const chartData = points.map((point) => ({
    dayLabel: point.dayLabel,
    count: point.count,
  }));

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardContent className="p-5">
        <div className="mb-2 text-sm font-medium text-foreground">Feedback Trend</div>
        <LineGraphCard
          data={chartData}
          xKey="dayLabel"
          series={[{ key: "count", label: "Feedback", color: "var(--chart-1)" }]}
          className="rounded-lg border border-dashed border-border bg-transparent p-3"
          heightClass="h-56"
        />
      </CardContent>
    </Card>
  );
}

export function FeedbackTargetsCard({ targets }: { targets: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...targets.map((target) => target.value));
  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-0">
      <CardContent className="p-5">
        <div className="mb-2 text-sm font-medium text-foreground">Feedback Targets</div>
        <div className="border border-dashed border-border rounded-lg p-6 text-sm text-muted-foreground">
          <div className="grid grid-cols-3 items-end gap-3 border-b border-border pb-1 pt-4">
            {targets.map((target) => (
              <div key={target.label} className="space-y-2 text-center">
                <div className="mx-auto w-full max-w-[140px] rounded-t-sm bg-chart-2" style={{ height: `${Math.max(16, Math.round((target.value / max) * 120))}px` }} />
                <div className="text-xs text-muted-foreground">{target.label}</div>
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
      <CardContent className="p-5">
        <div className="mb-2 text-sm font-medium text-foreground">Recent Feedback</div>
        <div className="space-y-3 max-h-[520px] overflow-auto">
          {rows.map((item) => (
            <div key={item.id} className="rounded-lg border border-border bg-secondary p-3 hover:bg-accent">
              <div className="flex items-center justify-between">
                <div className="truncate text-sm font-medium text-foreground capitalize">{item.kind.replaceAll("_", " ")}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{formatDateTime(item.createdAt)}</div>
              </div>
              <div className="mt-2 truncate text-sm text-foreground">{item.body}</div>
              <div className="mt-2 text-xs text-muted-foreground">Status: {item.parentFeedbackId ? "Replied" : "Awaiting reply"}</div>
              {replyAction && (
                <form action={replyAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="parentFeedbackId" value={item.id} />
                  <Input name="body" placeholder="Write quick reply..." />
                  <Button type="submit" variant="outline">Reply</Button>
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
  feedbackTrend,
  feedbackTargets,
  recentFeedback,
  replyAction,
}: {
  newThisWeek: number;
  awaitingReply: number;
  lguNotesPosted: number;
  feedbackTrend: Array<{ dayLabel: string; isoDate: string; count: number }>;
  feedbackTargets: Array<{ label: string; value: number }>;
  recentFeedback: DashboardFeedback[];
  replyAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Citizen Engagement Pulse</h2>
      </div>
      <FeedbackTrendCard points={feedbackTrend} />
      <FeedbackTargetsCard targets={feedbackTargets} />
      <RecentFeedbackCard rows={recentFeedback} replyAction={replyAction} />
    </section>
  );
}
