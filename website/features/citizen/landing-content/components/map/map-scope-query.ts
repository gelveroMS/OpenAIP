import type { LandingScopeType } from "@/lib/domain/landing-content";

type BuildDashboardScopeHrefInput = {
  pathname: string;
  searchParams: URLSearchParams;
  scopeType?: LandingScopeType;
  scopeId?: string;
  fiscalYear?: number;
  preferLatestFiscalYear?: boolean;
};

function normalizeYear(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
  }

  return null;
}

export function buildDashboardScopeHref(input: BuildDashboardScopeHrefInput): string | null {
  const scopeType = input.scopeType;
  const scopeId = typeof input.scopeId === "string" ? input.scopeId.trim() : "";
  if (!scopeType || !scopeId) return null;

  const params = new URLSearchParams(input.searchParams.toString());
  const currentScopeType = params.get("scope_type");
  const currentScopeId = params.get("scope_id");
  const currentFiscalYear = params.get("fiscal_year");
  const useLatestFiscalYear = input.preferLatestFiscalYear === true;

  const resolvedFiscalYear =
    useLatestFiscalYear
      ? null
      : normalizeYear(input.fiscalYear) ?? normalizeYear(params.get("fiscal_year"));
  const matchesCurrentFiscalYear =
    resolvedFiscalYear === null
      ? currentFiscalYear === null
      : currentFiscalYear === String(resolvedFiscalYear);

  if (
    currentScopeType === scopeType &&
    currentScopeId === scopeId &&
    matchesCurrentFiscalYear
  ) {
    return null;
  }

  params.set("scope_type", scopeType);
  params.set("scope_id", scopeId);
  if (resolvedFiscalYear !== null) {
    params.set("fiscal_year", String(resolvedFiscalYear));
  } else {
    params.delete("fiscal_year");
  }

  const query = params.toString();
  return query ? `${input.pathname}?${query}` : input.pathname;
}
