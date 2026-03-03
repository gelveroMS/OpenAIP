import { PLATFORM_CONTROLS_DATASET } from "@/mocks/fixtures/admin/usage-controls/platformControls.mock";
import type { ActivityLogRow } from "@/lib/contracts/databasev2";
import type { BlockedUsersSetting } from "@/lib/settings/app-settings";
import type { PlatformControlsDataset, UsageControlsRepo } from "./types";
import {
  deriveRateLimitSettings,
  deriveChatbotMetrics,
  deriveChatbotRateLimitPolicy,
  mapFlaggedUsers,
  mapUserAuditHistory,
} from "./mappers/usage-controls.mapper";

let idCounter = 0;

const nowIso = () => new Date().toISOString();

const createId = (prefix: string) => {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
};

const cloneDataset = (dataset: PlatformControlsDataset): PlatformControlsDataset => ({
  profiles: dataset.profiles.map((row) => ({ ...row })),
  feedback: dataset.feedback.map((row) => ({ ...row })),
  activity: dataset.activity.map((row) => ({ ...row })),
  chatMessages: dataset.chatMessages.map((row) => ({ ...row })),
  chatRateEvents: dataset.chatRateEvents.map((row) => ({ ...row })),
});

const createStore = () => cloneDataset(PLATFORM_CONTROLS_DATASET);

const store = createStore();

const appendActivity = (input: ActivityLogRow) => {
  store.activity = [...store.activity, input];
};

const deriveBlockedUntil = (durationValue: number, durationUnit: "days" | "weeks") => {
  const days = durationUnit === "weeks" ? durationValue * 7 : durationValue;
  const blockedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return blockedUntil.toISOString().slice(0, 10);
};

const getMetadataString = (metadata: unknown, key: string): string | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const deriveBlockedUsersFromActivity = (activity: ActivityLogRow[]): BlockedUsersSetting => {
  const profileLogs = activity
    .filter((row) => row.entity_table === "profiles" && row.entity_id)
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const blockedUsers: BlockedUsersSetting = {};
  const seen = new Set<string>();
  for (const row of profileLogs) {
    const entityId = row.entity_id;
    if (!entityId || seen.has(entityId)) continue;
    seen.add(entityId);

    if (row.action !== "user_blocked") continue;
    const blockedUntil = getMetadataString(row.metadata, "blocked_until");
    if (!blockedUntil) continue;
    blockedUsers[entityId] = {
      blockedUntil,
      reason: getMetadataString(row.metadata, "reason") ?? "Policy violation",
      updatedAt: row.created_at,
      updatedBy: getMetadataString(row.metadata, "actor_name"),
    };
  }
  return blockedUsers;
};

export function createMockUsageControlsRepo(): UsageControlsRepo {
  return {
    async getRateLimitSettings() {
      return deriveRateLimitSettings(store.activity);
    },
    async updateRateLimitSettings(input) {
      appendActivity({
        id: createId("activity"),
        actor_id: "admin_001",
        actor_role: "admin",
        action: "comment_rate_limit_updated",
        entity_table: null,
        entity_id: null,
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: {
          max_comments: input.maxComments,
          time_window: input.timeWindow,
          actor_name: "Admin Maria Rodriguez",
        },
        created_at: nowIso(),
      });
      return deriveRateLimitSettings(store.activity);
    },
    async listFlaggedUsers() {
      return mapFlaggedUsers({
        ...store,
        blockedUsers: deriveBlockedUsersFromActivity(store.activity),
      });
    },
    async getChatbotMetrics(input) {
      return deriveChatbotMetrics({
        chatMessages: store.chatMessages,
        chatRateEvents: store.chatRateEvents,
        dateFrom: input?.dateFrom,
        dateTo: input?.dateTo,
      });
    },
    async getChatbotRateLimitPolicy() {
      return deriveChatbotRateLimitPolicy(store.activity);
    },
    async updateChatbotRateLimitPolicy(input) {
      appendActivity({
        id: createId("activity"),
        actor_id: "admin_001",
        actor_role: "admin",
        action: "chatbot_rate_limit_updated",
        entity_table: null,
        entity_id: null,
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: {
          max_requests: input.maxRequests,
          time_window: input.timeWindow,
          actor_name: "Admin Maria Rodriguez",
        },
        created_at: nowIso(),
      });
      return deriveChatbotRateLimitPolicy(store.activity);
    },
    async getUserAuditHistory(input) {
      const offset = Math.max(0, input.offset ?? 0);
      const limit = Math.min(50, Math.max(1, input.limit ?? 2));
      const allEntries = mapUserAuditHistory({
        userId: input.userId,
        feedback: store.feedback,
        activity: store.activity,
      });

      return {
        entries: allEntries.slice(offset, offset + limit),
        total: allEntries.length,
        offset,
        limit,
        hasNext: offset + limit < allEntries.length,
      };
    },
    async temporarilyBlockUser(input) {
      appendActivity({
        id: createId("activity"),
        actor_id: "admin_001",
        actor_role: "admin",
        action: "user_blocked",
        entity_table: "profiles",
        entity_id: input.userId,
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: {
          reason: input.reason,
          blocked_until: deriveBlockedUntil(input.durationValue, input.durationUnit),
          actor_name: "Admin Maria Rodriguez",
        },
        created_at: nowIso(),
      });
    },
    async unblockUser(input) {
      appendActivity({
        id: createId("activity"),
        actor_id: "admin_001",
        actor_role: "admin",
        action: "user_unblocked",
        entity_table: "profiles",
        entity_id: input.userId,
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: {
          reason: input.reason,
          actor_name: "Admin Maria Rodriguez",
        },
        created_at: nowIso(),
      });
    },
  };
}
