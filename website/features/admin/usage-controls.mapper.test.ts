import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveChatbotMetrics,
  mapFlaggedUsers,
} from "@/lib/repos/usage-controls/mappers/usage-controls.mapper";
import type {
  ActivityLogRow,
  ChatMessageRow,
  ChatRateEventRow,
  FeedbackRow,
  ProfileRow,
} from "@/lib/contracts/databasev2";
import type { BlockedUsersSetting } from "@/lib/settings/app-settings";

function makeAcceptedEvent(id: string, createdAt: string): ChatRateEventRow {
  return {
    id,
    user_id: "00000000-0000-4000-8000-000000000001",
    route: "citizen_chat_reply",
    event_status: "accepted",
    created_at: createdAt,
  };
}

function makeAssistantMessage(id: string, createdAt: string, reason: string): ChatMessageRow {
  return {
    id,
    session_id: "00000000-0000-4000-8000-000000000010",
    role: "assistant",
    content: "message",
    citations: null,
    retrieval_meta: { reason },
    created_at: createdAt,
  };
}

describe("usage controls mappers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deriveChatbotMetrics computes rolling-window totals and trends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const currentWindowAccepted = Array.from({ length: 14 }, (_, idx) =>
      makeAcceptedEvent(
        `accepted_current_${idx}`,
        new Date(Date.UTC(2026, 1, 15 + idx, 12, 0, 0)).toISOString()
      )
    );
    const previousWindowAccepted = Array.from({ length: 7 }, (_, idx) =>
      makeAcceptedEvent(
        `accepted_previous_${idx}`,
        new Date(Date.UTC(2026, 1, 2 + idx, 12, 0, 0)).toISOString()
      )
    );
    const chatRateEvents = [...currentWindowAccepted, ...previousWindowAccepted];

    const chatMessages: ChatMessageRow[] = [
      makeAssistantMessage("m1", "2026-02-27T10:00:00.000Z", "pipeline_error"),
      makeAssistantMessage("m2", "2026-02-26T11:00:00.000Z", "validation_failed"),
      makeAssistantMessage("m3", "2026-02-25T12:00:00.000Z", "ok"),
      makeAssistantMessage("m4", "2026-02-08T12:00:00.000Z", "unknown"),
    ];

    const metrics = deriveChatbotMetrics({ chatRateEvents, chatMessages });

    expect(metrics.periodDays).toBe(14);
    expect(metrics.totalRequests).toBe(14);
    expect(metrics.avgDailyRequests).toBe(1);
    expect(metrics.errorRate).toBeCloseTo(2 / 14, 5);
    expect(metrics.trendTotalRequestsPct).toBeCloseTo(100, 5);
    expect(metrics.trendAvgDailyPct).toBeCloseTo(100, 5);
    expect(metrics.trendErrorRatePct).toBeCloseTo(0, 5);
  });

  it("deriveChatbotMetrics honors explicit dashboard date range", () => {
    const chatRateEvents: ChatRateEventRow[] = [
      makeAcceptedEvent("current_1", "2026-02-10T12:00:00.000Z"),
      makeAcceptedEvent("current_2", "2026-02-12T12:00:00.000Z"),
      makeAcceptedEvent("previous_1", "2026-02-07T12:00:00.000Z"),
    ];
    const chatMessages: ChatMessageRow[] = [
      makeAssistantMessage("m1", "2026-02-11T10:00:00.000Z", "pipeline_error"),
      makeAssistantMessage("m2", "2026-02-06T10:00:00.000Z", "pipeline_error"),
    ];

    const metrics = deriveChatbotMetrics({
      chatRateEvents,
      chatMessages,
      dateFrom: "2026-02-10",
      dateTo: "2026-02-12",
    });

    expect(metrics.periodDays).toBe(3);
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.avgDailyRequests).toBeCloseTo(2 / 3, 5);
    expect(metrics.errorRate).toBeCloseTo(0.5, 5);
    expect(metrics.trendTotalRequestsPct).toBeCloseTo(100, 5);
  });

  it("mapFlaggedUsers uses blocked settings and ignores expired blocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const profiles: ProfileRow[] = [
      {
        id: "00000000-0000-4000-8000-000000000101",
        role: "citizen",
        full_name: "Blocked User",
        email: "blocked@example.com",
        barangay_id: null,
        city_id: null,
        municipality_id: null,
        is_active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        role: "citizen",
        full_name: "Expired Block User",
        email: "expired@example.com",
        barangay_id: null,
        city_id: null,
        municipality_id: null,
        is_active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const feedback: FeedbackRow[] = [
      {
        id: "00000000-0000-4000-8000-000000000201",
        target_type: "aip",
        aip_id: "00000000-0000-4000-8000-000000000301",
        project_id: null,
        parent_feedback_id: null,
        source: "human",
        kind: "question",
        extraction_run_id: null,
        extraction_artifact_id: null,
        field_key: null,
        severity: null,
        body: "sample",
        is_public: false,
        author_id: "00000000-0000-4000-8000-000000000102",
        created_at: "2026-02-10T00:00:00.000Z",
        updated_at: "2026-02-10T00:00:00.000Z",
      },
    ];

    const activity: ActivityLogRow[] = [
      {
        id: "00000000-0000-4000-8000-000000000401",
        actor_id: "00000000-0000-4000-8000-000000000999",
        actor_role: "admin",
        action: "feedback_hidden",
        entity_table: "feedback",
        entity_id: "00000000-0000-4000-8000-000000000201",
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: { reason: "Spam", actor_name: "Admin" },
        created_at: "2026-02-11T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000402",
        actor_id: "00000000-0000-4000-8000-000000000999",
        actor_role: "admin",
        action: "user_blocked",
        entity_table: "profiles",
        entity_id: "00000000-0000-4000-8000-000000000101",
        region_id: null,
        province_id: null,
        city_id: null,
        municipality_id: null,
        barangay_id: null,
        metadata: { reason: "Abuse", blocked_until: "2026-03-10", actor_name: "Admin" },
        created_at: "2026-02-25T00:00:00.000Z",
      },
    ];

    const blockedUsers: BlockedUsersSetting = {
      "00000000-0000-4000-8000-000000000101": {
        blockedUntil: "2026-03-10",
        reason: "Abuse",
        updatedAt: "2026-02-25T00:00:00.000Z",
        updatedBy: "Admin",
      },
      "00000000-0000-4000-8000-000000000102": {
        blockedUntil: "2026-02-20",
        reason: "Old block",
        updatedAt: "2026-02-10T00:00:00.000Z",
        updatedBy: "Admin",
      },
    };

    const rows = mapFlaggedUsers({ profiles, feedback, activity, blockedUsers });
    const blockedRow = rows.find((row) => row.userId === "00000000-0000-4000-8000-000000000101");
    const expiredRow = rows.find((row) => row.userId === "00000000-0000-4000-8000-000000000102");

    expect(blockedRow?.status).toBe("Blocked");
    expect(blockedRow?.blockedUntil).toBe("2026-03-10");
    expect(expiredRow?.status).toBe("Active");
    expect(expiredRow?.blockedUntil).toBeNull();
  });
});
