"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import KpiCard from "../components/KpiCard";
import AipStatusDonutCard from "../components/AipStatusDonutCard";
import ReviewBacklogCard from "../components/ReviewBacklogCard";
import ChatbotUsageLineChart from "../components/ChatbotUsageLineChart";
import MiniKpiStack from "../components/MiniKpiStack";
import { Users, Building2, MessageSquare, FileText } from "lucide-react";
import { useAdminDashboard } from "../hooks/useAdminDashboard";
import type { AdminDashboardActions } from "../types/dashboard-actions";
import type {
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";

type AdminDashboardViewProps = {
  actions: AdminDashboardActions;
  initialData?: {
    filters: AdminDashboardFilters;
    snapshot: AdminDashboardSnapshot;
  };
};

export default function AdminDashboardView({
  actions,
  initialData,
}: AdminDashboardViewProps) {
  const { filters, viewModel, loading, error, setUsageRange } = useAdminDashboard(initialData);
  const [usageYear, setUsageYear] = useState("all");
  const [usageMonth, setUsageMonth] = useState("all");
  const [usageYearOptions, setUsageYearOptions] = useState<number[]>([]);

  const handleStatusClick = (status: string) => {
    actions.onOpenAipMonitoring?.({ filters, status });
  };

  useEffect(() => {
    if (!viewModel.usageMetrics) return;
    const incomingYears = Array.from(
      new Set(
        viewModel.usageMetrics.chatbotUsageTrend.map((point) =>
          Number(point.dateKey.slice(0, 4))
        )
      )
    )
      .filter((year) => Number.isFinite(year))
      .sort((left, right) => right - left);

    setUsageYearOptions((previous) =>
      Array.from(new Set([...previous, ...incomingYears])).sort((left, right) => right - left)
    );
  }, [viewModel.usageMetrics]);

  const setRangeFromSelection = (year: string, month: string) => {
    if (year === "all" && month === "all") {
      setUsageRange({ usageFrom: null, usageTo: null });
      return;
    }

    if (year !== "all" && month === "all") {
      setUsageRange({
        usageFrom: `${year}-01-01`,
        usageTo: `${year}-12-31`,
      });
      return;
    }

    if (year !== "all" && month !== "all") {
      const monthIndex = Number(month);
      const startDate = new Date(Number(year), monthIndex - 1, 1);
      const endDate = new Date(Number(year), monthIndex, 0);
      const usageFrom = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
      const usageTo = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      setUsageRange({ usageFrom, usageTo });
    }
  };

  const handleUsageYearChange = (value: string) => {
    if (value === "all") {
      setUsageYear("all");
      setUsageMonth("all");
      setRangeFromSelection("all", "all");
      return;
    }

    setUsageYear(value);
    setRangeFromSelection(value, usageMonth);
  };

  const handleUsageMonthChange = (value: string) => {
    if (value === "all") {
      setUsageMonth("all");
      setRangeFromSelection(usageYear, "all");
      return;
    }

    let nextYear = usageYear;
    if (nextYear === "all") {
      nextYear = String(new Date().getFullYear());
      setUsageYear(nextYear);
      setUsageYearOptions((previous) =>
        Array.from(new Set([...previous, Number(nextYear)])).sort((left, right) => right - left)
      );
    }

    setUsageMonth(value);
    setRangeFromSelection(nextYear, value);
  };

  return (
    <div className="space-y-5 text-[13px] text-slate-700 sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight text-slate-900 sm:text-[30px] sm:leading-9">Dashboard</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-500 sm:text-[14px]">
            Read-only operational overview with drill-down access to oversight areas.
          </p>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-blue-200 bg-blue-50 px-3 py-1 text-[12px] font-medium text-blue-700"
        >
          Read-only
        </Badge>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={viewModel.kpis[0].title}
          value={viewModel.kpis[0].value}
          deltaLabel={viewModel.kpis[0].deltaLabel}
          icon={Building2}
          iconClassName={viewModel.kpis[0].iconClassName}
          ctaLabel={viewModel.kpis[0].ctaLabel}
          ctaHref={viewModel.kpis[0].path}
          onCtaClick={() => actions.onOpenLguManagement?.({ filters })}
        />
        <KpiCard
          title={viewModel.kpis[1].title}
          value={viewModel.kpis[1].value}
          deltaLabel={viewModel.kpis[1].deltaLabel}
          icon={Users}
          iconClassName={viewModel.kpis[1].iconClassName}
          ctaLabel={viewModel.kpis[1].ctaLabel}
          ctaHref={viewModel.kpis[1].path}
          onCtaClick={() => actions.onOpenAccounts?.({ filters })}
        />
        <KpiCard
          title={viewModel.kpis[2].title}
          value={viewModel.kpis[2].value}
          deltaLabel={viewModel.kpis[2].deltaLabel}
          icon={MessageSquare}
          iconClassName={viewModel.kpis[2].iconClassName}
          ctaLabel={viewModel.kpis[2].ctaLabel}
          ctaHref={viewModel.kpis[2].path}
          onCtaClick={() => actions.onOpenFeedbackModeration?.({ filters })}
          tagLabel={viewModel.kpis[2].tagLabel}
          tagTone="warning"
        />
        <KpiCard
          title={viewModel.kpis[3].title}
          value={viewModel.kpis[3].value}
          deltaLabel={viewModel.kpis[3].deltaLabel}
          icon={FileText}
          iconClassName={viewModel.kpis[3].iconClassName}
          ctaLabel={viewModel.kpis[3].ctaLabel}
          ctaHref={viewModel.kpis[3].path}
          onCtaClick={() => actions.onOpenAipMonitoring?.({ filters })}
          tagLabel={viewModel.kpis[3].tagLabel}
          tagTone="warning"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2.1fr_1fr]">
        <AipStatusDonutCard data={viewModel.distribution} onStatusClick={handleStatusClick} />
        {viewModel.reviewBacklog && (
          <ReviewBacklogCard
            backlog={viewModel.reviewBacklog}
            onViewAips={() => actions.onOpenAipMonitoring?.({ filters })}
          />
        )}
      </div>

      {viewModel.usageMetrics && (
        <div className="grid gap-6 xl:grid-cols-[2.1fr_1fr]">
          <ChatbotUsageLineChart
            metrics={viewModel.usageMetrics}
            usageYear={usageYear}
            usageMonth={usageMonth}
            yearOptions={usageYearOptions}
            onUsageYearChange={handleUsageYearChange}
            onUsageMonthChange={handleUsageMonthChange}
          />
          <MiniKpiStack metrics={viewModel.usageMetrics} />
        </div>
      )}

      {loading && <div className="text-[12px] text-slate-500">Refreshing dashboard metrics...</div>}
    </div>
  );
}
