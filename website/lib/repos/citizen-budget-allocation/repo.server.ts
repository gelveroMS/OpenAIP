
import "server-only";

import { unstable_cache } from "next/cache";
import {
  DBV2_SECTOR_CODES,
  getSectorLabel,
  type DashboardSectorCode,
} from "@/lib/constants/dashboard";
import {
  CITIZEN_DASHBOARD_CACHE_TAGS,
  CITIZEN_DASHBOARD_PROJECTS_REVALIDATE_SECONDS,
  CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/cache/citizen-dashboard";
import {
  buildProjectTotalsByAipId,
  fetchAipFileTotalsByAipIds,
  resolveAipDisplayTotal,
} from "@/lib/repos/_shared/aip-totals";
import { collectInChunksPaged } from "@/lib/repos/_shared/supabase-batching";
import { measureTiming } from "@/lib/server/perf/timing";
import { supabasePublicServer } from "@/lib/supabase/public-server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CABUYAO_CITY_PSGC = "043404";
const UNSPECIFIED_REF_CODE = "Unspecified";

export const BUDGET_ALLOCATION_DEFAULT_PAGE_SIZE = 10;
export const BUDGET_ALLOCATION_DEFAULT_SECTOR_CODE: DashboardSectorCode = "1000";

export type BudgetAllocationScopeType = "city" | "barangay";

export type BudgetAllocationFiltersInput = {
  fiscalYear?: number | null;
  prefer?: "year" | "lgu" | null;
  requestedScope?: {
    scopeType: BudgetAllocationScopeType;
    scopeId: string;
  } | null;
};

export type BudgetAllocationSummaryInput = {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
};

export type BudgetAllocationProjectsInput = {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
  sectorCode?: DashboardSectorCode | null;
  page: number;
  pageSize: number;
  q?: string;
  countMode?: "exact" | "none";
};

export type BudgetAllocationFiltersPayload = {
  has_data: boolean;
  years: number[];
  lgus: Array<{
    scope_type: BudgetAllocationScopeType;
    scope_id: string;
    label: string;
    city_scope_id: string | null;
    city_scope_label: string | null;
  }>;
  selected: {
    fiscal_year: number;
    scope_type: BudgetAllocationScopeType;
    scope_id: string;
  } | null;
};

export type BudgetAllocationSummaryPayload = {
  scope: {
    fiscal_year: number;
    scope_type: BudgetAllocationScopeType;
    scope_id: string;
    scope_name: string | null;
  };
  totals: {
    overall_total: number;
    by_sector: Array<{
      sector_code: DashboardSectorCode;
      sector_label: string;
      total: number;
      pct: number;
    }>;
  };
  trend: {
    years: number[];
    series: Array<{
      sector_code: DashboardSectorCode;
      sector_label: string;
      values: number[];
    }>;
  };
};

export type BudgetAllocationProjectsPayload = {
  items: Array<{
    project_id: string;
    aip_ref_code: string;
    program_project_description: string;
    source_of_funds: string | null;
    total: number;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};

export type BudgetAllocationInitialPayload = {
  filters: BudgetAllocationFiltersPayload;
  summary: BudgetAllocationSummaryPayload | null;
  projects: BudgetAllocationProjectsPayload | null;
};

export type CitizenBudgetAllocationRepoErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class CitizenBudgetAllocationRepoError extends Error {
  constructor(
    public readonly code: CitizenBudgetAllocationRepoErrorCode,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CitizenBudgetAllocationRepoError";
  }
}

type PublishedAipRow = {
  id: string;
  fiscal_year: number;
  city_id: string | null;
  barangay_id: string | null;
  created_at: string | null;
};

type ScopeNameRow = {
  id: string;
  name: string | null;
};

type CityScopeRow = ScopeNameRow & {
  psgc_code: string | null;
};

type BarangayScopeRow = ScopeNameRow & {
  city_id: string | null;
  municipality_id: string | null;
};

type LguOption = {
  scope_type: BudgetAllocationScopeType;
  scope_id: string;
  label: string;
  city_scope_id: string | null;
  city_scope_label: string | null;
};

type AipScopeCandidate = {
  scope_type: BudgetAllocationScopeType;
  scope_id: string;
  fiscal_year: number;
  created_at: string | null;
  aip_id: string;
};

type LegacyProjectRow = {
  id: string;
  aip_id: string;
  sector_code: string | null;
  total: number | null;
};

type ProjectListRow = {
  id: string;
  aip_ref_code: string | null;
  program_project_description: string;
  source_of_funds: string | null;
  total: number | null;
  sector_code: string | null;
};

type RollupRow = {
  aip_id: string;
  fiscal_year: number;
  scope_type: BudgetAllocationScopeType | string;
  scope_id: string;
  scope_name: string | null;
  total_budget: number | string | null;
  project_total_budget: number | string | null;
  sector_1000_total: number | string | null;
  sector_3000_total: number | string | null;
  sector_8000_total: number | string | null;
  sector_9000_total: number | string | null;
};

function toRepoError(
  status: number,
  code: CitizenBudgetAllocationRepoErrorCode,
  message: string
): CitizenBudgetAllocationRepoError {
  return new CitizenBudgetAllocationRepoError(code, status, message);
}

export function isCitizenBudgetAllocationRepoError(
  value: unknown
): value is CitizenBudgetAllocationRepoError {
  return value instanceof CitizenBudgetAllocationRepoError;
}

function toLguKey(scopeType: BudgetAllocationScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

function parseLguKey(
  key: string
): { scopeType: BudgetAllocationScopeType; scopeId: string } | null {
  const [scopeTypeRaw, scopeId] = key.split(":");
  if ((scopeTypeRaw !== "city" && scopeTypeRaw !== "barangay") || !scopeId) {
    return null;
  }
  return {
    scopeType: scopeTypeRaw,
    scopeId,
  };
}

function sortYearsDesc(values: number[]): number[] {
  return [...values].sort((a, b) => b - a);
}

function sortLguOptions(options: LguOption[]): LguOption[] {
  return [...options].sort((left, right) => {
    if (left.scope_type !== right.scope_type) {
      return left.scope_type === "city" ? -1 : 1;
    }
    const byLabel = left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    });
    if (byLabel !== 0) return byLabel;
    return left.scope_id.localeCompare(right.scope_id);
  });
}

function buildFallbackLabel(
  scopeType: BudgetAllocationScopeType,
  scopeId: string
): string {
  const prefix = scopeType === "city" ? "City of" : "Brgy.";
  return `${prefix} ${scopeId.slice(0, 8)}`;
}

function normalizeLguLabel(
  scopeType: BudgetAllocationScopeType,
  rawName: string,
  scopeId: string
): string {
  const name = rawName.trim();
  if (!name) return buildFallbackLabel(scopeType, scopeId);

  if (scopeType === "barangay") {
    if (/^(brgy\.?|barangay)\b/i.test(name)) return name;
    return `Brgy. ${name}`;
  }

  if (/\bcity\b/i.test(name)) return name;
  return `City of ${name}`;
}

function normalizeCityLabel(rawName: string, scopeId: string): string {
  const name = rawName.trim();
  if (!name) return buildFallbackLabel("city", scopeId);
  if (/\bcity\b/i.test(name)) return name;
  return `City of ${name}`;
}

function compareCreatedAtDesc(
  leftCreatedAt: string | null,
  rightCreatedAt: string | null
): number {
  const leftMs = Date.parse(leftCreatedAt ?? "");
  const rightMs = Date.parse(rightCreatedAt ?? "");
  const normalizedLeft = Number.isFinite(leftMs)
    ? leftMs
    : Number.NEGATIVE_INFINITY;
  const normalizedRight = Number.isFinite(rightMs)
    ? rightMs
    : Number.NEGATIVE_INFINITY;

  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? -1 : 1;
}

function compareByUploadDescThenId(
  left: AipScopeCandidate,
  right: AipScopeCandidate
): number {
  const byCreatedAt = compareCreatedAtDesc(left.created_at, right.created_at);
  if (byCreatedAt !== 0) return byCreatedAt;
  return right.aip_id.localeCompare(left.aip_id);
}

function compareCabuyaoCandidates(
  left: AipScopeCandidate,
  right: AipScopeCandidate
): number {
  if (left.fiscal_year !== right.fiscal_year) {
    return right.fiscal_year - left.fiscal_year;
  }
  return compareByUploadDescThenId(left, right);
}

function toAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;

  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDisplayRefCode(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : UNSPECIFIED_REF_CODE;
}

function toDashboardSectorCodeOrOther(
  value: string | null | undefined
): DashboardSectorCode {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.startsWith("1000")) return "1000";
  if (normalized.startsWith("3000")) return "3000";
  if (normalized.startsWith("8000")) return "8000";
  return "9000";
}

function matchesOtherSector(value: string | null | undefined): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return true;
  return (
    !normalized.startsWith("1000") &&
    !normalized.startsWith("3000") &&
    !normalized.startsWith("8000")
  );
}

function escapeForIlike(input: string): string {
  return input.replace(/[%_,]/g, (token) => `\\${token}`);
}

function buildOtherSectorClause(): string {
  return "sector_code.is.null,and(sector_code.not.like.1000%,sector_code.not.like.3000%,sector_code.not.like.8000%)";
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return BUDGET_ALLOCATION_DEFAULT_PAGE_SIZE;
  return Math.min(50, Math.max(5, Math.floor(value)));
}

function asValidScopeId(value: string): string {
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw toRepoError(400, "BAD_REQUEST", "Invalid scope_id. Expected UUID format.");
  }
  return trimmed;
}

function asValidFiscalYear(value: number): number {
  if (!Number.isInteger(value) || value < 1900) {
    throw toRepoError(400, "BAD_REQUEST", "Invalid fiscal_year.");
  }
  return value;
}

function parseProjectsInput(
  input: BudgetAllocationProjectsInput
): BudgetAllocationProjectsInput {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw toRepoError(400, "BAD_REQUEST", "Invalid page. Expected positive integer.");
  }

  return {
    ...input,
    fiscalYear: asValidFiscalYear(input.fiscalYear),
    scopeId: asValidScopeId(input.scopeId),
    pageSize: clampPageSize(input.pageSize),
    q: (input.q ?? "").trim(),
    countMode: input.countMode === "none" ? "none" : "exact",
    sectorCode: input.sectorCode ?? null,
  };
}
async function loadFiltersUncached(
  input: BudgetAllocationFiltersInput
): Promise<BudgetAllocationFiltersPayload> {
  const client = supabasePublicServer();

  const { data: aipRows, error: aipsError } = await client
    .from("aips")
    .select("id,fiscal_year,city_id,barangay_id,created_at")
    .eq("status", "published")
    .or("city_id.not.is.null,barangay_id.not.is.null");

  if (aipsError) {
    throw toRepoError(
      500,
      "INTERNAL_ERROR",
      "Failed to load published budget allocation filters."
    );
  }

  const yearsByLgu = new Map<string, Set<number>>();
  const allLguKeys = new Set<string>();
  const cityIds = new Set<string>();
  const barangayIds = new Set<string>();
  const scopeCandidates: AipScopeCandidate[] = [];

  for (const row of (aipRows ?? []) as PublishedAipRow[]) {
    if (!Number.isInteger(row.fiscal_year) || row.fiscal_year < 1900) continue;

    if (row.city_id) {
      const key = toLguKey("city", row.city_id);
      allLguKeys.add(key);
      cityIds.add(row.city_id);
      scopeCandidates.push({
        scope_type: "city",
        scope_id: row.city_id,
        fiscal_year: row.fiscal_year,
        created_at: row.created_at,
        aip_id: row.id,
      });
      const years = yearsByLgu.get(key) ?? new Set<number>();
      years.add(row.fiscal_year);
      yearsByLgu.set(key, years);
    }

    if (row.barangay_id) {
      const key = toLguKey("barangay", row.barangay_id);
      allLguKeys.add(key);
      barangayIds.add(row.barangay_id);
      scopeCandidates.push({
        scope_type: "barangay",
        scope_id: row.barangay_id,
        fiscal_year: row.fiscal_year,
        created_at: row.created_at,
        aip_id: row.id,
      });
      const years = yearsByLgu.get(key) ?? new Set<number>();
      years.add(row.fiscal_year);
      yearsByLgu.set(key, years);
    }
  }

  if (allLguKeys.size === 0) {
    return {
      has_data: false,
      years: [],
      lgus: [],
      selected: null,
    };
  }

  const barangaysResult =
    barangayIds.size > 0
      ? await client
          .from("barangays")
          .select("id,name,city_id,municipality_id")
          .in("id", [...barangayIds])
      : { data: [], error: null };

  if (barangaysResult.error) {
    throw toRepoError(
      500,
      "INTERNAL_ERROR",
      "Failed to resolve LGU names for budget allocation filters."
    );
  }

  const barangayRows = (barangaysResult.data ?? []) as BarangayScopeRow[];
  const parentCityIdsFromBarangays = new Set(
    barangayRows
      .map((row) => row.city_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const municipalityIdsFromBarangays = new Set(
    barangayRows
      .map((row) => row.city_id ? null : row.municipality_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );

  const cityLookupIds = Array.from(new Set([...cityIds, ...parentCityIdsFromBarangays]));
  const [citiesResult, municipalitiesResult] = await Promise.all([
    cityLookupIds.length > 0
      ? client.from("cities").select("id,name,psgc_code").in("id", cityLookupIds)
      : Promise.resolve({ data: [], error: null }),
    municipalityIdsFromBarangays.size > 0
      ? client
          .from("municipalities")
          .select("id,name")
          .in("id", [...municipalityIdsFromBarangays])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (citiesResult.error || municipalitiesResult.error) {
    throw toRepoError(
      500,
      "INTERNAL_ERROR",
      "Failed to resolve LGU names for budget allocation filters."
    );
  }

  const cityRows = (citiesResult.data ?? []) as CityScopeRow[];
  const cityNameById = new Map(cityRows.map((row) => [row.id, row.name?.trim() ?? ""]));
  const municipalityNameById = new Map(
    ((municipalitiesResult.data ?? []) as ScopeNameRow[]).map((row) => [
      row.id,
      row.name?.trim() ?? "",
    ])
  );
  const cabuyaoCityIds = new Set(
    cityRows
      .filter((row) => (row.psgc_code ?? "").trim() === CABUYAO_CITY_PSGC)
      .map((row) => row.id)
  );
  const barangayNameById = new Map(barangayRows.map((row) => [row.id, row.name?.trim() ?? ""]));
  const parentCityByBarangayId = new Map<
    string,
    { city_scope_id: string | null; city_scope_label: string | null }
  >(
    barangayRows.map((row) => {
      const parentScopeId = row.city_id ?? row.municipality_id ?? null;
      const parentRawName = row.city_id
        ? cityNameById.get(row.city_id) ?? ""
        : row.municipality_id
          ? municipalityNameById.get(row.municipality_id) ?? ""
          : "";
      return [
        row.id,
        {
          city_scope_id: parentScopeId,
          city_scope_label: parentScopeId
            ? normalizeCityLabel(parentRawName, parentScopeId)
            : null,
        },
      ];
    })
  );

  const optionByKey = new Map<string, LguOption>();
  for (const key of allLguKeys) {
    const parsedKey = parseLguKey(key);
    if (!parsedKey) continue;

    if (parsedKey.scopeType === "city") {
      const label = normalizeLguLabel(
        parsedKey.scopeType,
        cityNameById.get(parsedKey.scopeId) ?? "",
        parsedKey.scopeId
      );
      optionByKey.set(key, {
        scope_type: parsedKey.scopeType,
        scope_id: parsedKey.scopeId,
        label,
        city_scope_id: parsedKey.scopeId,
        city_scope_label: label,
      });
      continue;
    }

    const label = normalizeLguLabel(
      parsedKey.scopeType,
      barangayNameById.get(parsedKey.scopeId) ?? "",
      parsedKey.scopeId
    );
    const parentScope = parentCityByBarangayId.get(parsedKey.scopeId);
    optionByKey.set(key, {
      scope_type: parsedKey.scopeType,
      scope_id: parsedKey.scopeId,
      label,
      city_scope_id: parentScope?.city_scope_id ?? null,
      city_scope_label: parentScope?.city_scope_label ?? null,
    });
  }

  const allLgus = sortLguOptions(
    [...allLguKeys]
      .map((key) => optionByKey.get(key))
      .filter((value): value is LguOption => !!value)
  );
  if (allLgus.length === 0) {
    return {
      has_data: false,
      years: [],
      lgus: [],
      selected: null,
    };
  }

  const getYearsForLgu = (lguKey: string): number[] =>
    sortYearsDesc([...(yearsByLgu.get(lguKey) ?? new Set<number>())]);

  const getLatestYearForLgu = (option: LguOption): number | null => {
    const key = toLguKey(option.scope_type, option.scope_id);
    return getYearsForLgu(key)[0] ?? null;
  };

  const requestedScope = input.requestedScope ?? null;
  const requestedLguKey = requestedScope
    ? toLguKey(requestedScope.scopeType, requestedScope.scopeId)
    : null;
  const requestedLguOption = requestedLguKey ? optionByKey.get(requestedLguKey) : null;

  const defaultCabuyaoCandidate =
    scopeCandidates
      .filter(
        (candidate) =>
          candidate.scope_type === "city" && cabuyaoCityIds.has(candidate.scope_id)
      )
      .sort(compareCabuyaoCandidates)[0] ?? null;
  const defaultCityCandidate =
    scopeCandidates
      .filter((candidate) => candidate.scope_type === "city")
      .sort(compareByUploadDescThenId)[0] ?? null;
  const defaultBarangayCandidate =
    scopeCandidates
      .filter((candidate) => candidate.scope_type === "barangay")
      .sort(compareByUploadDescThenId)[0] ?? null;

  const defaultLgu = (() => {
    if (defaultCabuyaoCandidate) {
      const option = optionByKey.get(toLguKey("city", defaultCabuyaoCandidate.scope_id));
      if (option) return option;
    }

    if (defaultCityCandidate) {
      const option = optionByKey.get(toLguKey("city", defaultCityCandidate.scope_id));
      if (option) return option;
    }

    if (defaultBarangayCandidate) {
      const option = optionByKey.get(toLguKey("barangay", defaultBarangayCandidate.scope_id));
      if (option) return option;
    }

    return allLgus[0] ?? null;
  })();

  if (!defaultLgu) {
    return {
      has_data: false,
      years: [],
      lgus: [],
      selected: null,
    };
  }

  const requestedYear =
    typeof input.fiscalYear === "number" && Number.isInteger(input.fiscalYear)
      ? input.fiscalYear
      : null;
  let selectedLgu = requestedLguOption ?? defaultLgu;
  const selectedKey = toLguKey(selectedLgu.scope_type, selectedLgu.scope_id);
  const selectedYears = getYearsForLgu(selectedKey);

  let selectedYear: number | null = null;
  if (requestedLguOption && requestedYear !== null && selectedYears.includes(requestedYear)) {
    selectedYear = requestedYear;
  } else {
    selectedYear = selectedYears[0] ?? null;
  }

  if (selectedYear === null) {
    const fallback = allLgus
      .map((option) => ({ option, year: getLatestYearForLgu(option) }))
      .find((entry): entry is { option: LguOption; year: number } => typeof entry.year === "number");

    if (!fallback) {
      return {
        has_data: false,
        years: [],
        lgus: [],
        selected: null,
      };
    }

    selectedLgu = fallback.option;
    selectedYear = fallback.year;
  }

  const years = getYearsForLgu(toLguKey(selectedLgu.scope_type, selectedLgu.scope_id));

  return {
    has_data: true,
    years,
    lgus: allLgus,
    selected: {
      fiscal_year: selectedYear,
      scope_type: selectedLgu.scope_type,
      scope_id: selectedLgu.scope_id,
    },
  };
}

async function getRollupRowsByScope(input: {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
}): Promise<{ selected: RollupRow | null; trend: RollupRow[] }> {
  const client = supabasePublicServer();
  const [selectedResult, trendResult] = await Promise.all([
    client
      .from("v_citizen_dashboard_published_rollups")
      .select(
        "aip_id,fiscal_year,scope_type,scope_id,scope_name,total_budget,project_total_budget,sector_1000_total,sector_3000_total,sector_8000_total,sector_9000_total"
      )
      .eq("scope_type", input.scopeType)
      .eq("scope_id", input.scopeId)
      .eq("fiscal_year", input.fiscalYear)
      .eq("is_latest_scope_year", true)
      .limit(1)
      .maybeSingle<RollupRow>(),
    client
      .from("v_citizen_dashboard_published_rollups")
      .select(
        "aip_id,fiscal_year,scope_type,scope_id,scope_name,total_budget,project_total_budget,sector_1000_total,sector_3000_total,sector_8000_total,sector_9000_total"
      )
      .eq("scope_type", input.scopeType)
      .eq("scope_id", input.scopeId)
      .eq("is_latest_scope_year", true)
      .lte("fiscal_year", input.fiscalYear)
      .order("fiscal_year", { ascending: false })
      .limit(5)
      .returns<RollupRow[]>(),
  ]);

  if (selectedResult.error) {
    throw new Error(selectedResult.error.message);
  }
  if (trendResult.error) {
    throw new Error(trendResult.error.message);
  }

  return {
    selected: selectedResult.data ?? null,
    trend: trendResult.data ?? [],
  };
}

function toSectorTotalsWithResidual(row: RollupRow): Record<DashboardSectorCode, number> {
  const totalBudget = toAmount(row.total_budget);
  const projectTotal = toAmount(row.project_total_budget);
  const residualToOther = Math.max(totalBudget - projectTotal, 0);

  return {
    "1000": toAmount(row.sector_1000_total),
    "3000": toAmount(row.sector_3000_total),
    "8000": toAmount(row.sector_8000_total),
    "9000": toAmount(row.sector_9000_total) + residualToOther,
  };
}

function toSummaryFromRollups(input: {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
  selected: RollupRow;
  trendRows: RollupRow[];
}): BudgetAllocationSummaryPayload {
  const selectedSectorTotals = toSectorTotalsWithResidual(input.selected);
  const overallTotal = toAmount(input.selected.total_budget);

  const bySector = DBV2_SECTOR_CODES.map((sectorCode) => {
    const total = selectedSectorTotals[sectorCode];
    return {
      sector_code: sectorCode,
      sector_label: getSectorLabel(sectorCode),
      total,
      pct: overallTotal > 0 ? total / overallTotal : 0,
    };
  });

  const trendRowsAsc = [...input.trendRows].sort(
    (left, right) => left.fiscal_year - right.fiscal_year
  );
  const years = trendRowsAsc.map((row) => row.fiscal_year);

  const series = DBV2_SECTOR_CODES.map((sectorCode) => ({
    sector_code: sectorCode,
    sector_label: getSectorLabel(sectorCode),
    values: trendRowsAsc.map((row) => toSectorTotalsWithResidual(row)[sectorCode]),
  }));

  return {
    scope: {
      fiscal_year: input.fiscalYear,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_name: input.selected.scope_name ?? null,
    },
    totals: {
      overall_total: overallTotal,
      by_sector: bySector,
    },
    trend: {
      years,
      series,
    },
  };
}
async function listProjectsByAipIds(
  aipIds: string[]
): Promise<LegacyProjectRow[]> {
  const dedupedAipIds = Array.from(
    new Set(aipIds.filter((value) => typeof value === "string" && value.length > 0))
  );
  if (dedupedAipIds.length === 0) return [];

  const client = supabasePublicServer();
  return collectInChunksPaged(dedupedAipIds, async (aipIdChunk, from, to) => {
    const { data, error } = await client
      .from("projects")
      .select("id,aip_id,sector_code,total")
      .in("aip_id", aipIdChunk)
      .order("aip_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as LegacyProjectRow[];
  });
}

async function getSummaryFromLegacy(
  input: BudgetAllocationSummaryInput
): Promise<BudgetAllocationSummaryPayload> {
  const client = supabasePublicServer();
  const scopeColumn = input.scopeType === "city" ? "city_id" : "barangay_id";
  const scopeTable = input.scopeType === "city" ? "cities" : "barangays";

  const [
    { data: scopeRow, error: scopeError },
    { data: publishedAips, error: aipsError },
    { data: selectedYearAips, error: selectedYearAipsError },
  ] = await Promise.all([
    client.from(scopeTable).select("name").eq("id", input.scopeId).maybeSingle(),
    client
      .from("aips")
      .select("id,fiscal_year")
      .eq("status", "published")
      .eq(scopeColumn, input.scopeId)
      .lte("fiscal_year", input.fiscalYear)
      .order("fiscal_year", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(100),
    client
      .from("aips")
      .select("id,fiscal_year")
      .eq("status", "published")
      .eq("fiscal_year", input.fiscalYear)
      .eq(scopeColumn, input.scopeId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  if (scopeError) {
    throw toRepoError(500, "INTERNAL_ERROR", "Failed to resolve scope details.");
  }
  if (aipsError || selectedYearAipsError) {
    throw toRepoError(
      500,
      "INTERNAL_ERROR",
      "Failed to load published budget allocation data."
    );
  }

  const selectedAipId =
    (selectedYearAips?.[0] as { id: string; fiscal_year: number } | undefined)?.id ??
    null;
  if (!selectedAipId) {
    throw toRepoError(
      404,
      "NOT_FOUND",
      "No published budget allocation was found for the selected fiscal year and LGU scope."
    );
  }

  const trendAipsByYear = new Map<number, { id: string; fiscal_year: number }>();
  for (const row of (publishedAips ?? []) as Array<{ id: string; fiscal_year: number }>) {
    if (!Number.isInteger(row.fiscal_year)) continue;
    if (trendAipsByYear.has(row.fiscal_year)) continue;
    trendAipsByYear.set(row.fiscal_year, row);
    if (trendAipsByYear.size >= 5) break;
  }

  const trendAips = [...trendAipsByYear.values()].sort(
    (a, b) => a.fiscal_year - b.fiscal_year
  );
  const trendAipIds = trendAips.map((aip) => aip.id);
  const yearByAipId = new Map(trendAips.map((aip) => [aip.id, aip.fiscal_year]));

  const relevantAipIds = Array.from(new Set([selectedAipId, ...trendAipIds]));
  const allRelevantProjects = await listProjectsByAipIds(relevantAipIds);
  const trendAipIdSet = new Set(trendAipIds);
  const selectedProjects = allRelevantProjects.filter(
    (project) => project.aip_id === selectedAipId
  );
  const trendProjects = allRelevantProjects.filter((project) =>
    trendAipIdSet.has(project.aip_id)
  );

  const totalsBySector = new Map<DashboardSectorCode, number>(
    DBV2_SECTOR_CODES.map((code) => [code, 0])
  );

  selectedProjects.forEach((project) => {
    const code = toDashboardSectorCodeOrOther(project.sector_code);
    totalsBySector.set(code, (totalsBySector.get(code) ?? 0) + toAmount(project.total));
  });

  const fallbackTotalsByAipId = buildProjectTotalsByAipId(
    selectedProjects.map((row) => ({
      aip_id: row.aip_id,
      total: row.total,
    }))
  );
  const fileTotalsByAipId = await fetchAipFileTotalsByAipIds(client, [selectedAipId]);
  const overallTotal = resolveAipDisplayTotal({
    aipId: selectedAipId,
    fileTotalsByAipId,
    fallbackTotalsByAipId,
  });

  const selectedProjectTotal = fallbackTotalsByAipId.get(selectedAipId) ?? 0;
  const residualToOther = overallTotal - selectedProjectTotal;
  if (residualToOther > 0) {
    totalsBySector.set("9000", (totalsBySector.get("9000") ?? 0) + residualToOther);
  }

  const bySector = DBV2_SECTOR_CODES.map((sectorCode) => {
    const total = totalsBySector.get(sectorCode) ?? 0;
    return {
      sector_code: sectorCode,
      sector_label: getSectorLabel(sectorCode),
      total,
      pct: overallTotal > 0 ? total / overallTotal : 0,
    };
  });

  const years = trendAips.map((aip) => aip.fiscal_year);
  const yearSectorTotals = new Map<number, Map<DashboardSectorCode, number>>();

  years.forEach((year) => {
    yearSectorTotals.set(
      year,
      new Map<DashboardSectorCode, number>(DBV2_SECTOR_CODES.map((code) => [code, 0]))
    );
  });

  trendProjects.forEach((project) => {
    const year = yearByAipId.get(project.aip_id);
    const code = toDashboardSectorCodeOrOther(project.sector_code);
    if (typeof year !== "number" || !yearSectorTotals.has(year)) return;
    const sectorMap = yearSectorTotals.get(year);
    if (!sectorMap) return;
    sectorMap.set(code, (sectorMap.get(code) ?? 0) + toAmount(project.total));
  });

  const series = DBV2_SECTOR_CODES.map((sectorCode) => ({
    sector_code: sectorCode,
    sector_label: getSectorLabel(sectorCode),
    values: years.map((year) => yearSectorTotals.get(year)?.get(sectorCode) ?? 0),
  }));

  return {
    scope: {
      fiscal_year: input.fiscalYear,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_name: (scopeRow as { name?: string | null } | null)?.name ?? null,
    },
    totals: {
      overall_total: overallTotal,
      by_sector: bySector,
    },
    trend: {
      years,
      series,
    },
  };
}

async function loadSummaryUncached(
  input: BudgetAllocationSummaryInput
): Promise<BudgetAllocationSummaryPayload> {
  const normalizedInput: BudgetAllocationSummaryInput = {
    fiscalYear: asValidFiscalYear(input.fiscalYear),
    scopeType: input.scopeType,
    scopeId: asValidScopeId(input.scopeId),
  };

  try {
    const { selected, trend } = await getRollupRowsByScope(normalizedInput);
    if (!selected) {
      throw toRepoError(
        404,
        "NOT_FOUND",
        "No published budget allocation was found for the selected fiscal year and LGU scope."
      );
    }

    return toSummaryFromRollups({
      fiscalYear: normalizedInput.fiscalYear,
      scopeType: normalizedInput.scopeType,
      scopeId: normalizedInput.scopeId,
      selected,
      trendRows: trend,
    });
  } catch (error) {
    if (isCitizenBudgetAllocationRepoError(error) && error.status === 400) {
      throw error;
    }

    return getSummaryFromLegacy(normalizedInput);
  }
}

async function resolvePublishedAipId(
  input: BudgetAllocationSummaryInput
): Promise<string> {
  const client = supabasePublicServer();

  try {
    const viewResult = await client
      .from("v_citizen_dashboard_published_rollups")
      .select("aip_id")
      .eq("scope_type", input.scopeType)
      .eq("scope_id", input.scopeId)
      .eq("fiscal_year", input.fiscalYear)
      .eq("is_latest_scope_year", true)
      .limit(1)
      .maybeSingle<{ aip_id: string }>();

    if (!viewResult.error && viewResult.data?.aip_id) {
      return viewResult.data.aip_id;
    }
  } catch {
    // Fall back to direct AIP lookup when the rollup view is unavailable.
  }

  const scopeColumn = input.scopeType === "city" ? "city_id" : "barangay_id";
  const legacyResult = await client
    .from("aips")
    .select("id")
    .eq("status", "published")
    .eq("fiscal_year", input.fiscalYear)
    .eq(scopeColumn, input.scopeId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (legacyResult.error) {
    throw toRepoError(
      500,
      "INTERNAL_ERROR",
      "Failed to validate published budget allocation scope."
    );
  }

  if (!legacyResult.data?.id) {
    throw toRepoError(
      404,
      "NOT_FOUND",
      "No published budget allocation was found for the selected fiscal year and LGU scope."
    );
  }

  return legacyResult.data.id;
}

function buildProjectsQuery(input: {
  aipId: string;
  withCount: boolean;
  sectorCode: DashboardSectorCode | null;
  q: string;
}) {
  const client = supabasePublicServer();
  let query = client
    .from("projects")
    .select(
      "id,aip_ref_code,program_project_description,source_of_funds,total,sector_code",
      input.withCount ? { count: "exact" } : undefined
    )
    .eq("aip_id", input.aipId);

  const escapedQuery = input.q ? escapeForIlike(input.q) : "";
  const otherSectorClause = buildOtherSectorClause();
  const otherSectorGroup = `or(${otherSectorClause})`;

  if (input.sectorCode === "9000" && escapedQuery) {
    query = query.or(
      `and(aip_ref_code.ilike.%${escapedQuery}%,${otherSectorGroup}),and(program_project_description.ilike.%${escapedQuery}%,${otherSectorGroup})`
    );
    return query;
  }

  if (input.sectorCode === "9000") {
    query = query.or(otherSectorClause);
  } else if (input.sectorCode) {
    query = query.eq("sector_code", input.sectorCode);
  }

  if (escapedQuery) {
    query = query.or(
      `aip_ref_code.ilike.%${escapedQuery}%,program_project_description.ilike.%${escapedQuery}%`
    );
  }

  return query;
}

async function loadProjectsPageUncached(
  input: BudgetAllocationProjectsInput
): Promise<BudgetAllocationProjectsPayload> {
  const parsed = parseProjectsInput(input);
  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;

  const selectedAipId = await resolvePublishedAipId({
    fiscalYear: parsed.fiscalYear,
    scopeType: parsed.scopeType,
    scopeId: parsed.scopeId,
  });

  const { data, error, count } = await buildProjectsQuery({
    aipId: selectedAipId,
    withCount: parsed.countMode !== "none",
    sectorCode: parsed.sectorCode ?? null,
    q: parsed.q ?? "",
  })
    .order("total", { ascending: false, nullsFirst: false })
    .order("aip_ref_code", { ascending: true })
    .range(from, to)
    .returns<ProjectListRow[]>();

  if (error) {
    throw toRepoError(500, "INTERNAL_ERROR", "Failed to load project list.");
  }

  const scopedRows =
    parsed.sectorCode === "9000"
      ? (data ?? []).filter((row) => matchesOtherSector(row.sector_code))
      : data ?? [];

  const items = scopedRows.map((row) => ({
    project_id: row.id,
    aip_ref_code: toDisplayRefCode(row.aip_ref_code),
    program_project_description: row.program_project_description,
    source_of_funds: row.source_of_funds,
    total: toAmount(row.total),
  }));

  const totalRows = parsed.countMode === "exact" ? count ?? 0 : -1;
  const totalPages =
    totalRows >= 0 ? Math.max(1, Math.ceil(totalRows / parsed.pageSize)) : -1;

  return {
    items,
    page: parsed.page,
    pageSize: parsed.pageSize,
    totalRows,
    totalPages,
  };
}
const ENABLE_NEXT_CACHE = process.env.NODE_ENV !== "test";

const getBudgetAllocationFiltersCached = ENABLE_NEXT_CACHE
  ? unstable_cache(
      async (
        fiscalYear: number | null,
        scopeType: BudgetAllocationScopeType | null,
        scopeId: string | null,
        prefer: "year" | "lgu" | null
      ) =>
        loadFiltersUncached({
          fiscalYear,
          requestedScope:
            scopeType && scopeId
              ? {
                  scopeType,
                  scopeId,
                }
              : null,
          prefer,
        }),
      ["citizen-budget-allocation:filters:v3"],
      {
        revalidate: CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
        tags: [CITIZEN_DASHBOARD_CACHE_TAGS.budgetFilters],
      }
    )
  : async (
      fiscalYear: number | null,
      scopeType: BudgetAllocationScopeType | null,
      scopeId: string | null,
      prefer: "year" | "lgu" | null
    ) =>
      loadFiltersUncached({
        fiscalYear,
        requestedScope:
          scopeType && scopeId
            ? {
                scopeType,
                scopeId,
              }
            : null,
        prefer,
      });

const getBudgetAllocationSummaryCached = ENABLE_NEXT_CACHE
  ? unstable_cache(
      async (fiscalYear: number, scopeType: BudgetAllocationScopeType, scopeId: string) =>
        loadSummaryUncached({
          fiscalYear,
          scopeType,
          scopeId,
        }),
      ["citizen-budget-allocation:summary:v1"],
      {
        revalidate: CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
        tags: [CITIZEN_DASHBOARD_CACHE_TAGS.budgetSummary],
      }
    )
  : async (fiscalYear: number, scopeType: BudgetAllocationScopeType, scopeId: string) =>
      loadSummaryUncached({
        fiscalYear,
        scopeType,
        scopeId,
      });

const getBudgetAllocationProjectsCached = ENABLE_NEXT_CACHE
  ? unstable_cache(
      async (
        fiscalYear: number,
        scopeType: BudgetAllocationScopeType,
        scopeId: string,
        sectorCode: DashboardSectorCode | null,
        page: number,
        pageSize: number,
        q: string,
        countMode: "exact" | "none"
      ) =>
        loadProjectsPageUncached({
          fiscalYear,
          scopeType,
          scopeId,
          sectorCode,
          page,
          pageSize,
          q,
          countMode,
        }),
      ["citizen-budget-allocation:projects:v1"],
      {
        revalidate: CITIZEN_DASHBOARD_PROJECTS_REVALIDATE_SECONDS,
        tags: [CITIZEN_DASHBOARD_CACHE_TAGS.budgetProjects],
      }
    )
  : async (
      fiscalYear: number,
      scopeType: BudgetAllocationScopeType,
      scopeId: string,
      sectorCode: DashboardSectorCode | null,
      page: number,
      pageSize: number,
      q: string,
      countMode: "exact" | "none"
    ) =>
      loadProjectsPageUncached({
        fiscalYear,
        scopeType,
        scopeId,
        sectorCode,
        page,
        pageSize,
        q,
        countMode,
      });

export async function getCitizenBudgetAllocationFilters(
  input: BudgetAllocationFiltersInput = {}
): Promise<BudgetAllocationFiltersPayload> {
  return measureTiming({
    label: "budget-allocation.filters",
    meta: {
      fiscalYear: input.fiscalYear ?? null,
      scopeType: input.requestedScope?.scopeType ?? null,
      hasScopeId: Boolean(input.requestedScope?.scopeId),
      prefer: input.prefer ?? null,
    },
    run: async () =>
      getBudgetAllocationFiltersCached(
        input.fiscalYear ?? null,
        input.requestedScope?.scopeType ?? null,
        input.requestedScope?.scopeId ?? null,
        input.prefer ?? null
      ),
  });
}

export async function getCitizenBudgetAllocationSummary(
  input: BudgetAllocationSummaryInput
): Promise<BudgetAllocationSummaryPayload> {
  return measureTiming({
    label: "budget-allocation.summary",
    meta: {
      fiscalYear: input.fiscalYear,
      scopeType: input.scopeType,
      hasScopeId: Boolean(input.scopeId),
    },
    run: async () =>
      getBudgetAllocationSummaryCached(
        asValidFiscalYear(input.fiscalYear),
        input.scopeType,
        asValidScopeId(input.scopeId)
      ),
  });
}

export async function getCitizenBudgetAllocationProjectsPage(
  input: BudgetAllocationProjectsInput
): Promise<BudgetAllocationProjectsPayload> {
  const parsed = parseProjectsInput(input);

  return measureTiming({
    label: "budget-allocation.projects-page",
    meta: {
      fiscalYear: parsed.fiscalYear,
      scopeType: parsed.scopeType,
      hasScopeId: Boolean(parsed.scopeId),
      sectorCode: parsed.sectorCode ?? null,
      page: parsed.page,
      pageSize: parsed.pageSize,
      hasQuery: Boolean(parsed.q),
      countMode: parsed.countMode,
    },
    run: async () =>
      getBudgetAllocationProjectsCached(
        parsed.fiscalYear,
        parsed.scopeType,
        parsed.scopeId,
        parsed.sectorCode ?? null,
        parsed.page,
        parsed.pageSize,
        parsed.q ?? "",
        parsed.countMode ?? "exact"
      ),
  });
}

export async function getCitizenBudgetAllocationInitialPayload(
  input: BudgetAllocationFiltersInput = {}
): Promise<BudgetAllocationInitialPayload> {
  return measureTiming({
    label: "budget-allocation.initial-payload",
    meta: {
      fiscalYear: input.fiscalYear ?? null,
      scopeType: input.requestedScope?.scopeType ?? null,
      hasScopeId: Boolean(input.requestedScope?.scopeId),
    },
    run: async () => {
      const filters = await getCitizenBudgetAllocationFilters(input);

      if (!filters.has_data || !filters.selected) {
        return {
          filters,
          summary: null,
          projects: null,
        };
      }

      const selected = filters.selected;
      const [summary, projects] = await Promise.all([
        getCitizenBudgetAllocationSummary({
          fiscalYear: selected.fiscal_year,
          scopeType: selected.scope_type,
          scopeId: selected.scope_id,
        }).catch((error) => {
          if (isCitizenBudgetAllocationRepoError(error) && error.status === 404) {
            return null;
          }
          throw error;
        }),
        getCitizenBudgetAllocationProjectsPage({
          fiscalYear: selected.fiscal_year,
          scopeType: selected.scope_type,
          scopeId: selected.scope_id,
          sectorCode: BUDGET_ALLOCATION_DEFAULT_SECTOR_CODE,
          page: 1,
          pageSize: BUDGET_ALLOCATION_DEFAULT_PAGE_SIZE,
          q: "",
          countMode: "exact",
        }).catch((error) => {
          if (isCitizenBudgetAllocationRepoError(error) && error.status === 404) {
            return null;
          }
          throw error;
        }),
      ]);

      return {
        filters,
        summary,
        projects,
      };
    },
  });
}
