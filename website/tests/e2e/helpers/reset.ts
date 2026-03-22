import type { APIRequestContext } from "@playwright/test";
import {
  getE2EBaseUrl,
  getE2EResetEndpoint,
  getE2EResetToken,
  isE2EAipResetEnabled,
} from "./env";

type ResetPhase = "beforeAll" | "afterAll";

type ResetResponse = {
  ok?: boolean;
  deleted?: boolean;
  aipId?: string | null;
  statusBefore?: string | null;
  storageDeleted?: Array<{ bucket: string; count: number }>;
  error?: string;
};

type ResetWorkflowAipFixtureOptions = {
  request: APIRequestContext;
  phase: ResetPhase;
  projectName: string;
  aipId?: string | null;
  bestEffort?: boolean;
};

function normalizeAipId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toAbsoluteEndpoint(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const baseUrl = getE2EBaseUrl().replace(/\/+$/, "");
  const normalizedPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseUrl}${normalizedPath}`;
}

function parseJsonPayload(raw: string): ResetResponse | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as ResetResponse;
  } catch {
    return null;
  }
}

export async function resetWorkflowAipFixture(
  options: ResetWorkflowAipFixtureOptions
): Promise<void> {
  if (!isE2EAipResetEnabled()) {
    return;
  }

  const token = getE2EResetToken();
  if (!token) {
    const message = "E2E reset is enabled but E2E_AIP_RESET_TOKEN is missing.";
    if (options.bestEffort) {
      console.error(`[e2e-reset] ${options.phase} skipped: ${message}`);
      return;
    }
    throw new Error(message);
  }

  const endpoint = toAbsoluteEndpoint(getE2EResetEndpoint());
  const aipId = normalizeAipId(options.aipId);
  const body = aipId ? { aipId } : {};

  try {
    const response = await options.request.post(endpoint, {
      headers: {
        "content-type": "application/json",
        "x-e2e-reset-token": token,
      },
      data: body,
      timeout: 60_000,
    });

    const rawBody = await response.text();
    const payload = parseJsonPayload(rawBody);

    if (!response.ok) {
      throw new Error(
        `Reset endpoint failed (${response.status()}): ${(payload?.error ?? rawBody) || "Unknown error."}`
      );
    }

    if (!payload?.ok) {
      throw new Error(payload?.error ?? "Reset endpoint returned ok=false.");
    }

    console.info(
      `[e2e-reset] ${options.phase} project=${options.projectName} deleted=${payload.deleted === true} aipId=${payload.aipId ?? "none"}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unexpected reset error: ${String(error)}`;
    if (options.bestEffort) {
      console.error(
        `[e2e-reset] ${options.phase} project=${options.projectName} failed: ${message}`
      );
      return;
    }
    throw error;
  }
}
