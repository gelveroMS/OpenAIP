import type { AipStatus, ISODateTime, ReviewAction, UUID } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import type { AipHeader } from "@/lib/repos/aip/repo";

export type AipSubmissionRow = {
  id: UUID;
  title: string;
  year: number;
  status: AipStatus;
  scope: "barangay" | "city" | "municipality";
  barangayName?: string | null;
  uploadedAt: ISODateTime;
  reviewerName?: string | null;
};

export type AipReviewCounts = {
  total: number;
  published: number;
  underReview: number;
  pendingReview: number;
  forRevision: number;
};

export type ListSubmissionsResult = {
  rows: AipSubmissionRow[];
  counts: AipReviewCounts;
};

export type LatestReview = {
  reviewerId: UUID;
  reviewerName: string;
  action: ReviewAction;
  note: string | null;
  createdAt: ISODateTime;
} | null;

export type CityReviewFilters = {
  year?: number;
  status?: AipStatus;
  barangayName?: string;
};

export type ListSubmissionsForCityParams = {
  cityId: string;
  filters?: CityReviewFilters;
  actor: ActorContext | null;
};

export type GetSubmissionAipDetailParams = {
  aipId: string;
  actor: ActorContext | null;
};

export type StartReviewIfNeededParams = {
  aipId: string;
  actor: ActorContext | null;
};

export type ClaimReviewParams = {
  aipId: string;
  actor: ActorContext | null;
};

export type ForceUnclaimReviewParams = {
  aipId: string;
  note: string;
  actor: ActorContext | null;
};

export type ForceUnclaimReviewResult = {
  status: AipStatus;
  previousReviewerId: UUID;
};

export type RequestRevisionParams = {
  aipId: string;
  note: string;
  actor: ActorContext | null;
};

export type PublishAipParams = {
  aipId: string;
  note?: string;
  actor: ActorContext | null;
};

export type GetLatestReviewParams = {
  aipId: string;
};

export type { AipHeader, ActorContext, AipStatus };

