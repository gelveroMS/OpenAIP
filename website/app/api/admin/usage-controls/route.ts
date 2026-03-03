import { NextResponse } from "next/server";
import { writeActivityLog } from "@/lib/audit/activity-log";
import { getActivityScopeFromActor } from "@/lib/auth/actor-scope-guards";
import type {
  ActivityLogRow,
  ChatMessageRow,
  ChatRateEventRow,
  FeedbackRow,
  ProfileRow,
} from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import {
  deriveChatbotMetrics,
  mapFlaggedUsers,
  mapUserAuditHistory,
} from "@/lib/repos/usage-controls/mappers/usage-controls.mapper";
import {
  clearBlockedUser,
  getTypedAppSetting,
  isSettingsStoreUnavailableError,
  type BlockedUsersSetting,
  setBlockedUser,
  setTypedAppSetting,
} from "@/lib/settings/app-settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

type UsageControlsAction =
  | {
      action: "update_rate_limit";
      payload: { maxComments: number; timeWindow: "hour" | "day"; performedBy?: string | null };
    }
  | {
      action: "update_chatbot_rate_limit";
      payload: {
        maxRequests: number;
        timeWindow: "per_hour" | "per_day";
        performedBy?: string | null;
      };
    }
  | {
      action: "block_user";
      payload: {
        userId: string;
        reason: string;
        durationValue: number;
        durationUnit: "days" | "weeks";
        performedBy?: string | null;
      };
    }
  | {
      action: "unblock_user";
      payload: { userId: string; reason: string; performedBy?: string | null };
    };

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

function toIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveBlockedUntil(input: { durationValue: number; durationUnit: "days" | "weeks" }) {
  const days = input.durationUnit === "weeks" ? input.durationValue * 7 : input.durationValue;
  return toIsoDateOnly(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

async function loadDataset(): Promise<{
  profiles: ProfileRow[];
  feedback: FeedbackRow[];
  activity: ActivityLogRow[];
  chatMessages: ChatMessageRow[];
  chatRateEvents: ChatRateEventRow[];
}> {
  const admin = supabaseAdmin();
  const [profilesResult, feedbackResult, activityResult, chatMessagesResult, chatRateEventsResult] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id,role,full_name,email,barangay_id,city_id,municipality_id,is_active,created_at,updated_at"),
      admin
        .from("feedback")
        .select(
          "id,target_type,aip_id,project_id,parent_feedback_id,source,kind,extraction_run_id,extraction_artifact_id,field_key,severity,body,is_public,author_id,created_at,updated_at"
        ),
      admin
        .from("activity_log")
        .select(
          "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
        )
        .order("created_at", { ascending: false }),
      admin
        .from("chat_messages")
        .select("id,session_id,role,content,citations,retrieval_meta,created_at"),
      admin
        .from("chat_rate_events")
        .select("id,user_id,route,event_status,created_at"),
    ]);

  const firstError = [
    profilesResult,
    feedbackResult,
    activityResult,
    chatMessagesResult,
    chatRateEventsResult,
  ].find((result) => result.error)?.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    profiles: (profilesResult.data ?? []) as ProfileRow[],
    feedback: (feedbackResult.data ?? []) as FeedbackRow[],
    activity: (activityResult.data ?? []) as ActivityLogRow[],
    chatMessages: (chatMessagesResult.data ?? []) as ChatMessageRow[],
    chatRateEvents: (chatRateEventsResult.data ?? []) as ChatRateEventRow[],
  };
}

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  if (typeof max === "number") return Math.min(max, parsed);
  return parsed;
}

function parseYmd(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function buildStateResponse(input?: { dateFrom?: string | null; dateTo?: string | null }) {
  const [dataset, commentRate, chatbotRateLimit, blockedUsers] = await Promise.all([
    loadDataset(),
    getTypedAppSetting("controls.comment_rate_limit"),
    getTypedAppSetting("controls.chatbot_rate_limit"),
    getTypedAppSetting("controls.blocked_users"),
  ]);

  return {
    rateLimitSettings: {
      maxComments: commentRate.maxComments,
      timeWindow: commentRate.timeWindow,
      updatedAt: commentRate.updatedAt ?? new Date().toISOString(),
      updatedBy: commentRate.updatedBy ?? null,
    },
    flaggedUsers: mapFlaggedUsers({
      ...dataset,
      blockedUsers: blockedUsers as BlockedUsersSetting,
    }),
    chatbotMetrics: deriveChatbotMetrics({
      chatMessages: dataset.chatMessages,
      chatRateEvents: dataset.chatRateEvents,
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
    }),
    chatbotRateLimitPolicy: {
      maxRequests: chatbotRateLimit.maxRequests,
      timeWindow: chatbotRateLimit.timeWindow,
      updatedAt: chatbotRateLimit.updatedAt ?? new Date().toISOString(),
      updatedBy: chatbotRateLimit.updatedBy ?? null,
    },
  };
}

export async function GET(request: Request) {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") return unauthorized();

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (userId) {
      const offset = parsePositiveInt(url.searchParams.get("offset"), 0);
      const limit = Math.max(1, parsePositiveInt(url.searchParams.get("limit"), 2, 50));
      const dataset = await loadDataset();
      const allEntries = mapUserAuditHistory({
        userId,
        feedback: dataset.feedback,
        activity: dataset.activity,
      });
      const entries = allEntries.slice(offset, offset + limit);
      return NextResponse.json(
        {
          entries,
          total: allEntries.length,
          offset,
          limit,
          hasNext: offset + limit < allEntries.length,
        },
        { status: 200 }
      );
    }

    const state = await buildStateResponse({
      dateFrom: parseYmd(url.searchParams.get("from")),
      dateTo: parseYmd(url.searchParams.get("to")),
    });
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load usage controls state.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") return unauthorized();

  try {
    const body = (await request.json()) as UsageControlsAction;
    const activityScope = getActivityScopeFromActor(actor);
    const now = new Date().toISOString();

    if (body.action === "update_rate_limit") {
      const performedBy = body.payload.performedBy ?? "Admin";
      const next = await setTypedAppSetting("controls.comment_rate_limit", {
        maxComments: body.payload.maxComments,
        timeWindow: body.payload.timeWindow,
        updatedAt: now,
        updatedBy: performedBy,
      });

      await writeActivityLog({
        action: "comment_rate_limit_updated",
        metadata: {
          max_comments: next.maxComments,
          time_window: next.timeWindow,
          actor_name: performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json(
        {
          rateLimitSettings: {
            maxComments: next.maxComments,
            timeWindow: next.timeWindow,
            updatedAt: next.updatedAt ?? now,
            updatedBy: next.updatedBy ?? null,
          },
        },
        { status: 200 }
      );
    }

    if (body.action === "update_chatbot_rate_limit") {
      const performedBy = body.payload.performedBy ?? "Admin";
      const next = await setTypedAppSetting("controls.chatbot_rate_limit", {
        maxRequests: body.payload.maxRequests,
        timeWindow: body.payload.timeWindow,
        updatedAt: now,
        updatedBy: performedBy,
      });

      await writeActivityLog({
        action: "chatbot_rate_limit_updated",
        metadata: {
          max_requests: next.maxRequests,
          time_window: next.timeWindow,
          actor_name: performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json(
        {
          chatbotRateLimitPolicy: {
            maxRequests: next.maxRequests,
            timeWindow: next.timeWindow,
            updatedAt: next.updatedAt ?? now,
            updatedBy: next.updatedBy ?? null,
          },
        },
        { status: 200 }
      );
    }

    if (body.action === "block_user") {
      const performedBy = body.payload.performedBy ?? "Admin";
      const blockedUntil = resolveBlockedUntil({
        durationValue: body.payload.durationValue,
        durationUnit: body.payload.durationUnit,
      });

      await setBlockedUser({
        userId: body.payload.userId,
        blockedUntil,
        reason: body.payload.reason,
        updatedAt: now,
        updatedBy: performedBy,
      });

      await writeActivityLog({
        action: "user_blocked",
        entityTable: "profiles",
        entityId: body.payload.userId,
        metadata: {
          reason: body.payload.reason,
          blocked_until: blockedUntil,
          actor_name: performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (body.action === "unblock_user") {
      const performedBy = body.payload.performedBy ?? "Admin";
      await clearBlockedUser(body.payload.userId);
      await writeActivityLog({
        action: "user_unblocked",
        entityTable: "profiles",
        entityId: body.payload.userId,
        metadata: {
          reason: body.payload.reason,
          actor_name: performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
  } catch (error) {
    if (isSettingsStoreUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Settings store unavailable.";
      return NextResponse.json({ message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Failed to update usage controls.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
