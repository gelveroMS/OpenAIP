import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockFeedbackModerationProjectUpdatesRepo } from "./repo.mock";
import { createSupabaseFeedbackModerationProjectUpdatesRepo } from "./repo.supabase";
import type {
  ModerationActionRecord,
  ProjectRecord,
  AipRecord,
  ProfileRecord,
  CityRecord,
  BarangayRecord,
  MunicipalityRecord,
  ProjectUpdateRecord,
  ProjectUpdateMediaRecord,
} from "./types";

export type FeedbackModerationProjectUpdatesSeed = {
  updates: ProjectUpdateRecord[];
  media: ProjectUpdateMediaRecord[];
  actions: ModerationActionRecord[];
  lguMap: {
    projects: ProjectRecord[];
    aips: AipRecord[];
    profiles: ProfileRecord[];
    cities: CityRecord[];
    barangays: BarangayRecord[];
    municipalities: MunicipalityRecord[];
  };
};

export type ProjectUpdateModerationScope = {
  region_id?: string | null;
  province_id?: string | null;
  city_id?: string | null;
  municipality_id?: string | null;
  barangay_id?: string | null;
};

export type ProjectUpdateModerationInput = {
  updateId: string;
  reason: string;
  violationCategory?: string | null;
  scope?: ProjectUpdateModerationScope | null;
};

export interface FeedbackModerationProjectUpdatesRepo {
  getSeedData(): Promise<FeedbackModerationProjectUpdatesSeed>;
  hideUpdate(input: ProjectUpdateModerationInput): Promise<FeedbackModerationProjectUpdatesSeed>;
  unhideUpdate(input: ProjectUpdateModerationInput): Promise<FeedbackModerationProjectUpdatesSeed>;
}

export function getFeedbackModerationProjectUpdatesRepo(): FeedbackModerationProjectUpdatesRepo {
  return selectRepo({
    label: "FeedbackModerationProjectUpdatesRepo",
    mock: () => createMockFeedbackModerationProjectUpdatesRepo(),
    supabase: () => createSupabaseFeedbackModerationProjectUpdatesRepo(),
  });
}
