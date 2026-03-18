"use client";

import { LineGraphCard } from "@/components/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageMetricsVM } from "@/lib/repos/admin-dashboard/types";

export default function ChatbotUsageLineChart({ metrics }: { metrics: UsageMetricsVM }) {
  const data = metrics.chatbotUsageTrend.map((point) => ({
    label: point.label,
    value: point.value,
  }));

  return (
    <Card className="border-slate-200 py-3 shadow-none">
      <CardHeader className="space-y-1 pb-0">
        <CardTitle className="text-base sm:text-[18px]">Chatbot Usage Over Time</CardTitle>
        <div className="text-[12px] text-slate-500">
          Daily chatbot request volume showing usage trends and patterns.
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <LineGraphCard
          data={data}
          xKey="label"
          series={[{ key: "value", label: "Requests", color: "var(--chart-1)" }]}
          className="rounded-none border-0 bg-transparent p-0"
          heightClass="h-[210px] sm:h-[250px]"
          showTooltip={false}
        />
      </CardContent>
    </Card>
  );
}
