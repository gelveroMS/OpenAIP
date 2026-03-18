import "server-only";

import { unstable_cache } from "next/cache";
import type {
  LandingContentQuery,
  LandingContentResult,
  LandingScopeType,
} from "@/lib/domain/landing-content";
import {
  CITIZEN_DASHBOARD_CACHE_TAGS,
  CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/cache/citizen-dashboard";
import { measureTiming } from "@/lib/server/perf/timing";
import { getLandingContentRepo } from "./repo.server";

function normalizeScopeType(value: LandingScopeType | null | undefined): LandingScopeType | null {
  return value === "city" || value === "barangay" ? value : null;
}

function normalizeScopeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFiscalYear(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 2000 || value > 2100) return null;
  return value;
}

const ENABLE_NEXT_CACHE = process.env.NODE_ENV !== "test";

const getCachedLandingContent = ENABLE_NEXT_CACHE
  ? unstable_cache(
      async (
        scopeType: LandingScopeType | null,
        scopeId: string | null,
        fiscalYear: number | null
      ): Promise<LandingContentResult> => {
        const repo = getLandingContentRepo();
        return repo.getLandingContent({
          scopeType,
          scopeId,
          fiscalYear,
        });
      },
      ["citizen-dashboard:landing-content:v1"],
      {
        revalidate: CITIZEN_DASHBOARD_REVALIDATE_SECONDS,
        tags: [CITIZEN_DASHBOARD_CACHE_TAGS.landingContent],
      }
    )
  : async (
      scopeType: LandingScopeType | null,
      scopeId: string | null,
      fiscalYear: number | null
    ) => {
      const repo = getLandingContentRepo();
      return repo.getLandingContent({
        scopeType,
        scopeId,
        fiscalYear,
      });
    };

export async function getCachedCitizenLandingContent(
  input?: LandingContentQuery
): Promise<LandingContentResult> {
  const normalized = {
    scopeType: normalizeScopeType(input?.scopeType ?? null),
    scopeId: normalizeScopeId(input?.scopeId ?? null),
    fiscalYear: normalizeFiscalYear(input?.fiscalYear ?? null),
  };

  return measureTiming({
    label: "landing-content.cached-fetch",
    meta: {
      scopeType: normalized.scopeType,
      hasScopeId: Boolean(normalized.scopeId),
      fiscalYear: normalized.fiscalYear,
    },
    run: async () =>
      getCachedLandingContent(
        normalized.scopeType,
        normalized.scopeId,
        normalized.fiscalYear
      ),
  });
}
