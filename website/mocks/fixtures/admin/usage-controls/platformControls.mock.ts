import type {
  ActivityLogRow,
  ChatMessageRow,
  ChatRateEventRow,
} from "@/lib/contracts/databasev2";
import { FEEDBACK_MODERATION_DATASET } from "@/mocks/fixtures/admin/feedback-moderation/feedbackModeration.mock";
import type { PlatformControlsDataset } from "@/lib/repos/usage-controls/types";

const ADMIN_ID = "admin_001";

const createActivity = (input: ActivityLogRow): ActivityLogRow => ({ ...input });

const RATE_LIMIT_LOG: ActivityLogRow = createActivity({
  id: "activity_rate_limit_001",
  actor_id: ADMIN_ID,
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
    max_comments: 5,
    time_window: "hour",
    actor_name: "Admin Maria Rodriguez",
  },
  created_at: "2026-02-13T09:15:00.000Z",
});

const CHATBOT_RATE_LIMIT_LOG: ActivityLogRow = createActivity({
  id: "activity_chatbot_rate_limit_001",
  actor_id: ADMIN_ID,
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
    max_requests: 20,
    time_window: "per_hour",
    actor_name: "Admin Maria Rodriguez",
  },
  created_at: "2026-02-13T09:25:00.000Z",
});

const CHATBOT_POLICY_LOG: ActivityLogRow = createActivity({
  id: "activity_chatbot_policy_001",
  actor_id: ADMIN_ID,
  actor_role: "admin",
  action: "chatbot_policy_updated",
  entity_table: null,
  entity_id: null,
  region_id: null,
  province_id: null,
  city_id: null,
  municipality_id: null,
  barangay_id: null,
  metadata: {
    is_enabled: true,
    retention_days: 90,
    user_disclaimer:
      "This disclaimer will be shown to users before they interact with the chatbot.",
    actor_name: "Admin Maria Rodriguez",
  },
  created_at: "2026-02-13T09:30:00.000Z",
});

const BLOCK_LOGS: ActivityLogRow[] = [
  createActivity({
    id: "activity_block_001",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "user_blocked",
    entity_table: "profiles",
    entity_id: "profile_maria",
    region_id: null,
    province_id: null,
    city_id: "city_mnl",
    municipality_id: null,
    barangay_id: "brgy_poblacion",
    metadata: {
      reason: "Abusive language in multiple comments.",
      blocked_until: "2026-02-20",
      actor_name: "Admin Maria Rodriguez",
    },
    created_at: "2026-02-12T10:00:00.000Z",
  }),
  createActivity({
    id: "activity_block_002",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "user_blocked",
    entity_table: "profiles",
    entity_id: "profile_pedro",
    region_id: null,
    province_id: null,
    city_id: "city_qc",
    municipality_id: null,
    barangay_id: "brgy_sanisidro",
    metadata: {
      reason: "Personal attacks and defamation.",
      blocked_until: "2026-02-23",
      actor_name: "Admin Maria Rodriguez",
    },
    created_at: "2026-02-09T08:30:00.000Z",
  }),
];

const EXTRA_HIDDEN_LOGS: ActivityLogRow[] = [
  createActivity({
    id: "activity_003",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "feedback_hidden",
    entity_table: "feedback",
    entity_id: "feedback_001",
    region_id: null,
    province_id: null,
    city_id: "city_qc",
    municipality_id: null,
    barangay_id: "brgy_sanisidro",
    metadata: {
      reason: "Spam comments - repeatedly posting identical content",
      violation_category: "Spam",
      actor_name: "Admin Maria Rodriguez",
    },
    created_at: "2026-02-13T07:45:00.000Z",
  }),
];

export const PLATFORM_CONTROLS_DATASET: PlatformControlsDataset = {
  profiles: FEEDBACK_MODERATION_DATASET.profiles.map((row) => ({ ...row })),
  feedback: FEEDBACK_MODERATION_DATASET.feedback.map((row) => ({ ...row })),
  activity: [
    ...FEEDBACK_MODERATION_DATASET.activity.map((row) => ({ ...row })),
    RATE_LIMIT_LOG,
    CHATBOT_RATE_LIMIT_LOG,
    CHATBOT_POLICY_LOG,
    ...BLOCK_LOGS,
    ...EXTRA_HIDDEN_LOGS,
  ],
  chatMessages: [
    {
      id: "chat_msg_001",
      session_id: "chat_session_001",
      role: "assistant",
      content: "Sample accepted response",
      citations: null,
      retrieval_meta: { reason: "ok" },
      created_at: "2026-02-28T09:00:00.000Z",
    },
    {
      id: "chat_msg_002",
      session_id: "chat_session_002",
      role: "assistant",
      content: "Sample failure response",
      citations: null,
      retrieval_meta: { reason: "pipeline_error" },
      created_at: "2026-02-27T11:00:00.000Z",
    },
  ] satisfies ChatMessageRow[],
  chatRateEvents: [
    {
      id: "chat_rate_event_001",
      user_id: "profile_maria",
      route: "citizen_chat_reply",
      event_status: "accepted",
      created_at: "2026-02-28T08:58:00.000Z",
    },
    {
      id: "chat_rate_event_002",
      user_id: "profile_pedro",
      route: "barangay_chat_message",
      event_status: "accepted",
      created_at: "2026-02-27T10:58:00.000Z",
    },
    {
      id: "chat_rate_event_003",
      user_id: "profile_pedro",
      route: "barangay_chat_message",
      event_status: "rejected_hour",
      created_at: "2026-02-27T10:59:00.000Z",
    },
  ] satisfies ChatRateEventRow[],
};
