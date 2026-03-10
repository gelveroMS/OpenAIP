import "server-only";

import { getAipRepo } from "@/lib/repos/aip/repo.server";
import {
  collectInChunks,
  collectInChunksPaged,
  collectPaged,
  dedupeNonEmptyStrings,
} from "@/lib/repos/_shared/supabase-batching";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type { AipSubmissionsReviewRepo } from "./repo";
import type {
  AipReviewCounts,
  AipStatus,
  AipSubmissionRow,
  LatestReview,
  ListSubmissionsResult,
} from "./types";

type AipStatusRow = {
  id: string;
  fiscal_year: number;
  status: AipStatus;
  barangay_id: string | null;
  submitted_at: string | null;
  created_at: string;
};

type BarangayNameRow = {
  id: string;
  city_id: string | null;
  name: string | null;
};

type ReviewSelectRow = {
  aip_id: string;
  reviewer_id: string;
  action: "approve" | "request_revision" | "claim_review";
  note: string | null;
  created_at: string;
};

type ProfileNameRow = {
  id: string;
  full_name: string | null;
};

const UNAUTHORIZED_ERROR = "Unauthorized.";

function assertAuthorizedActor(
  actor: import("@/lib/domain/actor-context").ActorContext | null
): asserts actor is import("@/lib/domain/actor-context").ActorContext {
  if (!actor) throw new Error(UNAUTHORIZED_ERROR);
  if (actor.role !== "admin" && actor.role !== "city_official") {
    throw new Error(UNAUTHORIZED_ERROR);
  }
}

function assertCityScope(
  actor: import("@/lib/domain/actor-context").ActorContext,
  cityId: string
) {
  if (actor.role !== "city_official") return;
  if (actor.scope.kind !== "city" || !actor.scope.id) {
    throw new Error(UNAUTHORIZED_ERROR);
  }
  if (actor.scope.id !== cityId) {
    throw new Error(UNAUTHORIZED_ERROR);
  }
}

function toAipTitle(year: number): string {
  return `Annual Investment Program ${year}`;
}

function newestFirstRows(rows: AipSubmissionRow[]): AipSubmissionRow[] {
  return [...rows].sort((left, right) =>
    left.uploadedAt < right.uploadedAt ? 1 : -1
  );
}

function buildCounts(rows: AipSubmissionRow[]): AipReviewCounts {
  return {
    total: rows.length,
    published: rows.filter((row) => row.status === "published").length,
    underReview: rows.filter((row) => row.status === "under_review").length,
    pendingReview: rows.filter((row) => row.status === "pending_review").length,
    forRevision: rows.filter((row) => row.status === "for_revision").length,
  };
}

function toLatestReview(
  review: ReviewSelectRow | null,
  profileById: Map<string, ProfileNameRow>
): LatestReview {
  if (!review) return null;
  const profile = profileById.get(review.reviewer_id);
  return {
    reviewerId: review.reviewer_id,
    reviewerName:
      profile?.full_name?.trim() ||
      review.reviewer_id,
    action: review.action,
    note: review.note,
    createdAt: review.created_at,
  };
}

function toActiveClaimReviewerName(
  review: ReviewSelectRow | null,
  profileById: Map<string, ProfileNameRow>
): string | null {
  if (!review || review.action !== "claim_review") return null;
  return toLatestReview(review, profileById)?.reviewerName ?? null;
}

async function loadAipStatusRow(aipId: string): Promise<AipStatusRow | null> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("aips")
    .select("id,fiscal_year,status,barangay_id,submitted_at,created_at")
    .eq("id", aipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AipStatusRow | null) ?? null;
}

async function loadBarangayRows(ids: string[]): Promise<BarangayNameRow[]> {
  const normalizedIds = dedupeNonEmptyStrings(ids);
  if (!normalizedIds.length) return [];
  const client = await supabaseServer();
  return collectInChunks(normalizedIds, async (idChunk) => {
    const { data, error } = await client
      .from("barangays")
      .select("id,city_id,name")
      .in("id", idChunk);
    if (error) throw new Error(error.message);
    return (data ?? []) as BarangayNameRow[];
  });
}

async function loadLatestReviewsForAips(
  aipIds: string[]
): Promise<Map<string, ReviewSelectRow>> {
  const latestByAip = new Map<string, ReviewSelectRow>();
  const normalizedAipIds = dedupeNonEmptyStrings(aipIds);
  if (!normalizedAipIds.length) return latestByAip;

  const client = await supabaseServer();
  const rows = await collectInChunksPaged(
    normalizedAipIds,
    async (aipIdChunk, from, to) => {
      const { data, error } = await client
        .from("aip_reviews")
        .select("id,aip_id,reviewer_id,action,note,created_at")
        .in("aip_id", aipIdChunk)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as ReviewSelectRow[];
    }
  );

  for (const row of rows) {
    if (!latestByAip.has(row.aip_id)) {
      latestByAip.set(row.aip_id, row);
    }
  }
  return latestByAip;
}

async function loadProfileNames(ids: string[]): Promise<Map<string, ProfileNameRow>> {
  const profileById = new Map<string, ProfileNameRow>();
  const normalizedIds = dedupeNonEmptyStrings(ids);
  if (!normalizedIds.length) return profileById;

  try {
    const admin = supabaseAdmin();
    const rows = await collectInChunks(normalizedIds, async (idChunk) => {
      const { data, error } = await admin
        .from("profiles")
        .select("id,full_name")
        .in("id", idChunk);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfileNameRow[];
    });
    for (const row of rows) {
      profileById.set(row.id, row);
    }
    return profileById;
  } catch {
    const client = await supabaseServer();
    const rows = await collectInChunks(normalizedIds, async (idChunk) => {
      const { data, error } = await client
        .from("profiles")
        .select("id,full_name")
        .in("id", idChunk);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfileNameRow[];
    });
    for (const row of rows) {
      profileById.set(row.id, row);
    }
  }
  return profileById;
}

async function getLatestReviewForAip(aipId: string): Promise<LatestReview> {
  const latest = await loadLatestReviewRowForAip(aipId);
  if (!latest) return null;

  const profileById = await loadProfileNames([latest.reviewer_id]);
  return toLatestReview(latest, profileById);
}

async function loadLatestReviewRowForAip(
  aipId: string
): Promise<ReviewSelectRow | null> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("aip_id,reviewer_id,action,note,created_at")
    .eq("aip_id", aipId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReviewSelectRow | null) ?? null;
}

function assertClaimOwnership(
  latestReview: ReviewSelectRow | null,
  actor: import("@/lib/domain/actor-context").ActorContext
) {
  if (!latestReview || latestReview.action !== "claim_review") {
    throw new Error("Claim review before taking actions.");
  }

  if (latestReview.reviewer_id !== actor.userId) {
    if (actor.role === "admin") {
      throw new Error(
        "This AIP is assigned to another reviewer. Claim review to take over before taking actions."
      );
    }
    throw new Error("This AIP is assigned to another reviewer.");
  }
}

async function assertBarangayAipInCity(aipId: string, cityId: string) {
  const aip = await loadAipStatusRow(aipId);
  if (!aip) throw new Error("AIP not found.");
  if (!aip.barangay_id) throw new Error("AIP is not a barangay submission.");

  const barangayRows = await loadBarangayRows([aip.barangay_id]);
  const barangay = barangayRows[0] ?? null;
  if (!barangay || !barangay.city_id || barangay.city_id !== cityId) {
    throw new Error("AIP is outside jurisdiction.");
  }
  return { aip, barangay };
}

async function resolveActorCityIdForAip(
  aipId: string,
  actor: import("@/lib/domain/actor-context").ActorContext
): Promise<string> {
  if (actor.role === "city_official") {
    if (actor.scope.kind !== "city" || !actor.scope.id) {
      throw new Error(UNAUTHORIZED_ERROR);
    }
    return actor.scope.id;
  }

  const aip = await loadAipStatusRow(aipId);
  if (!aip) throw new Error("AIP not found.");
  if (!aip.barangay_id) throw new Error("AIP is not a barangay submission.");
  const barangayRows = await loadBarangayRows([aip.barangay_id]);
  const cityId = barangayRows[0]?.city_id ?? null;
  if (!cityId) throw new Error("AIP is outside jurisdiction.");
  return cityId;
}

async function claimReviewViaRpc(aipId: string): Promise<AipStatus> {
  const client = await supabaseServer();
  const { data, error } = await client.rpc("claim_aip_review", {
    p_aip_id: aipId,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  const status = row && typeof row.status === "string" ? row.status : "under_review";
  if (status !== "under_review" && status !== "pending_review") {
    throw new Error("Unexpected status returned by claim_aip_review.");
  }
  return status;
}

// [SUPABASE-SWAP] Future Supabase adapter for `AipSubmissionsReviewRepo`.
// [DBV2] Method -> table mapping:
//   - listSubmissionsForCity -> `public.aips` (status <> 'draft', barangay scope within city jurisdiction) + latest `public.aip_reviews`
//   - claimReview -> RPC `public.claim_aip_review` (row lock + append-only `claim_review`)
//   - startReviewIfNeeded -> legacy alias of `claimReview`
//   - requestRevision/publishAip -> insert `public.aip_reviews` + update `public.aips.status` (`for_revision` / `published`)
// [SECURITY] RLS enforces jurisdiction + non-draft reviewer gates (`aips_update_policy`, `aip_reviews_insert_policy`).
export function createSupabaseAipSubmissionsReviewRepo(): AipSubmissionsReviewRepo {
  return {
    async listSubmissionsForCity({
      cityId,
      filters,
      actor,
    }): Promise<ListSubmissionsResult> {
      assertAuthorizedActor(actor);
      assertCityScope(actor, cityId);

      const client = await supabaseServer();
      const aipRows = await collectPaged(async (from, to) => {
        const { data, error } = await client
          .from("aips")
          .select("id,fiscal_year,status,barangay_id,submitted_at,created_at")
          .not("barangay_id", "is", null)
          .neq("status", "draft")
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as AipStatusRow[];
      });
      const barangayIds = Array.from(
        new Set(
          aipRows
            .map((row) => row.barangay_id)
            .filter((value): value is string => !!value)
        )
      );
      const barangays = await loadBarangayRows(barangayIds);
      const barangayById = new Map(barangays.map((row) => [row.id, row]));

      let filteredAips = aipRows.filter((row) => {
        if (!row.barangay_id) return false;
        const barangay = barangayById.get(row.barangay_id);
        return !!barangay && barangay.city_id === cityId;
      });

      if (typeof filters?.year === "number") {
        filteredAips = filteredAips.filter((row) => row.fiscal_year === filters.year);
      }
      if (filters?.status) {
        filteredAips = filteredAips.filter((row) => row.status === filters.status);
      }
      if (filters?.barangayName) {
        const target = filters.barangayName.trim().toLowerCase();
        filteredAips = filteredAips.filter((row) => {
          const name = row.barangay_id ? barangayById.get(row.barangay_id)?.name ?? "" : "";
          return name.trim().toLowerCase() === target;
        });
      }

      const aipIds = filteredAips.map((row) => row.id);
      const latestReviewByAip = await loadLatestReviewsForAips(aipIds);
      const reviewerIds = Array.from(
        new Set(
          Array.from(latestReviewByAip.values()).map((row) => row.reviewer_id)
        )
      );
      const profileById = await loadProfileNames(reviewerIds);

      const mapped = filteredAips.map((row) => {
        const latest = latestReviewByAip.get(row.id) ?? null;
        return {
          id: row.id,
          title: toAipTitle(row.fiscal_year),
          year: row.fiscal_year,
          status: row.status,
          scope: "barangay",
          barangayName: row.barangay_id
            ? (barangayById.get(row.barangay_id)?.name ?? null)
            : null,
          uploadedAt: row.submitted_at ?? row.created_at,
          reviewerName: toActiveClaimReviewerName(latest, profileById),
        } satisfies AipSubmissionRow;
      });

      const rows = newestFirstRows(mapped);
      return { rows, counts: buildCounts(rows) };
    },

    async getSubmissionAipDetail({ aipId, actor }) {
      assertAuthorizedActor(actor);
      const cityId = await resolveActorCityIdForAip(aipId, actor);
      await assertBarangayAipInCity(aipId, cityId);

      const aipRepo = getAipRepo({ defaultScope: "barangay" });
      const aip = await aipRepo.getAipDetail(aipId);
      if (!aip) return null;
      if (aip.scope !== "barangay") {
        throw new Error("AIP is not a barangay submission.");
      }
      const latestReview = await getLatestReviewForAip(aipId);
      return { aip, latestReview };
    },

    async claimReview({ aipId, actor }): Promise<AipStatus> {
      assertAuthorizedActor(actor);
      const cityId = await resolveActorCityIdForAip(aipId, actor);
      await assertBarangayAipInCity(aipId, cityId);
      return claimReviewViaRpc(aipId);
    },

    async startReviewIfNeeded({ aipId, actor }): Promise<AipStatus> {
      // Legacy entrypoint kept for compatibility. Claims the review owner explicitly.
      assertAuthorizedActor(actor);
      const cityId = await resolveActorCityIdForAip(aipId, actor);
      await assertBarangayAipInCity(aipId, cityId);
      return claimReviewViaRpc(aipId);
    },

    async requestRevision({ aipId, note, actor }): Promise<AipStatus> {
      const trimmed = note.trim();
      if (!trimmed) throw new Error("Revision comments are required.");
      assertAuthorizedActor(actor);

      const cityId = await resolveActorCityIdForAip(aipId, actor);
      const { aip } = await assertBarangayAipInCity(aipId, cityId);
      if (aip.status !== "under_review") {
        throw new Error("Request Revision is only allowed when the AIP is under review.");
      }
      const latestReview = await loadLatestReviewRowForAip(aipId);
      assertClaimOwnership(latestReview, actor);

      const client = await supabaseServer();
      const { error: reviewError } = await client.from("aip_reviews").insert({
        aip_id: aipId,
        action: "request_revision",
        note: trimmed,
        reviewer_id: actor.userId,
      });
      if (reviewError) throw new Error(reviewError.message);

      const { data, error } = await client
        .from("aips")
        .update({ status: "for_revision" })
        .eq("id", aipId)
        .eq("status", "under_review")
        .select("status")
        .single();
      if (error) throw new Error(error.message);
      return (data as { status: AipStatus }).status;
    },

    async publishAip({ aipId, note, actor }): Promise<AipStatus> {
      const trimmed = typeof note === "string" ? note.trim() : "";
      assertAuthorizedActor(actor);

      const cityId = await resolveActorCityIdForAip(aipId, actor);
      const { aip } = await assertBarangayAipInCity(aipId, cityId);
      if (aip.status !== "under_review") {
        throw new Error("Publish is only allowed when the AIP is under review.");
      }
      const latestReview = await loadLatestReviewRowForAip(aipId);
      assertClaimOwnership(latestReview, actor);

      const client = await supabaseServer();
      const { error: reviewError } = await client.from("aip_reviews").insert({
        aip_id: aipId,
        action: "approve",
        note: trimmed ? trimmed : null,
        reviewer_id: actor.userId,
      });
      if (reviewError) throw new Error(reviewError.message);

      const { data, error } = await client
        .from("aips")
        .update({ status: "published" })
        .eq("id", aipId)
        .eq("status", "under_review")
        .select("status")
        .single();
      if (error) throw new Error(error.message);
      return (data as { status: AipStatus }).status;
    },

    async getLatestReview({ aipId }): Promise<LatestReview> {
      return getLatestReviewForAip(aipId);
    },
  };
}
