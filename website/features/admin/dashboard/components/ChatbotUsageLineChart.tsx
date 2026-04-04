"use client";

import { useMemo } from "react";
import { LineGraphCard } from "@/components/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UsageMetricsVM } from "@/lib/repos/admin-dashboard/types";

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const;

export default function ChatbotUsageLineChart({
  metrics,
  usageYear,
  usageMonth,
  yearOptions,
  onUsageYearChange,
  onUsageMonthChange,
}: {
  metrics: UsageMetricsVM;
  usageYear: string;
  usageMonth: string;
  yearOptions: number[];
  onUsageYearChange: (value: string) => void;
  onUsageMonthChange: (value: string) => void;
}) {
  const data = useMemo(() => {
    if (usageMonth !== "all") {
      return metrics.chatbotUsageTrend.map((point) => ({
        label: point.label,
        value: point.value,
      }));
    }

    const monthly = new Map<string, number>();
    metrics.chatbotUsageTrend.forEach((point) => {
      const monthKey = point.dateKey.slice(0, 7);
      monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + point.value);
    });

    return Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([monthKey, value]) => {
        const [year, month] = monthKey.split("-");
        const labelDate = new Date(Number(year), Number(month) - 1, 1);
        return {
          label: labelDate.toLocaleDateString("en-PH", { month: "short", year: "numeric" }),
          value,
        };
      });
  }, [metrics.chatbotUsageTrend, usageMonth]);

  return (
    <Card className="border-slate-200 py-3 shadow-none">
      <CardHeader className="space-y-1 pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-base sm:text-[18px]">Chatbot Usage Over Time</CardTitle>
            <div className="text-[12px] text-slate-500">
              Daily chatbot request volume showing usage trends and patterns.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:w-auto">
            <Select value={usageYear} onValueChange={onUsageYearChange}>
              <SelectTrigger className="h-9 w-full min-w-[120px] border-slate-300 bg-white text-[12px]">
                <SelectValue placeholder="All Years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={usageMonth} onValueChange={onUsageMonthChange}>
              <SelectTrigger className="h-9 w-full min-w-[120px] border-slate-300 bg-white text-[12px]">
                <SelectValue placeholder="All Months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {MONTH_OPTIONS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
