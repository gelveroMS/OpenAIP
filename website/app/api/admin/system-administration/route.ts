import { NextResponse } from "next/server";
import { writeActivityLog } from "@/lib/audit/activity-log";
import { getActivityScopeFromActor } from "@/lib/auth/actor-scope-guards";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { validateSecuritySettings } from "@/lib/security/security-settings.server";
import type {
  SecuritySettings,
  SystemAdministrationUpdateMeta,
  SystemBannerDraft,
} from "@/lib/repos/system-administration/types";
import {
  getTypedAppSetting,
  isSettingsStoreUnavailableError,
  setTypedAppSetting,
} from "@/lib/settings/app-settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ActionPayload =
  | {
      action: "update_security_settings";
      payload: {
        next: SecuritySettings;
        meta?: SystemAdministrationUpdateMeta;
      };
    }
  | {
      action: "publish_system_banner";
      payload: {
        draft: SystemBannerDraft;
        meta?: SystemAdministrationUpdateMeta;
      };
    }
  | {
      action: "unpublish_system_banner";
      payload: {
        meta?: SystemAdministrationUpdateMeta;
      };
    };

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

function parseScheduleDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function validateBannerDraft(draft: SystemBannerDraft): string | null {
  if (!draft.message || draft.message.trim().length === 0) {
    return "Banner message is required.";
  }

  const nowMs = Date.now();
  const startMs = parseScheduleDate(draft.startAt);
  const endMs = parseScheduleDate(draft.endAt);

  if (draft.startAt && startMs === null) {
    return "Banner start date is invalid.";
  }
  if (draft.endAt && endMs === null) {
    return "Banner end date is invalid.";
  }
  if (startMs !== null && endMs !== null && endMs <= startMs) {
    return "Banner end date must be later than the start date.";
  }
  if (endMs !== null && endMs <= nowMs) {
    return "Banner schedule is already in the past.";
  }

  return null;
}

async function listSystemAuditLogs() {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("activity_log")
    .select(
      "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
    )
    .in("action", [
      "security_settings_updated",
      "notification_settings_updated",
      "system_banner_published",
      "system_banner_unpublished",
    ])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function GET() {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") return unauthorized();

  try {
    const [securitySettings, systemBannerDraft, systemBannerPublished, auditLogs] =
      await Promise.all([
        getTypedAppSetting("system.security_settings"),
        getTypedAppSetting("system.banner_draft"),
        getTypedAppSetting("system.banner_published"),
        listSystemAuditLogs(),
      ]);

    return NextResponse.json(
      {
        securitySettings,
        systemBannerDraft,
        systemBannerPublished,
        auditLogs,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load system administration data.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

function resolveMeta(meta?: SystemAdministrationUpdateMeta) {
  return {
    performedBy: meta?.performedBy ?? "Admin",
    performedAt: meta?.performedAt ?? new Date().toISOString(),
    reason: meta?.reason ?? null,
  };
}

export async function POST(request: Request) {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") return unauthorized();

  try {
    const body = (await request.json().catch(() => null)) as ActionPayload | null;
    if (!body || typeof body !== "object" || !("action" in body)) {
      return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
    }
    const activityScope = getActivityScopeFromActor(actor);

    if (body.action === "update_security_settings") {
      if (!body.payload?.next) {
        return NextResponse.json({ message: "Security settings payload is required." }, { status: 400 });
      }
      const validationError = validateSecuritySettings(body.payload.next);
      if (validationError) {
        return NextResponse.json({ message: validationError }, { status: 400 });
      }

      const before = await getTypedAppSetting("system.security_settings");
      const next = await setTypedAppSetting("system.security_settings", body.payload.next);
      const meta = resolveMeta(body.payload.meta);

      await writeActivityLog({
        action: "security_settings_updated",
        metadata: {
          before,
          after: next,
          reason: meta.reason,
          actor_name: meta.performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json(
        {
          securitySettings: next,
          meta: {
            performedBy: meta.performedBy,
            performedAt: meta.performedAt,
          },
        },
        { status: 200 }
      );
    }

    if (body.action === "publish_system_banner") {
      if (!body.payload?.draft) {
        return NextResponse.json({ message: "System banner draft is required." }, { status: 400 });
      }
      const validationError = validateBannerDraft(body.payload.draft);
      if (validationError) {
        return NextResponse.json({ message: validationError }, { status: 400 });
      }

      const beforeDraft = await getTypedAppSetting("system.banner_draft");
      const beforePublished = await getTypedAppSetting("system.banner_published");
      const nextDraft = await setTypedAppSetting("system.banner_draft", body.payload.draft);
      const meta = resolveMeta(body.payload.meta);
      const nextPublished = await setTypedAppSetting("system.banner_published", {
        ...nextDraft,
        publishedAt: meta.performedAt,
      });

      await writeActivityLog({
        action: "system_banner_published",
        metadata: {
          before: {
            draft: beforeDraft,
            published: beforePublished,
          },
          after: nextPublished,
          reason: meta.reason,
          actor_name: meta.performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json(
        {
          systemBannerDraft: nextDraft,
          systemBannerPublished: nextPublished,
        },
        { status: 200 }
      );
    }

    if (body.action === "unpublish_system_banner") {
      const beforePublished = await getTypedAppSetting("system.banner_published");
      const meta = resolveMeta(body.payload?.meta);
      await setTypedAppSetting("system.banner_published", null);

      await writeActivityLog({
        action: "system_banner_unpublished",
        metadata: {
          before: beforePublished,
          after: null,
          reason: meta.reason,
          actor_name: meta.performedBy,
        },
        scope: activityScope,
      });

      return NextResponse.json({ unpublished: true }, { status: 200 });
    }

    return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
  } catch (error) {
    if (isSettingsStoreUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Settings store unavailable.";
      return NextResponse.json({ message }, { status: 503 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to update system administration.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
