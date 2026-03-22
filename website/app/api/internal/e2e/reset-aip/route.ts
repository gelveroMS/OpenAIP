import { NextResponse } from "next/server";
import { getAppEnv } from "@/lib/config/appEnv";
import { deleteAipRootWithStorageCleanup } from "@/lib/repos/aip/delete-root.server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ResetAipBody = {
  aipId?: string;
};

type FixtureAipRow = {
  id: string;
  status: string;
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
  if (!fixtureAip) {
    return NextResponse.json(
      {
        ok: true,
        deleted: false,
        aipId: null,
        statusBefore: null,
        storageDeleted: [],
      },
      { status: 200 }
    );
  }

  if (requestedAipId && requestedAipId !== fixtureAip.id) {
    return conflict("Requested aipId does not match the configured fixture scope.");
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
