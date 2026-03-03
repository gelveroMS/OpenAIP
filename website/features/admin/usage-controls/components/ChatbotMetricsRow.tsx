"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, MessageCircle, AlertTriangle, Activity } from "lucide-react";
import type { ChatbotMetrics } from "@/lib/repos/usage-controls/types";

const formatNumber = (value: number) => value.toLocaleString("en-US");

const formatPercent = (value: number) => `${value.toFixed(2)}%`;
const shouldShowTrend = (value: number) => Number(value.toFixed(1)) !== 100;

const trendStyle = (value: number) =>
  value >= 0
    ? "bg-emerald-50 text-emerald-600"
    : "bg-rose-50 text-rose-600";

const trendIcon = (value: number) =>
  value >= 0 ? (
    <ArrowUpRight className="h-3.5 w-3.5" />
  ) : (
    <ArrowDownRight className="h-3.5 w-3.5" />
  );

export default function ChatbotMetricsRow({
  metrics,
  loading,
}: {
  metrics: ChatbotMetrics | null;
  loading: boolean;
}) {
  if (loading || !metrics) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((idx) => (
          <Card key={idx} className="border-slate-200">
            <CardContent className="p-5">
              <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-slate-200">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-500">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div className="text-xs">Total Requests</div>
            </div>
            {shouldShowTrend(metrics.trendTotalRequestsPct) && (
              <div
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${trendStyle(metrics.trendTotalRequestsPct)}`}
              >
                {trendIcon(metrics.trendTotalRequestsPct)}
                {metrics.trendTotalRequestsPct.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="mt-3 text-2xl font-semibold text-slate-900">
            {formatNumber(metrics.totalRequests)}
          </div>
          <div className="text-xs text-slate-500">
            Selected period: {metrics.periodDays} days
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-500">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="text-xs">Error Rate</div>
            </div>
            {shouldShowTrend(metrics.trendErrorRatePct) && (
              <div
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${trendStyle(metrics.trendErrorRatePct)}`}
              >
                {trendIcon(metrics.trendErrorRatePct)}
                {metrics.trendErrorRatePct.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="mt-3 text-2xl font-semibold text-slate-900">
            {formatPercent(metrics.errorRate * 100)}
          </div>
          <div className="text-xs text-slate-500">Average across period</div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-500">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                <Activity className="h-4 w-4" />
              </div>
              <div className="text-xs">Avg Daily Requests</div>
            </div>
            {shouldShowTrend(metrics.trendAvgDailyPct) && (
              <div
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${trendStyle(metrics.trendAvgDailyPct)}`}
              >
                {trendIcon(metrics.trendAvgDailyPct)}
                {metrics.trendAvgDailyPct.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="mt-3 text-2xl font-semibold text-slate-900">
            {Math.round(metrics.avgDailyRequests)}
          </div>
          <div className="text-xs text-slate-500">Per day average</div>
        </CardContent>
      </Card>
    </div>
  );
}
