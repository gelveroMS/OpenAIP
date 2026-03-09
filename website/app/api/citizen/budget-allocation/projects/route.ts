import { NextResponse } from "next/server";
import { DBV2_SECTOR_CODES, type DashboardSectorCode } from "@/lib/constants/dashboard";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ScopeType = "city" | "barangay";

type ProjectsErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "INTERNAL_ERROR";

type ProjectRow = {
  id: string;
  aip_ref_code: string | null;
  program_project_description: string;
  source_of_funds: string | null;
  total: number | null;
  sector_code: string | null;
};

const UNSPECIFIED_REF_CODE = "Unspecified";

function toDisplayRefCode(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : UNSPECIFIED_REF_CODE;
}

function errorResponse(status: number, code: ProjectsErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(5, Math.floor(value)));
}

function parseParams(searchParams: URLSearchParams) {
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
    scopeType: scopeTypeRaw as ScopeType,
    scopeId,
    page,
    pageSize,
    q,
    sectorCode,
    countMode,
  };
}

function escapeForIlike(input: string): string {
  return input.replace(/[%_,]/g, (token) => `\\${token}`);
}

function buildOtherSectorClause(): string {
  return "sector_code.is.null,and(sector_code.not.like.1000%,sector_code.not.like.3000%,sector_code.not.like.8000%)";
}

function matchesOtherSector(value: string | null | undefined): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return true;
  return !normalized.startsWith("1000") && !normalized.startsWith("3000") && !normalized.startsWith("8000");
}

function buildProjectQuery(input: {
  client: Awaited<ReturnType<typeof supabaseServer>>;
  withCount: boolean;
  fiscalYear: number;
  scopeColumn: "city_id" | "barangay_id";
  scopeId: string;
  sectorCode: DashboardSectorCode | null;
  q: string;
}) {
  let query = input.client
    .from("projects")
    .select(
      "id,aip_ref_code,program_project_description,source_of_funds,total,sector_code,aips!inner(id)",
      input.withCount ? { count: "exact" } : undefined
    )
    .eq("aips.status", "published")
    .eq("aips.fiscal_year", input.fiscalYear)
    .eq(`aips.${input.scopeColumn}`, input.scopeId);

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

export async function GET(request: Request) {
  const parsed = parseParams(new URL(request.url).searchParams);
  if (!parsed) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Invalid or missing query params. Required: fiscal_year, scope_type (city|barangay), scope_id (UUID)."
    );
  }

  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;
  const scopeColumn = parsed.scopeType === "city" ? "city_id" : "barangay_id";

  try {
    const client = await supabaseServer();

    const { count: aipCount, error: aipError } = await client
      .from("aips")
      .select("id", { head: true, count: "exact" })
      .eq("status", "published")
      .eq("fiscal_year", parsed.fiscalYear)
      .eq(scopeColumn, parsed.scopeId);

    if (aipError) {
      return errorResponse(500, "INTERNAL_ERROR", "Failed to validate published budget allocation scope.");
    }

    if (!aipCount || aipCount < 1) {
      return errorResponse(
        404,
        "NOT_FOUND",
        "No published budget allocation was found for the selected fiscal year and LGU scope."
      );
    }

    const { data, error, count } = await buildProjectQuery({
      client,
      withCount: parsed.countMode === "exact",
      fiscalYear: parsed.fiscalYear,
      scopeColumn,
      scopeId: parsed.scopeId,
      sectorCode: parsed.sectorCode,
      q: parsed.q,
    })
      .order("total", { ascending: false, nullsFirst: false })
      .order("aip_ref_code", { ascending: true })
      .range(from, to)
      .returns<ProjectRow[]>();

    if (error) {
      return errorResponse(500, "INTERNAL_ERROR", "Failed to load project list.");
    }

    const scopedRows =
      parsed.sectorCode === "9000" ? (data ?? []).filter((row) => matchesOtherSector(row.sector_code)) : data ?? [];

    const items = scopedRows.map((row) => ({
      project_id: row.id,
      aip_ref_code: toDisplayRefCode(row.aip_ref_code),
      program_project_description: row.program_project_description,
      source_of_funds: row.source_of_funds,
      total: typeof row.total === "number" ? row.total : 0,
    }));

    const totalRows = parsed.countMode === "exact" ? count ?? 0 : -1;
    const totalPages = totalRows >= 0 ? Math.max(1, Math.ceil(totalRows / parsed.pageSize)) : -1;

    return NextResponse.json({
      items,
      page: parsed.page,
      pageSize: parsed.pageSize,
      totalRows,
      totalPages,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unexpected error while loading budget allocation projects.");
  }
}
