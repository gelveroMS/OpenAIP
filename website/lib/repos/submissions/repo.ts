import { NotImplementedError } from "@/lib/core/errors";
import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockAipSubmissionsReviewRepo } from "./repo.mock";

export type {
  AipReviewCounts,
  AipStatus,
  AipSubmissionRow,
  ClaimReviewParams,
  CityReviewFilters,
  ForceUnclaimReviewParams,
  ForceUnclaimReviewResult,
  GetLatestReviewParams,
  GetSubmissionAipDetailParams,
  LatestReview,
  ListSubmissionsForCityParams,
  ListSubmissionsResult,
  PublishAipParams,
  RequestRevisionParams,
  StartReviewIfNeededParams,
} from "./types";

import type {
  AipHeader,
  AipStatus,
  ClaimReviewParams,
  ForceUnclaimReviewParams,
  ForceUnclaimReviewResult,
  GetLatestReviewParams,
  GetSubmissionAipDetailParams,
  LatestReview,
  ListSubmissionsForCityParams,
  ListSubmissionsResult,
  PublishAipParams,
  RequestRevisionParams,
  StartReviewIfNeededParams,
} from "./types";

// [DATAFLOW] Server actions/services depend on this contract; adapters implement DBV2 review + status transitions.
// [DBV2] Backing tables are `public.aips` (status) + `public.aip_reviews` (append-only reviewer log).
// [SECURITY] Reviewer actions are jurisdiction-gated (city/municipal) and require AIP non-draft; DBV2 allows reviewers to update barangay AIPs under scope.
// [SUPABASE-SWAP] Supabase adapter should update `public.aips.status` + insert into `public.aip_reviews`, relying on RLS policies for enforcement.
export type AipSubmissionsReviewRepo = {
  listSubmissionsForCity: (
    params: ListSubmissionsForCityParams
  ) => Promise<ListSubmissionsResult>;
  getSubmissionAipDetail: (
    params: GetSubmissionAipDetailParams
  ) => Promise<{ aip: AipHeader; latestReview: LatestReview } | null>;
  claimReview: (params: ClaimReviewParams) => Promise<AipStatus>;
  forceUnclaimReview: (params: ForceUnclaimReviewParams) => Promise<ForceUnclaimReviewResult>;
  startReviewIfNeeded: (params: StartReviewIfNeededParams) => Promise<AipStatus>;
  requestRevision: (params: RequestRevisionParams) => Promise<AipStatus>;
  publishAip: (params: PublishAipParams) => Promise<AipStatus>;
  getLatestReview: (params: GetLatestReviewParams) => Promise<LatestReview>;
};

export function getAipSubmissionsReviewRepo(): AipSubmissionsReviewRepo {
  return selectRepo({
    label: "AipSubmissionsReviewRepo",
    mock: () => createMockAipSubmissionsReviewRepo(),
    supabase: () => {
      throw new NotImplementedError(
        "AipSubmissionsReviewRepo is server-only outside mock mode. Import from `@/lib/repos/submissions/repo.server`."
      );
    },
  });
}
