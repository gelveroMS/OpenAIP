import type { Json } from "@/lib/contracts/databasev2";
import type {
  FeedbackModerationProjectUpdatesRepo,
  FeedbackModerationProjectUpdatesSeed,
  ProjectUpdateModerationInput,
} from "./repo";
import {
  PROJECT_UPDATE_ACTIONS,
  PROJECT_UPDATE_LGU_MAP,
  PROJECT_UPDATE_LOGS,
} from "@/mocks/fixtures/admin/feedback-moderation/projectUpdatesMedia.mock";
import type {
  ModerationActionRecord,
  ProjectUpdateMediaRecord,
  ProjectUpdateRecord,
} from "./types";

type UpdateLogMetadata = {
  update_title?: string;
  update_body?: string;
  progress_percent?: number;
  attendance_count?: number;
  media_urls?: string[];
};

type ActionMetadata = {
  reason?: string;
  violation_category?: string | null;
};

const asUpdateLogMetadata = (metadata: Json): UpdateLogMetadata => {
  if (metadata && typeof metadata === "object") return metadata as UpdateLogMetadata;
  return {};
};

const asActionMetadata = (metadata: Json): ActionMetadata => {
  if (metadata && typeof metadata === "object") return metadata as ActionMetadata;
  return {};
};

function buildInitialUpdates(): ProjectUpdateRecord[] {
  const aipIdByProjectId = new Map(
    PROJECT_UPDATE_LGU_MAP.projects.map((project) => [project.id, project.aip_id] as const)
  );

  return PROJECT_UPDATE_LOGS.map((log) => {
    const metadata = asUpdateLogMetadata(log.metadata);
    const aipId = log.entity_id ? aipIdByProjectId.get(log.entity_id) : null;
    return {
      id: log.id,
      project_id: log.entity_id ?? "",
      aip_id: aipId ?? "",
      title: metadata.update_title ?? "Project Update",
      description: metadata.update_body ?? "No update content provided.",
      progress_percent:
        typeof metadata.progress_percent === "number" ? metadata.progress_percent : 0,
      attendance_count:
        typeof metadata.attendance_count === "number" ? metadata.attendance_count : null,
      posted_by: log.actor_id ?? "",
      status: "active",
      hidden_reason: null,
      hidden_violation_category: null,
      hidden_at: null,
      hidden_by: null,
      created_at: log.created_at,
      updated_at: log.created_at,
    };
  });
}

function buildInitialMedia(): ProjectUpdateMediaRecord[] {
  const mediaRows: ProjectUpdateMediaRecord[] = [];

  PROJECT_UPDATE_LOGS.forEach((log) => {
    const metadata = asUpdateLogMetadata(log.metadata);
    const urls = Array.isArray(metadata.media_urls) ? metadata.media_urls : [];

    urls.forEach((url, index) => {
      mediaRows.push({
        id: `mock_update_media_${log.id}_${index + 1}`,
        update_id: log.id,
        project_id: log.entity_id ?? "",
        bucket_id: "project-media",
        object_name: url,
        mime_type: "image/jpeg",
        size_bytes: null,
        created_at: log.created_at,
      });
    });
  });

  return mediaRows;
}

function applyInitialHiddenStateFromActions(
  updates: ProjectUpdateRecord[]
): ProjectUpdateRecord[] {
  const latestActionByUpdateId = new Map<string, (typeof PROJECT_UPDATE_ACTIONS)[number]>();

  PROJECT_UPDATE_ACTIONS.forEach((action) => {
    const updateId = action.entity_id;
    if (!updateId) return;
    const existing = latestActionByUpdateId.get(updateId);
    if (!existing) {
      latestActionByUpdateId.set(updateId, action);
      return;
    }
    if (new Date(action.created_at).getTime() > new Date(existing.created_at).getTime()) {
      latestActionByUpdateId.set(updateId, action);
    }
  });

  return updates.map((update): ProjectUpdateRecord => {
    const action = latestActionByUpdateId.get(update.id);
    if (!action) return update;
    if (action.action === "project_update_unhidden") {
      return {
        ...update,
        status: "active",
        hidden_reason: null,
        hidden_violation_category: null,
        hidden_at: null,
        hidden_by: null,
        updated_at: action.created_at,
      };
    }

    const metadata = asActionMetadata(action.metadata);
    return {
      ...update,
      status: "hidden",
      hidden_reason: metadata.reason ?? "Policy violation.",
      hidden_violation_category: metadata.violation_category ?? null,
      hidden_at: action.created_at,
      hidden_by: action.actor_id ?? null,
      updated_at: action.created_at,
    };
  });
}

export function createMockFeedbackModerationProjectUpdatesRepo(): FeedbackModerationProjectUpdatesRepo {
  let updates: ProjectUpdateRecord[] = applyInitialHiddenStateFromActions(buildInitialUpdates());
  const media = buildInitialMedia();
  let actions: ModerationActionRecord[] = [...PROJECT_UPDATE_ACTIONS];

  const buildSeed = (): FeedbackModerationProjectUpdatesSeed => ({
    updates,
    media,
    actions,
    lguMap: {
      projects: PROJECT_UPDATE_LGU_MAP.projects,
      aips: PROJECT_UPDATE_LGU_MAP.aips,
      profiles: PROJECT_UPDATE_LGU_MAP.profiles,
      cities: PROJECT_UPDATE_LGU_MAP.cities,
      barangays: PROJECT_UPDATE_LGU_MAP.barangays,
      municipalities: PROJECT_UPDATE_LGU_MAP.municipalities,
    },
  });

  const appendAction = (
    input: Pick<ProjectUpdateModerationInput, "updateId" | "reason" | "violationCategory">,
    action: "project_update_hidden" | "project_update_unhidden"
  ) => {
    actions = [
      ...actions,
      {
        id: `mock_update_action_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        actor_id: "admin_001",
        actor_role: "admin",
        action,
        entity_table: "project_updates",
        entity_id: input.updateId,
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: {
          reason: input.reason,
          violation_category: input.violationCategory ?? null,
        },
        created_at: new Date().toISOString(),
      },
    ];
  };

  return {
    async getSeedData() {
      return buildSeed();
    },
    async hideUpdate(input) {
      const timestamp = new Date().toISOString();
      updates = updates.map((update): ProjectUpdateRecord =>
        update.id === input.updateId
          ? {
              ...update,
              status: "hidden",
              hidden_reason: input.reason,
              hidden_violation_category: input.violationCategory ?? null,
              hidden_at: timestamp,
              hidden_by: "admin_001",
              updated_at: timestamp,
            }
          : update
      );
      appendAction(input, "project_update_hidden");
      return buildSeed();
    },
    async unhideUpdate(input) {
      const timestamp = new Date().toISOString();
      updates = updates.map((update): ProjectUpdateRecord =>
        update.id === input.updateId
          ? {
              ...update,
              status: "active",
              hidden_reason: null,
              hidden_violation_category: null,
              hidden_at: null,
              hidden_by: null,
              updated_at: timestamp,
            }
          : update
      );
      appendAction(input, "project_update_unhidden");
      return buildSeed();
    },
  };
}
