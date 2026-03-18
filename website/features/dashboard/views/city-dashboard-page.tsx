import { Building2 } from "lucide-react";
import { DashboardHeader, DateCard, WorkingOnCard } from "@/features/dashboard/components/dashboard-header-widgets";
import { KpiRow } from "@/features/dashboard/components/dashboard-metric-cards";
import { BudgetBreakdownSection } from "@/features/dashboard/components/dashboard-budget-allocation";
import { TopFundedProjectsSection } from "@/features/dashboard/components/dashboard-projects-overview";
import { AipStatusColumn, AipCoverageCard, AipsByYearTable } from "@/features/dashboard/components/dashboard-aip-publication-status";
import { CitizenEngagementPulseColumn } from "@/features/dashboard/components/dashboard-feedback-insights";
import { RecentActivityFeed, RecentProjectUpdatesCard } from "@/features/dashboard/components/dashboard-activity-updates";
import { createCityDraftAipAction, replyCityFeedbackAction } from "@/features/dashboard/actions/city-dashboard-actions";
import type { DashboardData, DashboardQueryState, DashboardViewModel } from "@/features/dashboard/types/dashboard-types";
import type { ActivityLogRow } from "@/lib/repos/audit/repo";

function toCurrency(value: number): string {
  return value.toLocaleString("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
}

export function CityDashboardPage({
  data,
  vm,
  queryState,
  recentActivityLogs,
}: {
  data: DashboardData;
  vm: DashboardViewModel;
  queryState: DashboardQueryState;
  recentActivityLogs: ActivityLogRow[];
}) {
  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const pendingReviewCount = data.allAips.filter((aip) => aip.status === "pending_review").length;
  const underReviewCount = data.allAips.filter((aip) => aip.status === "under_review").length;
  const forRevisionCount = data.allAips.filter((aip) => aip.status === "for_revision").length;
  const healthProjectsCount = vm.projects.filter((project) => project.category === "health").length;
  const infraProjectsCount = vm.projects.filter((project) => project.category === "infrastructure").length;
  const projectBreakdownText = `Health: ${healthProjectsCount} | Infra: ${infraProjectsCount}`;

  return (
    <div className="space-y-5 sm:space-y-6">
      <DashboardHeader
        title="Welcome to OpenAIP"
        q={queryState.q}
        tableQ={queryState.tableQ}
        tableCategory={queryState.tableCategory}
        tableSector={queryState.tableSector}
        selectedFiscalYear={data.selectedFiscalYear}
        availableFiscalYears={data.availableFiscalYears}
        kpiMode={queryState.kpiMode}
      />

      <KpiRow selectedAip={data.selectedAip} totalProjects={vm.projects.length} totalBudget={toCurrency(vm.totalBudget)} citizenFeedbackCount={vm.citizenFeedbackCount} awaitingReplyCount={vm.awaitingReplyCount} hiddenCount={vm.lguNotesPosted} pendingReviewCount={pendingReviewCount} underReviewCount={underReviewCount} forRevisionCount={forRevisionCount} oldestPendingDays={vm.oldestPendingDays} fiscalYear={data.selectedFiscalYear} projectBreakdownText={projectBreakdownText} scope="city" />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          <BudgetBreakdownSection totalBudget={toCurrency(vm.totalBudget)} items={vm.budgetBySector} detailsHref={data.selectedAip ? `/city/aips/${data.selectedAip.id}` : undefined} />
        </div>
        <div className="min-w-0 space-y-4"><DateCard label={today} /><WorkingOnCard items={vm.workingOnItems} /></div>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.95fr_1fr]">
        <div className="min-w-0">
          <TopFundedProjectsSection queryState={queryState} sectors={data.sectors} projects={vm.projects} />
        </div>
        <div className="min-w-0">
          <AipStatusColumn statusDistribution={vm.statusDistribution} pendingReviewAging={vm.pendingReviewAging} />
        </div>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#0B6477] sm:h-6 sm:w-6" />
            <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl lg:text-3xl">City AIP Status</h2>
          </div>
          <AipCoverageCard
            selectedAip={data.selectedAip}
            scope="city"
            fiscalYear={data.selectedFiscalYear}
            createDraftAction={createCityDraftAipAction}
          />
          <AipsByYearTable rows={data.allAips} basePath="/city" />
          <RecentActivityFeed logs={recentActivityLogs} auditHref="/city/audit" compact />
        </div>
        <div className="min-w-0">
          <CitizenEngagementPulseColumn selectedFiscalYear={data.selectedFiscalYear} newThisWeek={vm.newThisWeek} awaitingReply={vm.awaitingReplyCount} lguNotesPosted={vm.lguNotesPosted} feedbackCategorySummary={vm.feedbackCategorySummary} feedbackTargets={vm.feedbackTargets} recentFeedback={vm.recentCitizenFeedback} replyAction={replyCityFeedbackAction} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 xl:col-start-2">
          <RecentProjectUpdatesCard logs={data.projectUpdateLogs} />
        </div>
      </div>
    </div>
  );
}


