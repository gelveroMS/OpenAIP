import { NextResponse } from "next/server";
import {
  DBV2_SECTOR_CODES,
  type DashboardSectorCode,
} from "@/lib/constants/dashboard";
import { CITIZEN_DASHBOARD_PROJECTS_REVALIDATE_SECONDS } from "@/lib/cache/citizen-dashboard";
import {
  getCitizenBudgetAllocationProjectsPage,
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

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(5, Math.floor(value)));
}

function parseParams(searchParams: URLSearchParams): {
  fiscalYear: number;
  scopeType: BudgetAllocationScopeType;
  scopeId: string;
  page: number;
  pageSize: number;
  q: string;
  sectorCode: DashboardSectorCode | null;
  countMode: "none" | "exact";
} | null {
  const fiscalYear = Number(searchParams.get("fiscal_year"));
  const scopeTypeRaw = searchParams.get("scope_type");
  const scopeId = searchParams.get("scope_id")?.trim() ?? "";
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = clampPageSize(Number(searchParams.get("pageSize") ?? "10"));
  const q = searchParams.get("q")?.trim() ?? "";
  const countMode = searchParams.get("count") === "none" ? "none" : "exact";

  const sectorCodeRaw = searchParams.get("sector_code")?.trim() ?? "";
  const sectorCode = DBV2_SECTOR_CODES.includes(sectorCodeRaw as DashboardSectorCode)
    ? (sectorCodeRaw as DashboardSectorCode)
    : null;

  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900) return null;
  if (scopeTypeRaw !== "city" && scopeTypeRaw !== "barangay") return null;
  if (!UUID_PATTERN.test(scopeId)) return null;
  if (!Number.isInteger(page) || page < 1) return null;
  if (sectorCodeRaw && !sectorCode) return null;

  return {
    fiscalYear,
    scopeType: scopeTypeRaw as BudgetAllocationScopeType,
    scopeId,
    page,
    pageSize,
    q,
    sectorCode,
    countMode,
  };
}

export async function GET(request: Request) {
  const parsed = parseParams(new URL(request.url).searchParams);
  if (!parsed) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Invalid or missing query params. Required: fiscal_year, scope_type (city|barangay), scope_id (UUID)."
    );
  }

  try {
    const payload = await getCitizenBudgetAllocationProjectsPage(parsed);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": `public, s-maxage=${CITIZEN_DASHBOARD_PROJECTS_REVALIDATE_SECONDS}, stale-while-revalidate=30`,
      },
    });
  } catch (error) {
    if (isCitizenBudgetAllocationRepoError(error)) {
      return errorResponse(error.status, error.code, error.message);
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Unexpected error while loading budget allocation projects."
    );
  }
}
