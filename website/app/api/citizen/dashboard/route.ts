import { NextResponse } from "next/server";
import {
  CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/cache/citizen-dashboard";
import type { LandingContentQuery, LandingScopeType } from "@/lib/domain/landing-content";
import { getCachedCitizenLandingContent } from "@/lib/repos/landing-content/public-cache.server";

export const revalidate = 300;

function parseScopeType(value: string | null): LandingScopeType | null {
  return value === "city" || value === "barangay" ? value : null;
}

function parseScopeId(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFiscalYear(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function toQuery(searchParams: URLSearchParams): LandingContentQuery {
  return {
    scopeType: parseScopeType(searchParams.get("scope_type")),
    scopeId: parseScopeId(searchParams.get("scope_id")),
    fiscalYear: parseFiscalYear(searchParams.get("fiscal_year")),
  };
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const query = toQuery(searchParams);
    const result = await getCachedCitizenLandingContent(query);

    return NextResponse.json(
      {
        has_data: result.meta.hasData,
        selection: {
          requested_scope_type: result.meta.selection.requestedScopeType,
          requested_scope_id: result.meta.selection.requestedScopeId,
          requested_fiscal_year: result.meta.selection.requestedFiscalYear,
          resolved_scope_type: result.meta.selection.resolvedScopeType,
          resolved_scope_id: result.meta.selection.resolvedScopeId,
          resolved_scope_psgc: result.meta.selection.resolvedScopePsgc,
          resolved_fiscal_year: result.meta.selection.resolvedFiscalYear,
          fallback_applied: result.meta.selection.fallbackApplied,
          available_fiscal_years: result.meta.availableFiscalYears,
        },
        vm: result.vm,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": `public, s-maxage=${CITIZEN_DASHBOARD_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error while loading citizen dashboard.";

    return NextResponse.json(
      {
        has_data: false,
        selection: null,
        vm: null,
        errors: [message],
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
