import { NextResponse } from "next/server";
import { getAppEnv } from "@/lib/config/appEnv";
import { deleteAipRootWithStorageCleanup } from "@/lib/repos/aip/delete-root.server";
import { setTypedAppSetting } from "@/lib/settings/app-settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ResetAipBody = {
  aipId?: string;
  chatbotRateLimit?: {
    maxRequests?: unknown;
    timeWindow?: unknown;
  };
};

type FixtureAipRow = {
  id: string;
  status: string;
};

type ChatbotRateLimitPayload = {
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
};

const RESET_TOKEN_HEADER = "x-e2e-reset-token";
const REQUIRED_ENV = {
  enabled: "E2E_AIP_RESET_ENABLED",
  token: "E2E_AIP_RESET_TOKEN",
  barangayId: "E2E_AIP_RESET_BARANGAY_ID",
  fiscalYear: "E2E_AIP_RESET_FISCAL_YEAR",
} as const;

export const runtime = "nodejs";

function normalizeEnvValue(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isResetEnabled(): boolean {
  return normalizeEnvValue(REQUIRED_ENV.enabled)?.toLowerCase() === "true";
}

function parseFixtureFiscalYear(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 2000 || parsed > 3000) return null;
  return parsed;
}

function notFound() {
  return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function parseRequestedAipId(body: ResetAipBody): string | null {
  if (typeof body.aipId !== "string") return null;
  const trimmed = body.aipId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function misconfigured(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

function conflict(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 409 });
}

function parseRequestedChatbotRateLimit(body: ResetAipBody): {
  value: ChatbotRateLimitPayload | null;
  error: string | null;
} {
  const raw = body.chatbotRateLimit;
  if (typeof raw === "undefined") {
    return { value: null, error: null };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: null, error: "chatbotRateLimit must be an object." };
  }

  const maxRequestsRaw = (raw as { maxRequests?: unknown }).maxRequests;
  const maxRequests =
    typeof maxRequestsRaw === "number" ? Math.floor(maxRequestsRaw) : Number.NaN;
  if (!Number.isFinite(maxRequests) || maxRequests < 1 || maxRequests > 10_000) {
    return {
      value: null,
      error: "chatbotRateLimit.maxRequests must be an integer between 1 and 10000.",
    };
  }

  const timeWindowRaw = (raw as { timeWindow?: unknown }).timeWindow;
  if (timeWindowRaw !== "per_hour" && timeWindowRaw !== "per_day") {
    return {
      value: null,
      error: "chatbotRateLimit.timeWindow must be per_hour or per_day.",
    };
  }

  return {
    value: {
      maxRequests,
      timeWindow: timeWindowRaw,
    },
    error: null,
  };
}

export async function POST(request: Request) {
  if (getAppEnv() !== "staging") {
    return notFound();
  }

  if (!isResetEnabled()) {
    return notFound();
  }

  const configuredToken = normalizeEnvValue(REQUIRED_ENV.token);
  if (!configuredToken) {
    return misconfigured(`${REQUIRED_ENV.token} must be configured when reset is enabled.`);
  }

  const headerToken = request.headers.get(RESET_TOKEN_HEADER)?.trim() ?? "";
  if (!headerToken || headerToken !== configuredToken) {
    return unauthorized();
  }

  const fixtureBarangayId = normalizeEnvValue(REQUIRED_ENV.barangayId);
  if (!fixtureBarangayId) {
    return misconfigured(`${REQUIRED_ENV.barangayId} must be configured.`);
  }

  const fixtureFiscalYear = parseFixtureFiscalYear(
    normalizeEnvValue(REQUIRED_ENV.fiscalYear)
  );
  if (!fixtureFiscalYear) {
    return misconfigured(`${REQUIRED_ENV.fiscalYear} must be a valid year.`);
  }

  let body: ResetAipBody = {};
  try {
    body = (await request.json()) as ResetAipBody;
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const requestedAipId = parseRequestedAipId(body);
  const requestedChatbotRateLimit = parseRequestedChatbotRateLimit(body);
  if (requestedChatbotRateLimit.error) {
    return badRequest(requestedChatbotRateLimit.error);
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("aips")
    .select("id,status")
    .eq("barangay_id", fixtureBarangayId)
    .eq("fiscal_year", fixtureFiscalYear)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to resolve fixture AIP: ${error.message}`,
      },
      { status: 500 }
    );
  }

  const fixtureAip = (data ?? null) as FixtureAipRow | null;
  if (fixtureAip && requestedAipId && requestedAipId !== fixtureAip.id) {
    return conflict("Requested aipId does not match the configured fixture scope.");
  }

  let appliedChatbotRateLimit: ChatbotRateLimitPayload | null = null;
  if (requestedChatbotRateLimit.value) {
    const now = new Date().toISOString();
    try {
      const next = await setTypedAppSetting("controls.chatbot_rate_limit", {
        maxRequests: requestedChatbotRateLimit.value.maxRequests,
        timeWindow: requestedChatbotRateLimit.value.timeWindow,
        updatedAt: now,
        updatedBy: "e2e-reset",
      });
      appliedChatbotRateLimit = {
        maxRequests: next.maxRequests,
        timeWindow: next.timeWindow,
      };
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to update chatbot rate limit during reset.",
        },
        { status: 500 }
      );
    }
  }

  if (!fixtureAip) {
    return NextResponse.json(
      {
        ok: true,
        deleted: false,
        aipId: null,
        statusBefore: null,
        storageDeleted: [],
        chatbotRateLimit: appliedChatbotRateLimit,
      },
      { status: 200 }
    );
  }

  try {
    const deletion = await deleteAipRootWithStorageCleanup({
      aipId: fixtureAip.id,
      admin,
    });

    return NextResponse.json(
      {
        ok: true,
        deleted: true,
        aipId: fixtureAip.id,
        statusBefore: fixtureAip.status,
        storageDeleted: deletion.storageDeleted,
        chatbotRateLimit: appliedChatbotRateLimit,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Fixture reset failed.",
      },
      { status: 500 }
    );
  }
}
