import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CABUYAO_CITY_PSGC = "043404";

type ScopeType = "city" | "barangay";
type FiltersErrorCode = "BAD_REQUEST" | "INTERNAL_ERROR";

type ParsedParams = {
  fiscalYear: number | null;
  prefer: "year" | "lgu" | null;
  requestedScope: {
    scopeType: ScopeType;
    scopeId: string;
  } | null;
};

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

type LguOption = {
  scope_type: ScopeType;
  scope_id: string;
  label: string;
};

type AipScopeCandidate = {
  scope_type: ScopeType;
  scope_id: string;
  fiscal_year: number;
  created_at: string | null;
  aip_id: string;
};

function errorResponse(status: number, code: FiltersErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseParams(searchParams: URLSearchParams): ParsedParams | null {
  const fiscalYearRaw = searchParams.get("fiscal_year");
  const preferRaw = searchParams.get("prefer");
  const scopeTypeRaw = searchParams.get("scope_type");
  const scopeIdRaw = searchParams.get("scope_id")?.trim() ?? "";

  const hasScopeType = typeof scopeTypeRaw === "string" && scopeTypeRaw.length > 0;
  const hasScopeId = scopeIdRaw.length > 0;

  if (hasScopeType !== hasScopeId) return null;

  let fiscalYear: number | null = null;
  if (typeof fiscalYearRaw === "string" && fiscalYearRaw.trim().length > 0) {
    const parsedYear = Number(fiscalYearRaw);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900) return null;
    fiscalYear = parsedYear;
  }

  if (!hasScopeType || !hasScopeId) {
    return {
      fiscalYear,
      prefer: preferRaw === "year" || preferRaw === "lgu" ? preferRaw : null,
      requestedScope: null,
    };
  }

  if (scopeTypeRaw !== "city" && scopeTypeRaw !== "barangay") return null;
  if (!UUID_PATTERN.test(scopeIdRaw)) return null;

  return {
    fiscalYear,
    prefer: preferRaw === "year" || preferRaw === "lgu" ? preferRaw : null,
    requestedScope: {
      scopeType: scopeTypeRaw,
      scopeId: scopeIdRaw,
    },
  };
}

function toLguKey(scopeType: ScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

function parseLguKey(key: string): { scopeType: ScopeType; scopeId: string } | null {
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
    const byLabel = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    if (byLabel !== 0) return byLabel;
    return left.scope_id.localeCompare(right.scope_id);
  });
}

function buildFallbackLabel(scopeType: ScopeType, scopeId: string): string {
  const prefix = scopeType === "city" ? "City of" : "Brgy.";
  return `${prefix} ${scopeId.slice(0, 8)}`;
}

function normalizeLguLabel(scopeType: ScopeType, rawName: string, scopeId: string): string {
  const name = rawName.trim();
  if (!name) return buildFallbackLabel(scopeType, scopeId);

  if (scopeType === "barangay") {
    if (/^(brgy\.?|barangay)\b/i.test(name)) return name;
    return `Brgy. ${name}`;
  }

  if (/\bcity\b/i.test(name)) return name;
  return `City of ${name}`;
}

function compareCreatedAtDesc(leftCreatedAt: string | null, rightCreatedAt: string | null): number {
  const leftMs = Date.parse(leftCreatedAt ?? "");
  const rightMs = Date.parse(rightCreatedAt ?? "");
  const normalizedLeft = Number.isFinite(leftMs) ? leftMs : Number.NEGATIVE_INFINITY;
  const normalizedRight = Number.isFinite(rightMs) ? rightMs : Number.NEGATIVE_INFINITY;

  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? -1 : 1;
}

function compareByUploadDescThenId(left: AipScopeCandidate, right: AipScopeCandidate): number {
  const byCreatedAt = compareCreatedAtDesc(left.created_at, right.created_at);
  if (byCreatedAt !== 0) return byCreatedAt;
  return right.aip_id.localeCompare(left.aip_id);
}

function compareCabuyaoCandidates(left: AipScopeCandidate, right: AipScopeCandidate): number {
  if (left.fiscal_year !== right.fiscal_year) {
    return right.fiscal_year - left.fiscal_year;
  }
  return compareByUploadDescThenId(left, right);
}

export async function GET(request: Request) {
  const parsed = parseParams(new URL(request.url).searchParams);
  if (!parsed) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Invalid query params. Optional: fiscal_year, and paired scope_type (city|barangay) + scope_id (UUID)."
    );
  }

  try {
    const client = await supabaseServer();

    const { data: aipRows, error: aipsError } = await client
      .from("aips")
      .select("id,fiscal_year,city_id,barangay_id,created_at")
      .eq("status", "published")
      .or("city_id.not.is.null,barangay_id.not.is.null");

    if (aipsError) {
      return errorResponse(500, "INTERNAL_ERROR", "Failed to load published budget allocation filters.");
    }

    const yearsByLgu = new Map<string, Set<number>>();
    const lgusByYear = new Map<number, Set<string>>();
    const allYears = new Set<number>();
    const allLguKeys = new Set<string>();
    const cityIds = new Set<string>();
    const barangayIds = new Set<string>();
    const scopeCandidates: AipScopeCandidate[] = [];

    for (const row of (aipRows ?? []) as PublishedAipRow[]) {
      if (!Number.isInteger(row.fiscal_year) || row.fiscal_year < 1900) continue;
      allYears.add(row.fiscal_year);

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
        const lgus = lgusByYear.get(row.fiscal_year) ?? new Set<string>();
        lgus.add(key);
        lgusByYear.set(row.fiscal_year, lgus);
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
        const lgus = lgusByYear.get(row.fiscal_year) ?? new Set<string>();
        lgus.add(key);
        lgusByYear.set(row.fiscal_year, lgus);
      }
    }

    if (allLguKeys.size === 0 || allYears.size === 0) {
      return NextResponse.json({
        has_data: false,
        years: [],
        lgus: [],
        selected: null,
      });
    }

    const [citiesResult, barangaysResult] = await Promise.all([
      cityIds.size > 0
        ? client.from("cities").select("id,name,psgc_code").in("id", [...cityIds])
        : Promise.resolve({ data: [], error: null }),
      barangayIds.size > 0
        ? client.from("barangays").select("id,name").in("id", [...barangayIds])
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (citiesResult.error || barangaysResult.error) {
      return errorResponse(500, "INTERNAL_ERROR", "Failed to resolve LGU names for budget allocation filters.");
    }

    const cityRows = (citiesResult.data ?? []) as CityScopeRow[];
    const cityNameById = new Map(cityRows.map((row) => [row.id, row.name?.trim() ?? ""]));
    const cabuyaoCityIds = new Set(
      cityRows
        .filter((row) => (row.psgc_code ?? "").trim() === CABUYAO_CITY_PSGC)
        .map((row) => row.id)
    );
    const barangayNameById = new Map(
      ((barangaysResult.data ?? []) as ScopeNameRow[]).map((row) => [row.id, row.name?.trim() ?? ""])
    );

    const optionByKey = new Map<string, LguOption>();
    for (const key of allLguKeys) {
      const parsedKey = parseLguKey(key);
      if (!parsedKey) continue;

      let label = "";
      if (parsedKey.scopeType === "city") {
        label = cityNameById.get(parsedKey.scopeId) ?? "";
      } else {
        label = barangayNameById.get(parsedKey.scopeId) ?? "";
      }

      optionByKey.set(key, {
        scope_type: parsedKey.scopeType,
        scope_id: parsedKey.scopeId,
        label: normalizeLguLabel(parsedKey.scopeType, label, parsedKey.scopeId),
      });
    }

    const allYearsSorted = sortYearsDesc([...allYears]);
    const allLgusSorted = sortLguOptions(
      [...allLguKeys].map((key) => optionByKey.get(key)).filter((value): value is LguOption => !!value)
    );

    const getYearsForLgu = (lguKey: string): number[] =>
      sortYearsDesc([...(yearsByLgu.get(lguKey) ?? new Set<number>())]);

    const getLgusForYear = (year: number): LguOption[] => {
      const keys = [...(lgusByYear.get(year) ?? new Set<string>())];
      return sortLguOptions(
        keys.map((key) => optionByKey.get(key)).filter((value): value is LguOption => !!value)
      );
    };

    const requestedYear =
      typeof parsed.fiscalYear === "number" && allYears.has(parsed.fiscalYear) ? parsed.fiscalYear : null;
    const requestedLguKey = parsed.requestedScope
      ? toLguKey(parsed.requestedScope.scopeType, parsed.requestedScope.scopeId)
      : null;
    const hasRequestedLgu = requestedLguKey ? optionByKey.has(requestedLguKey) : false;
    const hasRequestedCombination =
      !!requestedLguKey &&
      hasRequestedLgu &&
      typeof requestedYear === "number" &&
      (yearsByLgu.get(requestedLguKey)?.has(requestedYear) ?? false);

    const defaultCabuyaoCandidate =
      scopeCandidates
        .filter((candidate) => candidate.scope_type === "city" && cabuyaoCityIds.has(candidate.scope_id))
        .sort(compareCabuyaoCandidates)[0] ?? null;
    const defaultBarangayCandidate =
      scopeCandidates
        .filter((candidate) => candidate.scope_type === "barangay")
        .sort(compareByUploadDescThenId)[0] ?? null;

    const defaultSelection = (() => {
      if (defaultCabuyaoCandidate) {
        const option = optionByKey.get(toLguKey("city", defaultCabuyaoCandidate.scope_id));
        if (option) {
          return {
            lgu: option,
            year: defaultCabuyaoCandidate.fiscal_year,
          };
        }
      }

      if (defaultBarangayCandidate) {
        const option = optionByKey.get(toLguKey("barangay", defaultBarangayCandidate.scope_id));
        if (option) {
          return {
            lgu: option,
            year: defaultBarangayCandidate.fiscal_year,
          };
        }
      }

      return null;
    })();

    const fallbackLgu = defaultSelection?.lgu ?? allLgusSorted[0] ?? null;
    const fallbackYear = defaultSelection?.year ?? allYearsSorted[0] ?? null;

    if (!fallbackLgu || typeof fallbackYear !== "number") {
      return NextResponse.json({
        has_data: false,
        years: [],
        lgus: [],
        selected: null,
      });
    }

    let selectedYear = fallbackYear;
    let selectedLgu = fallbackLgu;

    if (hasRequestedCombination && requestedLguKey && typeof requestedYear === "number") {
      selectedYear = requestedYear;
      selectedLgu = optionByKey.get(requestedLguKey) ?? fallbackLgu;
    } else if (
      typeof requestedYear === "number" &&
      requestedLguKey &&
      hasRequestedLgu &&
      parsed.prefer === "lgu"
    ) {
      const yearsForLgu = getYearsForLgu(requestedLguKey);
      selectedLgu = optionByKey.get(requestedLguKey) ?? fallbackLgu;
      selectedYear = yearsForLgu[0] ?? fallbackYear;
    } else if (typeof requestedYear === "number") {
      const optionsForYear = getLgusForYear(requestedYear);
      selectedYear = requestedYear;
      selectedLgu = optionsForYear[0] ?? fallbackLgu;
    } else if (requestedLguKey && hasRequestedLgu) {
      const yearsForLgu = getYearsForLgu(requestedLguKey);
      selectedLgu = optionByKey.get(requestedLguKey) ?? fallbackLgu;
      selectedYear = yearsForLgu[0] ?? fallbackYear;
    }

    const years = getYearsForLgu(toLguKey(selectedLgu.scope_type, selectedLgu.scope_id));
    const lgus = getLgusForYear(selectedYear);

    return NextResponse.json({
      has_data: true,
      years,
      lgus,
      selected: {
        fiscal_year: selectedYear,
        scope_type: selectedLgu.scope_type,
        scope_id: selectedLgu.scope_id,
      },
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unexpected error while loading budget allocation filters.");
  }
}
