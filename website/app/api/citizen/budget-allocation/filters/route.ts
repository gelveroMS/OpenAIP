import { NextResponse } from "next/server";
import { CITIZEN_DASHBOARD_REVALIDATE_SECONDS } from "@/lib/cache/citizen-dashboard";
import {
  getCitizenBudgetAllocationFilters,
  isCitizenBudgetAllocationRepoError,
  type BudgetAllocationScopeType,
} from "@/lib/repos/citizen-budget-allocation/repo.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ParsedParams = {
  fiscalYear: number | null;
  prefer: "year" | "lgu" | null;
  requestedScope: {
    scopeType: BudgetAllocationScopeType;
    scopeId: string;
  } | null;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
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
    const payload = await getCitizenBudgetAllocationFilters({
      fiscalYear: parsed.fiscalYear,
      requestedScope: parsed.requestedScope,
      prefer: parsed.prefer,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": `public, s-maxage=${CITIZEN_DASHBOARD_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
      },
    });
  } catch (error) {
    if (isCitizenBudgetAllocationRepoError(error)) {
      return errorResponse(error.status, error.code, error.message);
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Unexpected error while loading budget allocation filters."
    );
  }
}
