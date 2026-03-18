import { NextResponse } from "next/server";
import { CITIZEN_DASHBOARD_REVALIDATE_SECONDS } from "@/lib/cache/citizen-dashboard";
import {
  getCitizenBudgetAllocationSummary,
  isCitizenBudgetAllocationRepoError,
  type BudgetAllocationScopeType,
} from "@/lib/repos/citizen-budget-allocation/repo.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function parseScope(searchParams: URLSearchParams): {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
} | null {
  const fiscalYearRaw = searchParams.get("fiscal_year");
  const scopeTypeRaw = searchParams.get("scope_type");
  const scopeId = searchParams.get("scope_id")?.trim() ?? "";

  const fiscalYear = Number(fiscalYearRaw);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900) return null;
  if (scopeTypeRaw !== "city" && scopeTypeRaw !== "barangay") return null;
  if (!UUID_PATTERN.test(scopeId)) return null;

  return {
    fiscalYear,
    scopeType: scopeTypeRaw,
    scopeId,
  };
}

export async function GET(request: Request) {
  const parsed = parseScope(new URL(request.url).searchParams);
  if (!parsed) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Invalid or missing query params. Required: fiscal_year, scope_type (city|barangay), scope_id (UUID)."
    );
  }

  try {
    const payload = await getCitizenBudgetAllocationSummary(parsed);

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
      "Unexpected error while loading budget allocation summary."
    );
  }
}
