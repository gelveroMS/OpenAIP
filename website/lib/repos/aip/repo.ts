import { NotImplementedError } from "@/lib/core/errors";
import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockAipProjectRepo, createMockAipRepoImpl } from "./repo.mock";

import type {
  AipDetail,
  AipListItem,
  AipProjectReviewDetail,
  AipProjectRow,
  AipStatus,
  CreateMockAipRepoOptions,
  LguScope,
  ListVisibleAipsInput,
  SubmitReviewInput,
} from "./types";

export type {
  AipDetail,
  AipProjectFeedbackMessage,
  AipProjectFeedbackThread,
  AipRevisionFeedbackCycle,
  AipRevisionFeedbackMessage,
  AipHeader,
  AipProjectEditPatch,
  AipProjectEditableFields,
  AipProjectReviewDetail,
  AipListItem,
  AipProjectRow,
  AipStatus,
  CreateMockAipRepoOptions,
  LguScope,
  ListVisibleAipsInput,
  ProjectCategory,
  ProjectKind,
  ReviewStatus,
  reviewStatus,
  Sector,
  SubmitReviewInput,
} from "./types";

// [DATAFLOW] UI/pages should depend on this interface, not on a concrete adapter.
// [DBV2] Backing table is `public.aips` (enum `public.aip_status`).
export interface AipRepo {
  listVisibleAips(
    input: ListVisibleAipsInput,
    actor?: import("@/lib/domain/actor-context").ActorContext | null
  ): Promise<AipListItem[]>;
  getAipDetail(
    aipId: string,
    actor?: import("@/lib/domain/actor-context").ActorContext | null
  ): Promise<AipDetail | null>;
  updateAipStatus(
    aipId: string,
    next: AipStatus,
    actor?: import("@/lib/domain/actor-context").ActorContext | null
  ): Promise<void>;
}

// [DATAFLOW] Used by AIP detail views to list rows/projects under an AIP and submit review notes.
export interface AipProjectRepo {
  listByAip(aipId: string): Promise<AipProjectRow[]>;
  getReviewDetail(aipId: string, projectId: string): Promise<AipProjectReviewDetail | null>;
  submitReview(input: SubmitReviewInput): Promise<AipProjectRow>;
}

export function getAipRepo(options: CreateMockAipRepoOptions = {}): AipRepo {
  return selectRepo({
    label: "AipRepo",
    mock: () => createMockAipRepoImpl(options),
    supabase: () => {
      throw new NotImplementedError(
        "AipRepo is server-only outside mock mode. Import from `@/lib/repos/aip/repo.server`."
      );
    },
  });
}

export function getAipProjectRepo(_scope?: LguScope): AipProjectRepo {
  void _scope;
  return selectRepo({
    label: "AipProjectRepo",
    mock: () => createMockAipProjectRepo(),
    supabase: () => {
      throw new NotImplementedError(
        "AipProjectRepo is server-only outside mock mode. Import from `@/lib/repos/aip/repo.server`."
      );
    },
  });
}
