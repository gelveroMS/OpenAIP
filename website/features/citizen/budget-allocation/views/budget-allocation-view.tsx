'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
    aip_ref_code: string;
    program_project_description: string;
    total: number;
  }>;
  totalPages: number;
};

export default function CitizenBudgetAllocationView() {
  const vm = CITIZEN_BUDGET_ALLOCATION_MOCK;

  const [activeTab, setActiveTab] = useState<BudgetCategoryKey>(DEFAULT_TAB);
  const [detailsSearch, setDetailsSearch] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedScopeType, setSelectedScopeType] = useState<"city" | "barangay" | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string>('');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableLGUs, setAvailableLGUs] = useState<BudgetAllocationLguOptionVM[]>([]);
  const [projectPage, setProjectPage] = useState<number>(1);
  const [isFiltersLoading, setIsFiltersLoading] = useState<boolean>(true);
  const [hasPublishedData, setHasPublishedData] = useState<boolean>(false);
  const [filtersError, setFiltersError] = useState<string | null>(null);

  const [summaryPayload, setSummaryPayload] = useState<SummaryPayload | null>(null);
  const [projectItems, setProjectItems] = useState<AipDetailsRowVM[]>([]);
  const [projectTotalPages, setProjectTotalPages] = useState<number>(1);

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

      const response = await fetch(`/api/citizen/budget-allocation/filters?${params.toString()}`, { cache: 'no-store' });
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
        return;
      }

      setHasPublishedData(true);
      setAvailableYears(payload.years ?? []);
      setAvailableLGUs(
        (payload.lgus ?? []).map((option) => ({
          id: option.scope_id,
          label: option.label,
          scopeType: option.scope_type,
        }))
      );
      setSelectedYear(payload.selected.fiscal_year);
      setSelectedScopeType(payload.selected.scope_type);
      setSelectedScopeId(payload.selected.scope_id);
    },
    []
  );

  useEffect(() => {
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
  }, [syncFilters]);

  useEffect(() => {
    if (!canFetchLiveData || typeof selectedYear !== "number" || !selectedScopeType) return;
    let cancelled = false;

    const loadSummary = async () => {
      const params = new URLSearchParams({
        fiscal_year: String(selectedYear),
        scope_type: selectedScopeType,
        scope_id: selectedScopeId,
      });

      const response = await fetch(`/api/citizen/budget-allocation/summary?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as SummaryPayload;
      if (!cancelled) {
        setSummaryPayload(response.ok ? payload : null);
      }
    };

    loadSummary().catch(() => {
      if (!cancelled) setSummaryPayload(null);
    });

    return () => {
      cancelled = true;
    };
  }, [canFetchLiveData, selectedYear, selectedScopeType, selectedScopeId]);

  useEffect(() => {
    if (!canFetchLiveData || typeof selectedYear !== "number" || !selectedScopeType) return;
    let cancelled = false;

    const loadProjects = async () => {
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

      const response = await fetch(`/api/citizen/budget-allocation/projects?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as ProjectsPayload;
      if (!cancelled) {
        if (!response.ok) {
          setProjectItems([]);
          setProjectTotalPages(1);
          return;
        }

        setProjectItems(
          (payload.items ?? []).map((item) => ({
            categoryKey: activeTab,
            aipRefCode: item.aip_ref_code,
            programDescription: item.program_project_description,
            totalAmount: typeof item.total === 'number' ? item.total : 0,
          }))
        );
        setProjectTotalPages(Math.max(1, Number(payload.totalPages ?? 1)));
      }
    };

    loadProjects().catch(() => {
      if (!cancelled) {
        setProjectItems([]);
        setProjectTotalPages(1);
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

  const donutTotal = donutSectors.reduce((total, sector) => total + sector.amount, 0);

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
    <section className="pb-16">
      <div className="mx-auto max-w-6xl px-6 pt-2">
        <CitizenPageHero
          title={vm.hero.title.toUpperCase()}
          subtitle={vm.hero.subtitle}
          imageSrc="/citizen-dashboard/hero2.webp"
        />
      </div>
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-3">
        <CitizenExplainerCard title="What is Budget Allocation?">
          <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
            {vm.explainer.body}
          </p>
        </CitizenExplainerCard>
      </section>
      {isFiltersLoading ? (
        <section className="mx-auto max-w-6xl px-6 pb-12">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Loading published budget allocation data...
          </div>
        </section>
      ) : filtersError ? (
        <section className="mx-auto max-w-6xl px-6 pb-12">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            {filtersError}
          </div>
        </section>
      ) : !hasPublishedData ? (
        <section className="mx-auto max-w-6xl px-6 pb-12">
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
              availableLGUs,
            }}
            onYearChange={(year) => {
              setProjectPage(1);
              setFiltersError(null);
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
            onLguChange={(scopeType, scopeId) => {
              setProjectPage(1);
              setFiltersError(null);
              syncFilters({
                scopeType,
                scopeId,
                fiscalYear: typeof selectedYear === "number" ? selectedYear : undefined,
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
          <ChartsGrid
            fiscalYear={selectedYear ?? vm.filters.selectedYear}
            totalBudget={donutTotal}
            sectors={donutSectors}
            trendSubtitle={trendSubtitle}
            trendData={trendData}
          />
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
        </>
      )}
    </section>
  );
}
