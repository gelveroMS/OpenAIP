import { expect, type APIResponse, type Browser, type Page } from "@playwright/test";
import { getE2EBaseUrl, getStorageStatePath, type RoleKey } from "./env";
import { loginAsRole } from "./auth";

type LguRole = "barangay" | "city";

type GotoLguPathWithAuthOptions = {
  landingPath?: string;
};

const LGU_SIDEBAR_TEST_ID: Record<LguRole, string> = {
  barangay: "barangay-sidebar",
  city: "city-sidebar",
};

function signInPathPattern(role: LguRole): RegExp {
  return new RegExp(`/${role}/sign-in(?:$|[/?#])`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStatusMessage(payload: Record<string, unknown> | null, rawBody: string): string {
  const payloadMessage =
    asStringOrNull(payload?.message) ??
    asStringOrNull(payload?.error) ??
    asStringOrNull(payload?.errorMessage);
  return payloadMessage ?? (rawBody.trim() || "No response body.");
}

async function parseResponseBody(
  response: APIResponse
): Promise<{ payload: Record<string, unknown> | null; rawBody: string }> {
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return { payload: null, rawBody };
  }

  try {
    const parsed: unknown = JSON.parse(rawBody);
    return { payload: asRecord(parsed), rawBody };
  } catch {
    return { payload: null, rawBody };
  }
}

export type WaitForRunSettledInput = {
  page: Page;
  role: LguRole;
  aipId: string;
  runId?: string | null;
  timeoutMs: number;
  pollIntervalMs?: number;
};

export async function waitForRunSettled(input: WaitForRunSettledInput): Promise<void> {
  const aipId = input.aipId.trim();
  if (!aipId) {
    throw new Error("waitForRunSettled requires a non-empty aipId.");
  }

  const runId = asStringOrNull(input.runId) ?? null;
  const pollIntervalMs = input.pollIntervalMs ?? 1_500;
  const timeoutMs = input.timeoutMs;
  const deadline = Date.now() + timeoutMs;
  let lastTransientError: string | null = null;

  while (Date.now() < deadline) {
    if (runId) {
      const runStatusPath = `/api/${input.role}/aips/runs/${encodeURIComponent(runId)}`;
      const runStatusResponse = await input.page.request.get(runStatusPath);
      const { payload, rawBody } = await parseResponseBody(runStatusResponse);

      if (!runStatusResponse.ok()) {
        lastTransientError =
          `GET ${runStatusPath} -> ${runStatusResponse.status()} ${runStatusResponse.statusText()} ` +
          `(${toStatusMessage(payload, rawBody)})`;
        await input.page.waitForTimeout(pollIntervalMs);
        continue;
      }

      const status = asStringOrNull(payload?.status);
      const stage = asStringOrNull(payload?.stage) ?? "unknown";
      const errorMessage = asStringOrNull(payload?.errorMessage);

      if (status === "queued" || status === "running") {
        await input.page.waitForTimeout(pollIntervalMs);
        continue;
      }

      if (status === "succeeded") {
        return;
      }

      if (status === "failed") {
        throw new Error(
          `Extraction run ${runId} failed at stage "${stage}": ${errorMessage ?? "No error message provided."}`
        );
      }

      lastTransientError = `Unexpected run status "${status ?? "unknown"}" for run ${runId}.`;
      await input.page.waitForTimeout(pollIntervalMs);
      continue;
    }

    const activeRunPath = `/api/${input.role}/aips/${encodeURIComponent(aipId)}/runs/active`;
    const activeRunResponse = await input.page.request.get(activeRunPath);
    const { payload, rawBody } = await parseResponseBody(activeRunResponse);

    if (!activeRunResponse.ok()) {
      lastTransientError =
        `GET ${activeRunPath} -> ${activeRunResponse.status()} ${activeRunResponse.statusText()} ` +
        `(${toStatusMessage(payload, rawBody)})`;
      await input.page.waitForTimeout(pollIntervalMs);
      continue;
    }

    const failedRun = asRecord(payload?.failedRun);
    if (failedRun) {
      const failedRunId = asStringOrNull(failedRun.runId) ?? "unknown";
      const failedStage = asStringOrNull(failedRun.stage) ?? "unknown";
      const failedMessage = asStringOrNull(failedRun.errorMessage);
      throw new Error(
        `Extraction run ${failedRunId} failed at stage "${failedStage}": ${failedMessage ?? "No error message provided."}`
      );
    }

    const activeRun = asRecord(payload?.run);
    if (activeRun) {
      await input.page.waitForTimeout(pollIntervalMs);
      continue;
    }

    return;
  }

  const timeoutDetails = lastTransientError
    ? ` Last transient response: ${lastTransientError}`
    : "";
  throw new Error(
    `Timed out waiting for extraction run settlement after ${timeoutMs}ms for AIP ${aipId}.${timeoutDetails}`
  );
}

async function assertLguAuthenticated(page: Page, role: LguRole): Promise<void> {
  await expect(page).not.toHaveURL(signInPathPattern(role), { timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/${role}(?:$|[/?#])`), { timeout: 30_000 });

  // On mobile layouts the sidebar can be hidden/collapsed.
  // Treat a visible sidebar as additional confirmation, but do not require it.
  const sidebar = page.getByTestId(LGU_SIDEBAR_TEST_ID[role]).first();
  const sidebarVisible = await sidebar.isVisible().catch(() => false);
  if (sidebarVisible) {
    await expect(sidebar).toBeVisible({ timeout: 30_000 });
  }
}

export async function withRolePage<T>(
  browser: Browser,
  role: RoleKey,
  task: (page: Page) => Promise<T>
): Promise<T> {
  const context = await browser.newContext({
    baseURL: getE2EBaseUrl(),
    storageState: getStorageStatePath(role),
  });

  const page = await context.newPage();
  try {
    return await task(page);
  } finally {
    await context.close();
  }
}

export async function ensureClaimedReview(page: Page): Promise<void> {
  const claimButton = page.getByTestId("city-claim-review-button");
  if (await claimButton.isVisible().catch(() => false)) {
    await claimButton.click();
    await expect(claimButton).toBeHidden({ timeout: 20_000 });
  }
}

export async function ensureSelectValue(
  page: Page,
  triggerTestId: string,
  optionTestId: string
): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByTestId(optionTestId).click();
}

export async function gotoLguPathWithAuth(
  page: Page,
  role: LguRole,
  targetPath: string,
  options: GotoLguPathWithAuthOptions = {}
): Promise<void> {
  const landingPath = options.landingPath ?? targetPath;

  await page.goto(landingPath, { waitUntil: "domcontentloaded" });

  const redirectedToSignIn = signInPathPattern(role).test(page.url());
  if (redirectedToSignIn) {
    await loginAsRole(page, role);
  }

  if (landingPath !== targetPath || redirectedToSignIn) {
    await page.goto(targetPath, { waitUntil: "domcontentloaded" });
  }

  await assertLguAuthenticated(page, role);
}
