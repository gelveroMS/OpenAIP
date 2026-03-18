'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DBV2_SECTOR_CODES, getSectorLabel, type DashboardSectorCode } from "@/lib/constants/dashboard";
import type {
  AipDetailsRowVM,
  BudgetAllocationLguOptionVM,
  BudgetCategoryKey,
} from "@/lib/domain/citizen-budget-allocation";
import CitizenExplainerCard from "@/features/citizen/components/citizen-explainer-card";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";
import {
  AipDetailsSection,
  ChartsGrid,
  FiltersSection,
  OverviewHeader,
} from '../components';
import { CITIZEN_BUDGET_ALLOCATION_MOCK } from '@/mocks/fixtures/budget-allocation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TAB: BudgetCategoryKey = 'general';
const PAGE_SIZE = 10;
const CATEGORY_ORDER: BudgetCategoryKey[] = ['general', 'social', 'economic', 'other'];
const CATEGORY_TO_SECTOR_CODE: Record<BudgetCategoryKey, DashboardSectorCode> = {
  general: '1000',
  social: '3000',
  economic: '8000',
  other: '9000',
};
const SECTOR_CODE_TO_CATEGORY: Record<DashboardSectorCode, BudgetCategoryKey> = {
  "1000": "general",
  "3000": "social",
  "8000": "economic",
  "9000": "other",
};
const CATEGORY_COLOR_BY_KEY: Record<BudgetCategoryKey, string> = {
  general: '#3B82F6',
  social: '#14B8A6',
  economic: '#22C55E',
  other: '#F59E0B',
};

type FiltersPayload = {
  has_data: boolean;
  years: number[];
  lgus: Array<{
    scope_type: "city" | "barangay";
    scope_id: string;
    label: string;
    city_scope_id: string | null;
    city_scope_label: string | null;
  }>;
  selected: {
    fiscal_year: number;
    scope_type: "city" | "barangay";
    scope_id: string;
  } | null;
};

type SummaryPayload = {
  scope?: { scope_name?: string | null };
  totals?: {
    overall_total?: number;
    by_sector?: Array<{
      sector_code: DashboardSectorCode;
      sector_label: string;
      total: number;
    }>;
  };
  trend?: {
    years?: number[];
    series?: Array<{
      sector_code: DashboardSectorCode;
      values: number[];
    }>;
  };
};

type ProjectsPayload = {
  items: Array<{
    project_id?: string;
    aip_ref_code: string;
    program_project_description: string;
    source_of_funds?: string | null;
    total: number;
  }>;
  page?: number;
  pageSize?: number;
  totalRows?: number;
  totalPages?: number;
};

type InitialPayload = {
  filters: FiltersPayload;
  summary: SummaryPayload | null;
  projects: ProjectsPayload | null;
};

type CitizenBudgetAllocationViewProps = {
  initialData?: InitialPayload | null;
};

function toProjectRows(
  payload: ProjectsPayload | null | undefined,
  categoryKey: BudgetCategoryKey
): AipDetailsRowVM[] {
  return (payload?.items ?? []).map((item) => ({
    categoryKey,
    aipRefCode: item.aip_ref_code,
    programDescription: item.program_project_description,
    totalAmount: typeof item.total === 'number' ? item.total : 0,
  }));
}

function toLguOptions(
  payload: FiltersPayload | null | undefined
): BudgetAllocationLguOptionVM[] {
  return (payload?.lgus ?? []).map((option) => ({
    id: option.scope_id,
    label: option.label,
    scopeType: option.scope_type,
    cityScopeId: option.city_scope_id,
    cityScopeLabel: option.city_scope_label,
  }));
}

export default function CitizenBudgetAllocationView({
  initialData,
}: CitizenBudgetAllocationViewProps) {
  const vm = CITIZEN_BUDGET_ALLOCATION_MOCK;
  const initialFilters = initialData?.filters ?? null;
  const initialSelected = initialFilters?.selected ?? null;
  const hasInitialPublishedData = Boolean(initialFilters?.has_data && initialSelected);
  const skipInitialSummaryFetch = useRef(Boolean(initialData?.summary && hasInitialPublishedData));
  const skipInitialProjectsFetch = useRef(
    Boolean(initialData?.projects && hasInitialPublishedData)
  );

  const [activeTab, setActiveTab] = useState<BudgetCategoryKey>(DEFAULT_TAB);
  const [detailsSearch, setDetailsSearch] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | null>(
    initialSelected?.fiscal_year ?? null
  );
  const [selectedScopeType, setSelectedScopeType] = useState<"city" | "barangay" | null>(
    initialSelected?.scope_type ?? null
  );
  const [selectedScopeId, setSelectedScopeId] = useState<string>(initialSelected?.scope_id ?? '');
  const [availableYears, setAvailableYears] = useState<number[]>(initialFilters?.years ?? []);
  const [availableLGUs, setAvailableLGUs] = useState<BudgetAllocationLguOptionVM[]>(
    toLguOptions(initialFilters)
  );
  const [projectPage, setProjectPage] = useState<number>(1);
  const [isFiltersLoading, setIsFiltersLoading] = useState<boolean>(() => !initialFilters);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(false);
  const [isProjectsLoading, setIsProjectsLoading] = useState<boolean>(false);
  const [hasPublishedData, setHasPublishedData] = useState<boolean>(hasInitialPublishedData);
  const [filtersError, setFiltersError] = useState<string | null>(null);

  const [summaryPayload, setSummaryPayload] = useState<SummaryPayload | null>(
    initialData?.summary ?? null
  );
  const [projectItems, setProjectItems] = useState<AipDetailsRowVM[]>(
    toProjectRows(initialData?.projects ?? null, DEFAULT_TAB)
  );
  const [projectTotalPages, setProjectTotalPages] = useState<number>(
    Math.max(1, Number(initialData?.projects?.totalPages ?? 1))
  );

  const canFetchLiveData =
    hasPublishedData &&
    typeof selectedYear === "number" &&
    !!selectedScopeType &&
    UUID_PATTERN.test(selectedScopeId);
  const viewAllHref = '/aips';
  const selectedLgu = availableLGUs.find(
    (option) => option.scopeType === selectedScopeType && option.id === selectedScopeId
  );
  const selectedLguLabel = selectedLgu?.label ?? 'Selected LGU';
  const availableCities = useMemo(() => {
    return availableLGUs
      .filter((option) => option.scopeType === "city")
      .map((option) => ({ id: option.id, label: option.label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [availableLGUs]);

  const selectedCityScopeId = useMemo(() => {
    if (selectedScopeType === "city" && selectedScopeId) return selectedScopeId;
    if (selectedScopeType === "barangay" && selectedLgu?.cityScopeId) {
      return selectedLgu.cityScopeId;
    }
    return availableCities[0]?.id ?? "";
  }, [availableCities, selectedLgu?.cityScopeId, selectedScopeId, selectedScopeType]);

  const availableBarangays = useMemo(() => {
    const scoped = availableLGUs.filter((option) => option.scopeType === "barangay");
    if (!selectedCityScopeId) return scoped;
    return scoped.filter((option) => option.cityScopeId === selectedCityScopeId);
  }, [availableLGUs, selectedCityScopeId]);

  const selectedBarangayScopeId = useMemo(() => {
    if (selectedScopeType === "barangay" && selectedScopeId) return selectedScopeId;
    return availableBarangays[0]?.id ?? "";
  }, [availableBarangays, selectedScopeId, selectedScopeType]);

  const syncFilters = useCallback(
    async (input?: {
      fiscalYear?: number;
      scopeType?: "city" | "barangay";
      scopeId?: string;
      prefer?: "year" | "lgu";
    }) => {
      const params = new URLSearchParams();
      if (typeof input?.fiscalYear === "number") {
        params.set("fiscal_year", String(input.fiscalYear));
      }
      if (input?.scopeType && input.scopeId) {
        params.set("scope_type", input.scopeType);
        params.set("scope_id", input.scopeId);
      }
      if (input?.prefer) {
        params.set("prefer", input.prefer);
      }

      const response = await fetch(`/api/citizen/budget-allocation/filters?${params.toString()}`);
      const payload = (await response.json()) as FiltersPayload;
      if (!response.ok) {
        throw new Error("Failed to load budget allocation filters.");
      }

      if (!payload.has_data || !payload.selected) {
        setHasPublishedData(false);
        setAvailableYears([]);
        setAvailableLGUs([]);
        setSelectedYear(null);
        setSelectedScopeType(null);
        setSelectedScopeId("");
        setSummaryPayload(null);
        setProjectItems([]);
        setProjectTotalPages(1);
        skipInitialSummaryFetch.current = false;
        skipInitialProjectsFetch.current = false;
        return;
      }

      setHasPublishedData(true);
      setAvailableYears(payload.years ?? []);
      setAvailableLGUs(toLguOptions(payload));
      setSelectedYear(payload.selected.fiscal_year);
      setSelectedScopeType(payload.selected.scope_type);
      setSelectedScopeId(payload.selected.scope_id);
    },
    []
  );

  useEffect(() => {
    if (initialFilters) {
      setIsFiltersLoading(false);
      return;
    }

    let cancelled = false;
    setIsFiltersLoading(true);
    setFiltersError(null);

    syncFilters()
      .catch(() => {
        if (cancelled) return;
        setHasPublishedData(false);
        setFiltersError("Unable to load published budget allocation filters.");
      })
      .finally(() => {
        if (!cancelled) setIsFiltersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialFilters, syncFilters]);

  useEffect(() => {
    if (!canFetchLiveData || typeof selectedYear !== "number" || !selectedScopeType) {
      setIsSummaryLoading(false);
      return;
    }

    if (skipInitialSummaryFetch.current) {
      skipInitialSummaryFetch.current = false;
      return;
    }

    let cancelled = false;

    const loadSummary = async () => {
      setIsSummaryLoading(true);
      const params = new URLSearchParams({
        fiscal_year: String(selectedYear),
        scope_type: selectedScopeType,
        scope_id: selectedScopeId,
      });

      const response = await fetch(`/api/citizen/budget-allocation/summary?${params.toString()}`);
      const payload = (await response.json()) as SummaryPayload;
      if (!cancelled) {
        setSummaryPayload(response.ok ? payload : null);
        setIsSummaryLoading(false);
      }
    };

    loadSummary().catch(() => {
      if (!cancelled) {
        setSummaryPayload(null);
        setIsSummaryLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [canFetchLiveData, selectedYear, selectedScopeType, selectedScopeId]);

  useEffect(() => {
    if (!canFetchLiveData || typeof selectedYear !== "number" || !selectedScopeType) {
      setIsProjectsLoading(false);
      return;
    }

    if (
      skipInitialProjectsFetch.current &&
      activeTab === DEFAULT_TAB &&
      projectPage === 1 &&
      detailsSearch.trim().length === 0
    ) {
      skipInitialProjectsFetch.current = false;
      return;
    }
    skipInitialProjectsFetch.current = false;

    let cancelled = false;

    const loadProjects = async () => {
      setIsProjectsLoading(true);
      const params = new URLSearchParams({
        fiscal_year: String(selectedYear),
        scope_type: selectedScopeType,
        scope_id: selectedScopeId,
        sector_code: CATEGORY_TO_SECTOR_CODE[activeTab],
        page: String(projectPage),
        pageSize: String(PAGE_SIZE),
      });

      if (detailsSearch.trim()) {
        params.set('q', detailsSearch.trim());
      }

      const response = await fetch(`/api/citizen/budget-allocation/projects?${params.toString()}`);
      const payload = (await response.json()) as ProjectsPayload;
      if (!cancelled) {
        if (!response.ok) {
          setProjectItems([]);
          setProjectTotalPages(1);
          setIsProjectsLoading(false);
          return;
        }

        setProjectItems(toProjectRows(payload, activeTab));
        setProjectTotalPages(Math.max(1, Number(payload.totalPages ?? 1)));
        setIsProjectsLoading(false);
      }
    };

    loadProjects().catch(() => {
      if (!cancelled) {
        setProjectItems([]);
        setProjectTotalPages(1);
        setIsProjectsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [canFetchLiveData, selectedYear, selectedScopeType, selectedScopeId, activeTab, projectPage, detailsSearch]);

  const donutSectors = useMemo(() => {
    const bySector = summaryPayload?.totals?.by_sector ?? [];
    const sectorMap = new Map(bySector.map((sector) => [sector.sector_code, sector]));
    return CATEGORY_ORDER.map((categoryKey) => {
      const sectorCode = CATEGORY_TO_SECTOR_CODE[categoryKey];
      const sector = sectorMap.get(sectorCode);
      return {
        key: categoryKey,
        label: sector?.sector_label ?? getSectorLabel(sectorCode),
        amount: typeof sector?.total === 'number' ? sector.total : 0,
        color: CATEGORY_COLOR_BY_KEY[categoryKey],
      };
    });
  }, [summaryPayload]);

  const donutTotal =
    typeof summaryPayload?.totals?.overall_total === "number" &&
    Number.isFinite(summaryPayload.totals.overall_total)
      ? summaryPayload.totals.overall_total
      : donutSectors.reduce((total, sector) => total + sector.amount, 0);

  const trendData = useMemo(() => {
    const years = Array.isArray(summaryPayload?.trend?.years) ? summaryPayload.trend.years : [];
    const series = Array.isArray(summaryPayload?.trend?.series) ? summaryPayload.trend.series : [];
    const seriesMap = new Map(series.map((item) => [item.sector_code, item.values]));

    return years.map((year, yearIndex) => {
      const point: Record<string, number> = { year };
      DBV2_SECTOR_CODES.forEach((code) => {
        const categoryKey = SECTOR_CODE_TO_CATEGORY[code];
        const values = seriesMap.get(code) ?? [];
        point[categoryKey] = typeof values[yearIndex] === 'number' ? values[yearIndex] : 0;
      });
      return point as { year: number; general: number; social: number; economic: number; other: number };
    });
  }, [summaryPayload]);

  const trendSubtitle = trendData.length > 0
    ? `Shows budget trends from ${trendData[0]?.year}-${trendData[trendData.length - 1]?.year}`
    : 'No trend data available for the selected LGU.';

  const detailsVm = {
    ...vm.aipDetails,
    activeTab,
    rows: projectItems,
    searchText: detailsSearch,
  };

  return (
    <section className="pb-12 md:pb-16">
      <div className="mx-auto max-w-6xl px-3 pt-2 sm:px-4 md:px-6">
        <CitizenPageHero
          title={vm.hero.title.toUpperCase()}
          subtitle={vm.hero.subtitle}
          imageSrc="/citizen-dashboard/hero2.webp"
        />
      </div>
      <section className="mx-auto max-w-6xl px-3 pb-2 pt-4 sm:px-4 md:px-6 md:pt-6 md:pb-3">
        <CitizenExplainerCard title="What is Budget Allocation?">
          <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
            {vm.explainer.body}
          </p>
        </CitizenExplainerCard>
      </section>
      {isFiltersLoading ? (
        <section className="mx-auto max-w-6xl px-3 pb-10 sm:px-4 md:px-6 md:pb-12">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
              <div className="h-5 w-64 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-11/12 animate-pulse rounded-full bg-slate-100" />
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-100" />
            </div>
          </div>
        </section>
      ) : filtersError ? (
        <section className="mx-auto max-w-6xl px-3 pb-10 sm:px-4 md:px-6 md:pb-12">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            {filtersError}
          </div>
        </section>
      ) : !hasPublishedData ? (
        <section className="mx-auto max-w-6xl px-3 pb-10 sm:px-4 md:px-6 md:pb-12">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No published AIP budget allocation data is currently available for city or barangay scope.
          </div>
        </section>
      ) : (
        <>
          <FiltersSection
            filters={{
              ...vm.filters,
              selectedYear: selectedYear ?? availableYears[0] ?? vm.filters.selectedYear,
              availableYears,
              selectedScopeType: selectedScopeType ?? availableLGUs[0]?.scopeType ?? vm.filters.selectedScopeType,
              selectedScopeId: selectedScopeId || availableLGUs[0]?.id || vm.filters.selectedScopeId,
              selectedCityScopeId:
                selectedCityScopeId ||
                availableCities[0]?.id ||
                vm.filters.selectedCityScopeId,
              selectedBarangayScopeId:
                selectedBarangayScopeId ||
                availableBarangays[0]?.id ||
                vm.filters.selectedBarangayScopeId,
              availableLGUs,
              availableCities,
              availableBarangays: availableBarangays.map((option) => ({
                id: option.id,
                label: option.label,
                cityScopeId: option.cityScopeId,
              })),
            }}
            onYearChange={(year) => {
              setProjectPage(1);
              setFiltersError(null);
              skipInitialSummaryFetch.current = false;
              skipInitialProjectsFetch.current = false;
              syncFilters({
                fiscalYear: year,
                scopeType: selectedScopeType ?? undefined,
                scopeId: selectedScopeId || undefined,
                prefer: "year",
              }).catch(() => {
                setHasPublishedData(false);
                setFiltersError("Unable to load published budget allocation filters.");
              });
            }}
            onCityChange={(scopeId) => {
              setProjectPage(1);
              setFiltersError(null);
              skipInitialSummaryFetch.current = false;
              skipInitialProjectsFetch.current = false;
              syncFilters({
                scopeType: "city",
                scopeId,
                prefer: "lgu",
              }).catch(() => {
                setHasPublishedData(false);
                setFiltersError("Unable to load published budget allocation filters.");
              });
            }}
            onBarangayChange={(scopeId) => {
              setProjectPage(1);
              setFiltersError(null);
              skipInitialSummaryFetch.current = false;
              skipInitialProjectsFetch.current = false;
              syncFilters({
                scopeType: "barangay",
                scopeId,
                prefer: "lgu",
              }).catch(() => {
                setHasPublishedData(false);
                setFiltersError("Unable to load published budget allocation filters.");
              });
            }}
          />
          <OverviewHeader
            title={`${summaryPayload?.scope?.scope_name ?? selectedLguLabel} Budget Allocation Breakdown`}
            subtitle={`Total budget and allocation by category for FY ${selectedYear ?? ""}`}
          />
          {isSummaryLoading ? (
            <section className="mx-auto max-w-6xl px-3 pb-4 pt-6 sm:px-4 md:px-6 md:pt-10 md:pb-5">
              <div className="grid gap-4 md:gap-6 lg:grid-cols-[0.95fr_1.35fr]">
                <div className="h-[320px] animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
                <div className="h-[320px] animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
              </div>
            </section>
          ) : (
            <ChartsGrid
              fiscalYear={selectedYear ?? vm.filters.selectedYear}
              totalBudget={donutTotal}
              sectors={donutSectors}
              trendSubtitle={trendSubtitle}
              trendData={trendData}
            />
          )}
          {isProjectsLoading ? (
            <section className="mx-auto max-w-6xl px-3 pb-10 pt-3 sm:px-4 md:px-6 md:pb-12">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
                <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
                  <div className="h-6 w-72 animate-pulse rounded-full bg-slate-200" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                </div>
              </div>
            </section>
          ) : (
            <AipDetailsSection
              vm={detailsVm}
              onTabChange={(tab) => {
                setActiveTab(tab);
                setProjectPage(1);
              }}
              onSearchChange={(value) => {
                setDetailsSearch(value);
                setProjectPage(1);
              }}
              viewAllHref={viewAllHref}
              page={projectPage}
              totalPages={projectTotalPages}
              onPageChange={setProjectPage}
            />
          )}
        </>
      )}
    </section>
  );
}
