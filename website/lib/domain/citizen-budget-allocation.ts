export type BudgetCategoryKey = "general" | "social" | "economic" | "other";
export type BudgetAllocationScopeLevel = "city" | "barangay" | "both";

export type BudgetAllocationLguOptionVM = {
  id: string;
  label: string;
  scopeType: "city" | "barangay";
  cityScopeId: string | null;
  cityScopeLabel: string | null;
};

export type BudgetAllocationScopeOptionVM = {
  id: string;
  label: string;
};

export type BudgetAllocationBarangayOptionVM = {
  id: string;
  label: string;
  cityScopeId: string | null;
};

export type BudgetAllocationFiltersVM = {
  selectedYear: number;
  availableYears: number[];
  selectedScopeLevel: BudgetAllocationScopeLevel;
  selectedScopeType: "city" | "barangay";
  selectedScopeId: string;
  selectedCityScopeId: string;
  selectedBarangayScopeId: string;
  availableLGUs: BudgetAllocationLguOptionVM[];
  availableCities: BudgetAllocationScopeOptionVM[];
  availableBarangays: BudgetAllocationBarangayOptionVM[];
  searchText: string;
};

export type CategoryCardVM = {
  categoryKey: BudgetCategoryKey;
  label: string;
  totalAmount: number;
  projectCount: number;
};

export type CategoryOverviewVM = {
  scopeLabel: string;
  cards: CategoryCardVM[];
};

export type ChartLegendItem = {
  label: string;
  value: number;
  color: string;
};

export type AllocationChartVM = {
  labels: string[];
  values: number[];
  legend: ChartLegendItem[];
};

export type SelectedContextVM = {
  totalAllocation: number;
  totalProjects: number;
  yoyAbs: number | null;
  yoyPct: number | null;
  hasPriorYear: boolean;
};

export type AllocationContextVM = {
  chart: AllocationChartVM;
  selectedContext: SelectedContextVM;
};

export type AipDetailsTabVM = {
  key: BudgetCategoryKey;
  label: string;
  count: number;
};

export type AipDetailsRowVM = {
  categoryKey: BudgetCategoryKey;
  aipRefCode: string;
  programDescription: string;
  totalAmount: number;
};

export type AipDetailsTableVM = {
  title: string;
  subtitle: string;
  activeTab: BudgetCategoryKey;
  tabs: AipDetailsTabVM[];
  rows: AipDetailsRowVM[];
  searchText: string;
};

export type CategoryChangeVM = {
  categoryKey: BudgetCategoryKey;
  label: string;
  deltaAbs: number | null;
  deltaPct: number | null;
  priorTotal: number | null;
  currentTotal: number;
  trend: "up" | "down" | "stable";
};

export type ChangesFromLastYearSummaryVM = {
  totalDeltaAbs: number | null;
  totalDeltaPct: number | null;
  priorFYTotal: number | null;
  currentFYTotal: number;
};

export type ChangesFromLastYearVM = {
  summary: ChangesFromLastYearSummaryVM;
  categories: CategoryChangeVM[];
};

export type CitizenBudgetAllocationVM = {
  hero: {
    title: string;
    subtitle: string;
  };
  explainer: {
    title: string;
    body: string;
  };
  filters: BudgetAllocationFiltersVM;
  categoryOverview: CategoryOverviewVM;
  allocationContext: AllocationContextVM;
  aipDetails: AipDetailsTableVM;
  changesFromLastYear: ChangesFromLastYearVM;
};
