import { getAuthenticatedBrowserClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AipMonitoringRepo, AipMonitoringSeedData } from "./repo";
import type { AipMonitoringDetail } from "@/mocks/fixtures/admin/aip-monitoring/aipMonitoring.mock";
import {
  buildProjectTotalsByAipId,
  fetchAipFileTotalsByAipIds,
  resolveAipDisplayTotalsByAipId,
} from "@/lib/repos/_shared/aip-totals";
import {
  collectInChunks,
  collectInChunksPaged,
  collectPaged,
  dedupeNonEmptyStrings,
} from "@/lib/repos/_shared/supabase-batching";

type NameRow = { id: string; name: string };
type ProfileNameRow = { id: string; full_name: string | null };
type ProjectBudgetRow = { aip_id: string; total: number | string | null };

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}

async function loadNameMap(
  client: SupabaseClient,
  table: "cities" | "municipalities" | "barangays",
  ids: string[]
): Promise<Map<string, string>> {
  const uniqueIds = dedupeNonEmptyStrings(ids);
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  const rows = await collectInChunks(uniqueIds, async (idChunk) => {
    const { data, error } = await client
      .from(table)
      .select("id,name")
      .in("id", idChunk);

    if (error) {
      throw new Error(error.message);
    }
    return (data ?? []) as NameRow[];
  });

  for (const row of rows) {
    map.set(row.id, row.name);
  }

  return map;
}

function buildFallbackDetails(aip: {
  id: string;
  fiscal_year: number;
  status: string;
  submitted_at: string | null;
  created_at: string;
  status_updated_at: string;
}): AipMonitoringDetail {
  return {
    fileName: `AIP_${aip.fiscal_year}.pdf`,
    pdfUrl: "",
    summaryText: "Summary is generated from live AIP records.",
    detailedBullets: [],
    submissionHistory: [
      {
        year: aip.fiscal_year,
        submittedDate: formatIsoDate(aip.submitted_at ?? aip.created_at),
        status: aip.status,
      },
    ],
    archivedSubmissions: [],
    timeline: [
      {
        label: `Status: ${aip.status}`,
        date: formatIsoDate(aip.status_updated_at),
      },
    ],
  };
}

async function loadSeedData(): Promise<AipMonitoringSeedData> {
  const client = await getAuthenticatedBrowserClient();

  const [aips, reviews, activity] = await Promise.all([
    collectPaged(async (from, to) => {
      const { data, error } = await client
        .from("aips")
        .select(
          "id,fiscal_year,barangay_id,city_id,municipality_id,status,status_updated_at,submitted_at,published_at,created_by,created_at,updated_at"
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);

      if (error) throw new Error(error.message);
      return (data ?? []) as AipMonitoringSeedData["aips"];
    }),
    collectPaged(async (from, to) => {
      const { data, error } = await client
        .from("aip_reviews")
        .select("id,aip_id,action,note,reviewer_id,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

      if (error) throw new Error(error.message);
      return (data ?? []) as AipMonitoringSeedData["reviews"];
    }),
    collectPaged(async (from, to) => {
      const { data, error } = await client
        .from("activity_log")
        .select(
          "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

      if (error) throw new Error(error.message);
      return (data ?? []) as AipMonitoringSeedData["activity"];
    }),
  ]);
  const aipIds = aips.map((aip) => aip.id);

  let budgetTotalByAipId: Record<string, number> = {};
  if (aipIds.length > 0) {
    const projectRowsData = await collectInChunksPaged(
      dedupeNonEmptyStrings(aipIds),
      async (aipIdChunk, from, to) => {
        const { data, error } = await client
          .from("projects")
          .select("aip_id,total")
          .in("aip_id", aipIdChunk)
          .order("aip_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as ProjectBudgetRow[];
      }
    );

    const projectTotalsByAipId = buildProjectTotalsByAipId(
      ((projectRowsData ?? []) as ProjectBudgetRow[]).map((row) => ({
        aip_id: row.aip_id,
        total: row.total,
      }))
    );
    const fileTotalsByAipId = await fetchAipFileTotalsByAipIds(client, aipIds);
    const displayTotalsByAipId = resolveAipDisplayTotalsByAipId({
      aipIds,
      fileTotalsByAipId,
      fallbackTotalsByAipId: projectTotalsByAipId,
    });
    budgetTotalByAipId = Object.fromEntries(
      aipIds.map((aipId) => [aipId, displayTotalsByAipId.get(aipId) ?? 0])
    );
  }

  const [cityMap, municipalityMap, barangayMap] = await Promise.all([
    loadNameMap(
      client,
      "cities",
      aips.map((aip) => aip.city_id ?? "").filter(Boolean)
    ),
    loadNameMap(
      client,
      "municipalities",
      aips.map((aip) => aip.municipality_id ?? "").filter(Boolean)
    ),
    loadNameMap(
      client,
      "barangays",
      aips.map((aip) => aip.barangay_id ?? "").filter(Boolean)
    ),
  ]);

  const lguNameByAipId: Record<string, string> = {};
  for (const aip of aips) {
    const name =
      (aip.city_id ? cityMap.get(aip.city_id) : null) ??
      (aip.municipality_id ? municipalityMap.get(aip.municipality_id) : null) ??
      (aip.barangay_id ? barangayMap.get(aip.barangay_id) : null) ??
      "Unknown LGU";
    lguNameByAipId[aip.id] = name;
  }

  const reviewerIds = Array.from(new Set(reviews.map((row) => row.reviewer_id)));
  let reviewerDirectory: Record<string, { name: string }> = {};
  if (reviewerIds.length > 0) {
    const rows = await collectInChunks(
      dedupeNonEmptyStrings(reviewerIds),
      async (reviewerChunk) => {
        const { data, error } = await client
          .from("profiles")
          .select("id,full_name")
          .in("id", reviewerChunk);
        if (error) {
          throw new Error(error.message);
        }
        return (data ?? []) as ProfileNameRow[];
      }
    );
    reviewerDirectory = Object.fromEntries(
      rows.map((row) => [
        row.id,
        { name: row.full_name?.trim() || row.id },
      ])
    );
  }

  const details: Record<string, AipMonitoringDetail> = {};
  for (const aip of aips) {
    details[aip.id] = buildFallbackDetails(aip);
  }

  return {
    aips,
    reviews,
    activity,
    details,
    budgetTotalByAipId,
    lguNameByAipId,
    reviewerDirectory,
  };
}

export function createSupabaseAipMonitoringRepo(): AipMonitoringRepo {
  return {
    async getSeedData() {
      return loadSeedData();
    },
  };
}
