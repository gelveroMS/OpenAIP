"use client";

import { Badge } from "@/components/ui/badge";
import KpiCard from "../components/KpiCard";
import DashboardFiltersRow from "../components/DashboardFiltersRow";
import AipStatusDonutCard from "../components/AipStatusDonutCard";
import ReviewBacklogCard from "../components/ReviewBacklogCard";
import ErrorRateBarChart from "../components/ErrorRateBarChart";
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
  onFiltersChange?: (filters: AdminDashboardFilters) => void;
  initialData?: {
    filters: AdminDashboardFilters;
    snapshot: AdminDashboardSnapshot;
  };
};

export default function AdminDashboardView({
  actions,
  onFiltersChange,
  initialData,
}: AdminDashboardViewProps) {
  const { filters, setFilters, viewModel, loading, error, createDefaultFilters } =
    useAdminDashboard(initialData);

  const handleFilterChange = (nextFilters: AdminDashboardFilters) => {
    setFilters(nextFilters);
    onFiltersChange?.(nextFilters);
  };

  const handleReset = () => {
    const nextFilters = createDefaultFilters();
    setFilters(nextFilters);
    onFiltersChange?.(nextFilters);
  };

  const handleStatusClick = (status: string) => {
    actions.onOpenAipMonitoring?.({ filters, status });
  };

  return (
    <div className="space-y-6 text-[13px] text-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-9 text-slate-900">Dashboard</h1>
          <p className="mt-1.5 text-[14px] text-slate-500">
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

      <div className="rounded-[10px] border border-slate-200 bg-[#F4F6F8] px-8 py-4">
        <DashboardFiltersRow
          filters={filters}
          lguOptions={viewModel.lguOptions}
          onChange={handleFilterChange}
          onReset={handleReset}
        />
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
          <div className="space-y-6">
            <ErrorRateBarChart metrics={viewModel.usageMetrics} />
            <ChatbotUsageLineChart metrics={viewModel.usageMetrics} />
          </div>
          <MiniKpiStack metrics={viewModel.usageMetrics} />
        </div>
      )}

      {loading && <div className="text-[12px] text-slate-500">Refreshing dashboard metrics...</div>}
    </div>
  );
}
