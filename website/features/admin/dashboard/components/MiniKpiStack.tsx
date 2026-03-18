"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { UsageMetricsVM } from "@/lib/repos/admin-dashboard/types";
import { formatNumber } from "@/lib/formatting";
import { AlertTriangle, BarChart3, Sigma } from "lucide-react";

function MiniKpiItem({
  title,
  value,
  delta,
  icon,
}: {
  title: string;
  value: string;
  delta: string;
  icon: ReactNode;
}) {
  return (
    <Card className="border-slate-200 py-0 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-slate-50 text-slate-600">
            {icon}
          </div>
          <div className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{delta}</div>
        </div>
        <div className="mt-3 break-words text-3xl font-semibold leading-tight text-slate-900 sm:text-[35px] sm:leading-9">{value}</div>
        <div className="mt-1 text-[13px] text-slate-600">{title}</div>
      </CardContent>
    </Card>
  );
}

export default function MiniKpiStack({ metrics }: { metrics: UsageMetricsVM }) {
  return (
    <div className="space-y-4">
      <MiniKpiItem
        title="Avg. Daily Requests"
        value={formatNumber(Math.round(metrics.avgDailyRequests))}
        delta={metrics.deltaLabels.avgDailyRequests}
        icon={<Sigma className="h-4 w-4" />}
      />
      <MiniKpiItem
        title="Total Requests"
        value={formatNumber(metrics.totalRequests)}
        delta={metrics.deltaLabels.totalRequests}
        icon={<BarChart3 className="h-4 w-4" />}
      />
      <MiniKpiItem
        title="Error Rate"
        value={`${(metrics.errorRate * 100).toFixed(2)}%`}
        delta={metrics.deltaLabels.errorRate}
        icon={<AlertTriangle className="h-4 w-4" />}
      />
    </div>
  );
}

