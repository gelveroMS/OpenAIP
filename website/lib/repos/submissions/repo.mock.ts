import type { AipStatus, ReviewAction } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import type { AipHeader } from "@/lib/repos/aip/repo";
import { createMockFeedbackRepo } from "@/lib/repos/feedback/repo.mock";
import { AIPS_TABLE } from "@/mocks/fixtures/aip/aips.table.fixture";
import type { AipSubmissionsReviewRepo, AipSubmissionRow, LatestReview, ListSubmissionsResult } from "./repo";

// [DATAFLOW] Mock implementation of the DBV2 review workflow:
//   AIP status changes live in `AIPS_TABLE`, while reviewer decisions are appended to `reviewStore` below.
// [DBV2] In Supabase, `reviewStore` maps to `public.aip_reviews` (append-only) and AIP status maps to `public.aips.status`.
type MockAipReviewRow = {
  id: string;
  aipId: string;
  reviewerId: string;
  reviewerName: string;
  action: ReviewAction;
  note: string | null;
  createdAt: string;
};

type AipRevisionFeedbackMessageByAip = {
  aipId: string;
  id: string;
  body: string;
  createdAt: string;
  authorName?: string | null;
  authorRole: "reviewer" | "barangay_official";
};

const MOCK_CITY_ID = "city_001";
const MOCK_REVIEWER_ID = "profile_city_001";
const MOCK_REVIEWER_NAME = "Juan Dela Cruz";

const MOCK_CITY_BY_AIP_ID: Record<string, string> = Object.fromEntries(
  AIPS_TABLE.filter((aip) => aip.scope === "barangay").map((aip) => [aip.id, MOCK_CITY_ID])
);

const SEED_REVIEW_NOTES_BY_AIP_ID: Record<string, string> = {
  "aip-2026-sanisidro":
    "Budget allocation for medical equipment needs to be itemized. Please provide detailed specifications for the vaccination storage facility.",
  "aip-2026-mamadid":
    "Please provide more detailed cost breakdown for the multi-purpose hall project.",
};

let reviewStore: MockAipReviewRow[] = [];
let reviewSequence = 1;

function nextReviewId() {
  const id = `aiprev_${String(reviewSequence).padStart(3, "0")}`;
  reviewSequence += 1;
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().split("T")[0] ?? "";
}

function seedReviewStore() {
  const seeded: MockAipReviewRow[] = [];

  for (const aip of AIPS_TABLE) {
    if (aip.scope !== "barangay") continue;

    if (aip.status === "published") {
      seeded.push({
        id: nextReviewId(),
        aipId: aip.id,
        reviewerId: MOCK_REVIEWER_ID,
        reviewerName: MOCK_REVIEWER_NAME,
        action: "approve",
        note: null,
        createdAt: aip.publishedAt ? new Date(aip.publishedAt).toISOString() : nowIso(),
      });
    }

    if (aip.status === "for_revision") {
      seeded.push({
        id: nextReviewId(),
        aipId: aip.id,
        reviewerId: MOCK_REVIEWER_ID,
        reviewerName: MOCK_REVIEWER_NAME,
        action: "request_revision",
        note: SEED_REVIEW_NOTES_BY_AIP_ID[aip.id] ?? "Please revise and resubmit.",
        createdAt: nowIso(),
      });
    }
  }

  reviewStore = seeded;
}

seedReviewStore();

function requireCityReviewer(
  actor: ActorContext | null,
  cityId: string
): asserts actor is ActorContext {
  if (!actor) {
    throw new Error("Unauthorized.");
  }

  if (actor.role !== "admin" && actor.role !== "city_official") {
    throw new Error("Unauthorized.");
  }

  if (actor.role === "city_official") {
    if (actor.scope.kind !== "city" || !actor.scope.id) {
      throw new Error("Unauthorized.");
    }
    if (actor.scope.id !== cityId) {
      throw new Error("Unauthorized.");
    }
  }
}

function latestReviewForAip(aipId: string): MockAipReviewRow | null {
  const rows = reviewStore.filter((row) => row.aipId === aipId);
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => {
    const rowTs = new Date(row.createdAt).getTime();
    const latestTs = new Date(latest.createdAt).getTime();
    if (rowTs > latestTs) return row;
    if (rowTs === latestTs && row.id > latest.id) return row;
    return latest;
  });
}

function activeClaimForAip(aipId: string): MockAipReviewRow | null {
  const latest = latestReviewForAip(aipId);
  if (!latest || latest.action !== "claim_review") return null;
  return latest;
}

function assertClaimOwnership(aipId: string, actor: ActorContext) {
  const activeClaim = activeClaimForAip(aipId);
  if (!activeClaim) {
    throw new Error("Claim review before taking actions.");
  }

  if (activeClaim.reviewerId !== actor.userId) {
    if (actor.role === "admin") {
      throw new Error(
        "This AIP is assigned to another reviewer. Claim review to take over before taking actions."
      );
    }
    throw new Error("This AIP is assigned to another reviewer.");
  }
}

function toTimestamp(value: string): number | null {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function sortByCreatedAtAscThenId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  const leftAt = toTimestamp(left.createdAt);
  const rightAt = toTimestamp(right.createdAt);
  if (leftAt !== null && rightAt !== null && leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function sortByCreatedAtDescThenId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return -sortByCreatedAtAscThenId(left, right);
}

async function getMockRevisionRemarksByAipIds(
  aipIds: string[]
): Promise<AipRevisionFeedbackMessageByAip[]> {
  const uniqueAipIds = Array.from(new Set(aipIds));
  if (!uniqueAipIds.length) return [];

  return uniqueAipIds
    .flatMap((aipId) =>
      __getMockAipReviewsForAipId(aipId)
        .filter(
          (row) =>
            row.action === "request_revision" &&
            typeof row.note === "string" &&
            row.note.trim().length > 0
        )
        .map((row) => ({
          aipId,
          id: row.id,
          body: row.note!.trim(),
          createdAt: row.createdAt,
          authorName:
            typeof row.reviewerName === "string" && row.reviewerName.trim().length > 0
              ? row.reviewerName.trim()
              : "City Reviewer",
          authorRole: "reviewer" as const,
        }))
    )
    .sort(sortByCreatedAtAscThenId);
}

function toMockReplyAuthorName(authorId: string | null | undefined): string | null {
  if (!authorId) return null;
  return authorId.startsWith("official_") ? "Barangay Official" : authorId;
}

async function getMockBarangayRepliesByAipIds(
  aipIds: string[]
): Promise<AipRevisionFeedbackMessageByAip[]> {
  const uniqueAipIds = Array.from(new Set(aipIds));
  if (!uniqueAipIds.length) return [];

  const repo = createMockFeedbackRepo();
  const rowsByAip = await Promise.all(
    uniqueAipIds.map(async (aipId) => {
      const feedback = await repo.listForAip(aipId);
      return feedback
        .filter(
          (item) =>
            item.kind === "lgu_note" &&
            item.parentFeedbackId === null &&
            typeof item.body === "string" &&
            item.body.trim().length > 0 &&
            typeof item.authorId === "string" &&
            item.authorId.startsWith("official_")
        )
        .map((item) => ({
          aipId,
          id: item.id,
          body: item.body.trim(),
          createdAt: item.createdAt,
          authorName: toMockReplyAuthorName(item.authorId),
          authorRole: "barangay_official" as const,
        }));
    })
  );

  return rowsByAip.flat().sort(sortByCreatedAtAscThenId);
}

function buildLatestMockRevisionNotes(
  remarks: AipRevisionFeedbackMessageByAip[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const remark of [...remarks].sort(sortByCreatedAtDescThenId)) {
    if (!map.has(remark.aipId)) {
      map.set(remark.aipId, remark.body);
    }
  }
  return map;
}

function buildLatestMockRevisionReplies(
  replies: AipRevisionFeedbackMessageByAip[]
): Map<string, NonNullable<AipHeader["revisionReply"]>> {
  const map = new Map<string, NonNullable<AipHeader["revisionReply"]>>();
  for (const reply of [...replies].sort(sortByCreatedAtDescThenId)) {
    if (!map.has(reply.aipId)) {
      map.set(reply.aipId, {
        body: reply.body,
        createdAt: reply.createdAt,
        authorName: reply.authorName ?? null,
      });
    }
  }
  return map;
}

function buildLatestMockPublishedBy(
  aipIds: string[]
): Map<string, NonNullable<AipHeader["publishedBy"]>> {
  const map = new Map<string, NonNullable<AipHeader["publishedBy"]>>();
  for (const aipId of aipIds) {
    const latestApprove = reviewStore
      .filter((row) => row.aipId === aipId && row.action === "approve")
      .sort(sortByCreatedAtDescThenId)[0];
    if (!latestApprove) continue;

    map.set(aipId, {
      reviewerId: latestApprove.reviewerId,
      reviewerName:
        typeof latestApprove.reviewerName === "string" &&
        latestApprove.reviewerName.trim().length > 0
          ? latestApprove.reviewerName.trim()
          : null,
      createdAt: latestApprove.createdAt,
    });
  }

  return map;
}

function buildRevisionFeedbackCycles(params: {
  aipIds: string[];
  remarks: AipRevisionFeedbackMessageByAip[];
  replies: AipRevisionFeedbackMessageByAip[];
}): Map<string, NonNullable<AipHeader["revisionFeedbackCycles"]>> {
  const { aipIds, remarks, replies } = params;
  const map = new Map<string, NonNullable<AipHeader["revisionFeedbackCycles"]>>();
  if (!aipIds.length) return map;

  const remarksByAip = new Map<string, AipRevisionFeedbackMessageByAip[]>();
  for (const remark of remarks) {
    const list = remarksByAip.get(remark.aipId) ?? [];
    list.push(remark);
    remarksByAip.set(remark.aipId, list);
  }

  const repliesByAip = new Map<string, AipRevisionFeedbackMessageByAip[]>();
  for (const reply of replies) {
    const list = repliesByAip.get(reply.aipId) ?? [];
    list.push(reply);
    repliesByAip.set(reply.aipId, list);
  }

  for (const aipId of aipIds) {
    const aipRemarks = [...(remarksByAip.get(aipId) ?? [])].sort(sortByCreatedAtAscThenId);
    if (!aipRemarks.length) continue;

    const aipReplies = [...(repliesByAip.get(aipId) ?? [])].sort(sortByCreatedAtAscThenId);

    const cyclesAsc = aipRemarks.map((remark, index) => {
      const nextRemark = aipRemarks[index + 1];
      const remarkAt = toTimestamp(remark.createdAt);
      const nextRemarkAt = nextRemark ? toTimestamp(nextRemark.createdAt) : null;

      const cycleReplies = aipReplies.filter((reply) => {
        const replyAt = toTimestamp(reply.createdAt);
        if (remarkAt === null || replyAt === null) return false;
        if (replyAt < remarkAt) return false;
        if (nextRemarkAt !== null && replyAt >= nextRemarkAt) return false;
        return true;
      });

      return {
        cycleId: remark.id,
        reviewerRemark: {
          id: remark.id,
          body: remark.body,
          createdAt: remark.createdAt,
          authorName: remark.authorName ?? null,
          authorRole: "reviewer" as const,
        },
        replies: cycleReplies.map((reply) => ({
          id: reply.id,
          body: reply.body,
          createdAt: reply.createdAt,
          authorName: reply.authorName ?? null,
          authorRole: "barangay_official" as const,
        })),
      };
    });

    map.set(
      aipId,
      [...cyclesAsc].sort((left, right) =>
        sortByCreatedAtDescThenId(left.reviewerRemark, right.reviewerRemark)
      )
    );
  }

  return map;
}

async function enrichMockSubmissionAipDetail(aip: AipHeader): Promise<AipHeader> {
  const [revisionRemarks, revisionReplies] = await Promise.all([
    getMockRevisionRemarksByAipIds([aip.id]),
    getMockBarangayRepliesByAipIds([aip.id]),
  ]);
  const latestRevisionNotes = buildLatestMockRevisionNotes(revisionRemarks);
  const latestRevisionReplies = buildLatestMockRevisionReplies(revisionReplies);
  const latestPublishedBy = buildLatestMockPublishedBy([aip.id]);
  const revisionFeedbackCyclesByAip = buildRevisionFeedbackCycles({
    aipIds: [aip.id],
    remarks: revisionRemarks,
    replies: revisionReplies,
  });

  return {
    ...aip,
    feedback: latestRevisionNotes.get(aip.id) ?? aip.feedback,
    publishedBy: latestPublishedBy.get(aip.id),
    revisionReply: latestRevisionReplies.get(aip.id),
    revisionFeedbackCycles: revisionFeedbackCyclesByAip.get(aip.id),
  };
}

export function getLatestMockAipRevisionNote(aipId: string): string | null {
  const rows = reviewStore
    .filter((row) => row.aipId === aipId && row.action === "request_revision")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows[0]?.note ?? null;
}

function sortNewestFirst(rows: AipSubmissionRow[]): AipSubmissionRow[] {
  return [...rows].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

function buildCounts(rows: AipSubmissionRow[]) {
  return {
    total: rows.length,
    published: rows.filter((r) => r.status === "published").length,
    underReview: rows.filter((r) => r.status === "under_review").length,
    pendingReview: rows.filter((r) => r.status === "pending_review").length,
    forRevision: rows.filter((r) => r.status === "for_revision").length,
  };
}

function toLatestReview(row: MockAipReviewRow | null): LatestReview {
  if (!row) return null;
  return {
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    action: row.action,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function toActiveClaimReviewerName(row: MockAipReviewRow | null): string | null {
  if (!row || row.action !== "claim_review") return null;
  return row.reviewerName;
}

function getBarangayCityId(aipId: string): string | null {
  return MOCK_CITY_BY_AIP_ID[aipId] ?? null;
}

function toReviewerName(actor: ActorContext): string {
  if (actor.userId === MOCK_REVIEWER_ID) return MOCK_REVIEWER_NAME;
  return actor.userId;
}

function assertInJurisdiction(aip: AipHeader, cityId: string) {
  if (aip.scope !== "barangay") {
    throw new Error("AIP is not a barangay submission.");
  }

  const aipCityId = getBarangayCityId(aip.id);
  if (!aipCityId) {
    throw new Error("AIP is missing jurisdiction mapping.");
  }
  if (aipCityId !== cityId) {
    throw new Error("AIP is outside jurisdiction.");
  }
}

export function __resetMockAipSubmissionsReviewState() {
  // Reset review store only (AIPS_TABLE is reset elsewhere, if needed).
  reviewStore = [];
  reviewSequence = 1;
  seedReviewStore();
}

export function __getMockAipReviewsForAipId(aipId: string): MockAipReviewRow[] {
  return reviewStore.filter((row) => row.aipId === aipId);
}

export function __appendMockAipReviewAction(input: {
  aipId: string;
  reviewerId: string;
  action: ReviewAction;
  note?: string | null;
}) {
  reviewStore = [
    ...reviewStore,
    {
      id: nextReviewId(),
      aipId: input.aipId,
      reviewerId: input.reviewerId,
      reviewerName: input.reviewerId,
      action: input.action,
      note: typeof input.note === "string" ? input.note : null,
      createdAt: nowIso(),
    },
  ];
}

export function createMockAipSubmissionsReviewRepo(): AipSubmissionsReviewRepo {
  return {
    async listSubmissionsForCity({
      cityId,
      actor,
    }): Promise<ListSubmissionsResult> {
      requireCityReviewer(actor, cityId);

      const baseRows = AIPS_TABLE.filter(
        (aip) =>
          aip.scope === "barangay" &&
          aip.status !== "draft" &&
          getBarangayCityId(aip.id) === cityId
      ).map((aip) => {
        const latest = latestReviewForAip(aip.id);
        return {
          id: aip.id,
          title: aip.title,
          year: aip.year,
          status: aip.status,
          scope: "barangay",
          barangayName: aip.barangayName ?? null,
          uploadedAt: aip.uploadedAt,
          reviewerName: toActiveClaimReviewerName(latest),
        } satisfies AipSubmissionRow;
      });

      const rows = sortNewestFirst(baseRows);
      return { rows, counts: buildCounts(rows) };
    },

    async getSubmissionAipDetail({ aipId, actor }) {
      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) return null;

      if (!actor) throw new Error("Unauthorized.");

      // Determine jurisdiction context:
      const cityId =
        actor.role === "city_official" && actor.scope.kind === "city"
          ? actor.scope.id
          : MOCK_CITY_ID;
      if (!cityId) throw new Error("Unauthorized.");

      requireCityReviewer(actor, cityId);
      assertInJurisdiction(aip, cityId);

      const enrichedAip = await enrichMockSubmissionAipDetail(aip);
      const latest = latestReviewForAip(aipId);
      return { aip: enrichedAip, latestReview: toLatestReview(latest) };
    },

    async claimReview({ aipId, actor }): Promise<AipStatus> {
      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) throw new Error("AIP not found.");
      if (!actor) throw new Error("Unauthorized.");

      const cityId =
        actor.role === "city_official" && actor.scope.kind === "city"
          ? actor.scope.id
          : MOCK_CITY_ID;
      if (!cityId) throw new Error("Unauthorized.");

      requireCityReviewer(actor, cityId);
      assertInJurisdiction(aip, cityId);

      if (aip.status !== "pending_review" && aip.status !== "under_review") {
        throw new Error("AIP is not available for review claim.");
      }

      const activeClaim = activeClaimForAip(aipId);
      if (
        activeClaim &&
        activeClaim.reviewerId !== actor.userId &&
        actor.role !== "admin"
      ) {
        throw new Error("This AIP is assigned to another reviewer.");
      }

      if (!activeClaim || activeClaim.reviewerId !== actor.userId) {
        reviewStore = [
          ...reviewStore,
          {
            id: nextReviewId(),
            aipId,
            reviewerId: actor.userId || MOCK_REVIEWER_ID,
            reviewerName: toReviewerName(actor),
            action: "claim_review",
            note: null,
            createdAt: nowIso(),
          },
        ];
      }

      if (aip.status === "pending_review") {
        const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
        AIPS_TABLE[index] = { ...aip, status: "under_review" };
      }

      return "under_review";
    },

    async forceUnclaimReview({ aipId, note, actor }) {
      const trimmed = note.trim();
      if (!trimmed) throw new Error("Admin message is required.");
      if (!actor || actor.role !== "admin") throw new Error("Unauthorized.");

      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) throw new Error("AIP not found.");
      if (aip.scope !== "barangay") {
        throw new Error("AIP is not a barangay submission.");
      }
      if (aip.status !== "under_review") {
        throw new Error("Force unclaim is only allowed when the AIP is under review.");
      }

      const activeClaim = activeClaimForAip(aipId);
      if (!activeClaim) {
        throw new Error("AIP has no active review claim.");
      }

      reviewStore = [
        ...reviewStore,
        {
          id: nextReviewId(),
          aipId,
          reviewerId: actor.userId || MOCK_REVIEWER_ID,
          reviewerName: toReviewerName(actor),
          action: "force_unclaim",
          note: trimmed,
          createdAt: nowIso(),
        },
      ];

      const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
      AIPS_TABLE[index] = { ...aip, status: "pending_review" };

      return {
        status: "pending_review" as const,
        previousReviewerId: activeClaim.reviewerId,
      };
    },

    async startReviewIfNeeded({ aipId, actor }): Promise<AipStatus> {
      // Legacy entrypoint kept for compatibility. Claims the review owner explicitly.
      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) throw new Error("AIP not found.");
      if (!actor) throw new Error("Unauthorized.");

      const cityId =
        actor.role === "city_official" && actor.scope.kind === "city"
          ? actor.scope.id
          : MOCK_CITY_ID;
      if (!cityId) throw new Error("Unauthorized.");

      requireCityReviewer(actor, cityId);
      assertInJurisdiction(aip, cityId);

      if (aip.status !== "pending_review" && aip.status !== "under_review") {
        throw new Error("AIP is not available for review claim.");
      }

      const activeClaim = activeClaimForAip(aipId);
      if (
        activeClaim &&
        activeClaim.reviewerId !== actor.userId &&
        actor.role !== "admin"
      ) {
        throw new Error("This AIP is assigned to another reviewer.");
      }

      if (!activeClaim || activeClaim.reviewerId !== actor.userId) {
        reviewStore = [
          ...reviewStore,
          {
            id: nextReviewId(),
            aipId,
            reviewerId: actor.userId || MOCK_REVIEWER_ID,
            reviewerName: toReviewerName(actor),
            action: "claim_review",
            note: null,
            createdAt: nowIso(),
          },
        ];
      }

      if (aip.status === "pending_review") {
        const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
        AIPS_TABLE[index] = { ...aip, status: "under_review" };
      }

      return "under_review";
    },

    async requestRevision({ aipId, note, actor }): Promise<AipStatus> {
      const trimmed = note.trim();
      if (!trimmed) throw new Error("Revision comments are required.");

      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) throw new Error("AIP not found.");
      if (!actor) throw new Error("Unauthorized.");

      const cityId =
        actor.role === "city_official" && actor.scope.kind === "city"
          ? actor.scope.id
          : MOCK_CITY_ID;
      if (!cityId) throw new Error("Unauthorized.");

      requireCityReviewer(actor, cityId);
      assertInJurisdiction(aip, cityId);

      if (aip.status !== "under_review") {
        throw new Error("Request Revision is only allowed when the AIP is under review.");
      }
      assertClaimOwnership(aipId, actor);

      reviewStore = [
        ...reviewStore,
        {
          id: nextReviewId(),
          aipId,
          reviewerId: actor.userId || MOCK_REVIEWER_ID,
          reviewerName: toReviewerName(actor),
          action: "request_revision",
          note: trimmed,
          createdAt: nowIso(),
        },
      ];

      const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
      AIPS_TABLE[index] = { ...aip, status: "for_revision" };
      return "for_revision";
    },

    async publishAip({ aipId, note, actor }): Promise<AipStatus> {
      const trimmed = typeof note === "string" ? note.trim() : "";

      const aip = AIPS_TABLE.find((row) => row.id === aipId) ?? null;
      if (!aip) throw new Error("AIP not found.");
      if (!actor) throw new Error("Unauthorized.");

      const cityId =
        actor.role === "city_official" && actor.scope.kind === "city"
          ? actor.scope.id
          : MOCK_CITY_ID;
      if (!cityId) throw new Error("Unauthorized.");

      requireCityReviewer(actor, cityId);
      assertInJurisdiction(aip, cityId);

      if (aip.status !== "under_review") {
        throw new Error("Publish is only allowed when the AIP is under review.");
      }
      assertClaimOwnership(aipId, actor);

      reviewStore = [
        ...reviewStore,
        {
          id: nextReviewId(),
          aipId,
          reviewerId: actor.userId || MOCK_REVIEWER_ID,
          reviewerName: toReviewerName(actor),
          action: "approve",
          note: trimmed ? trimmed : null,
          createdAt: nowIso(),
        },
      ];

      const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
      AIPS_TABLE[index] = { ...aip, status: "published", publishedAt: todayIsoDate() };
      return "published";
    },

    async getLatestReview({ aipId }): Promise<LatestReview> {
      return toLatestReview(latestReviewForAip(aipId));
    },
  };
}
