import { expect, test, type Page } from "@playwright/test";
import { getPdfPathForProject } from "./helpers/env";
import { resetWorkflowAipFixture, type E2EChatbotRateLimitInput } from "./helpers/reset";
import { loadScenarioForProject } from "./helpers/scenario";
import { ensureClaimedReview, ensureSelectValue, gotoLguPathWithAuth, withRolePage } from "./helpers/ui";

const PROCESSING_TIMEOUT_MS = 300_000;

type AuditEventAssertion = {
  event: string;
  q?: string;
  rowPattern?: RegExp;
};

function extractBarangayAipIdFromUrl(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/^\/barangay\/aips\/([^/?#]+)\/?$/i);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1]).trim();
  return decoded.length > 0 ? decoded : null;
}

function requireWorkflowAipId(workflowAipId: string | null): string {
  if (!workflowAipId) {
    throw new Error("Workflow AIP ID is missing. Step 1 must complete before later steps.");
  }
  return workflowAipId;
}

function requireScenario(
  scenario: ReturnType<typeof loadScenarioForProject> | null
): ReturnType<typeof loadScenarioForProject> {
  if (!scenario) {
    throw new Error("E2E scenario not loaded. beforeAll must complete before tests.");
  }
  return scenario;
}

function requirePdfPath(pdfPath: string | null): string {
  if (!pdfPath) {
    throw new Error("E2E PDF path not loaded. beforeAll must complete before tests.");
  }
  return pdfPath;
}

function resolveResetChatbotRateLimit(input: {
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
}): E2EChatbotRateLimitInput {
  const baseline: E2EChatbotRateLimitInput = {
    maxRequests: 20,
    timeWindow: "per_hour",
  };

  if (
    baseline.maxRequests === input.maxRequests &&
    baseline.timeWindow === input.timeWindow
  ) {
    return {
      maxRequests: baseline.maxRequests + 1,
      timeWindow: baseline.timeWindow,
    };
  }

  return baseline;
}

async function expectRunQueryCleared(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const current = new URL(page.url());
        return current.searchParams.has("run");
      },
      { timeout: PROCESSING_TIMEOUT_MS }
    )
    .toBe(false);
}

async function expectAuditEvent(page: Page, input: AuditEventAssertion): Promise<void> {
  const params = new URLSearchParams();
  params.set("event", input.event);
  if (input.q) {
    params.set("q", input.q);
  }

  await page.goto(`/admin/audit-logs?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-audit-table")).toBeVisible();

  const firstRow = page.getByTestId("admin-audit-row").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  if (input.rowPattern) {
    await expect(firstRow).toContainText(input.rowPattern);
  }
}

test.describe.serial("Canonical AIP happy path workflow", () => {
  let workflowAipId: string | null = null;
  let scenario: ReturnType<typeof loadScenarioForProject> | null = null;
  let pdfPath: string | null = null;
  let resetChatbotRateLimit: E2EChatbotRateLimitInput | null = null;

  test.beforeAll(async ({ request }, testInfo) => {
    workflowAipId = null;
    scenario = loadScenarioForProject(testInfo.project.name);
    pdfPath = getPdfPathForProject(testInfo.project.name);
    resetChatbotRateLimit = resolveResetChatbotRateLimit({
      maxRequests: scenario.admin.usageControls.chatbotMaxRequests,
      timeWindow: scenario.admin.usageControls.chatbotTimeWindow,
    });

    await resetWorkflowAipFixture({
      request,
      phase: "beforeAll",
      projectName: testInfo.project.name,
      chatbotRateLimit: resetChatbotRateLimit,
    });
  });

  test.afterAll(async ({ request }, testInfo) => {
    await resetWorkflowAipFixture({
      request,
      phase: "afterAll",
      projectName: testInfo.project.name,
      aipId: workflowAipId,
      chatbotRateLimit: resetChatbotRateLimit ?? undefined,
      bestEffort: true,
    });
  });

  test("1. Barangay upload -> extraction complete -> refresh settles -> validation visible", async ({
    browser,
  }) => {
    test.setTimeout(PROCESSING_TIMEOUT_MS + 420_000);
    const scenarioData = requireScenario(scenario);
    const uploadedPdfPath = requirePdfPath(pdfPath);

    await withRolePage(browser, "barangay", async (page) => {
      await gotoLguPathWithAuth(page, "barangay", "/barangay/aips", {
        landingPath: "/barangay",
      });

      const uploadOpenButton = page.locator('[data-testid="aip-upload-open-button"]:visible').first();
      await expect(uploadOpenButton).toBeVisible();
      await uploadOpenButton.click();
      await page.getByTestId("aip-upload-file-input").setInputFiles(uploadedPdfPath);
      await ensureSelectValue(
        page,
        "aip-upload-year-select",
        `aip-upload-year-option-${scenarioData.aipWorkflow.uploadFiscalYear}`
      );
      await page.getByTestId("aip-upload-submit-button").click();

      await expect(page.getByTestId("aip-upload-error")).toBeHidden();
      await expect(page).toHaveURL(/\/barangay\/aips\/[^/?#]+(?:\?[^#]*)?$/, {
        timeout: 60_000,
      });

      const capturedAipId = extractBarangayAipIdFromUrl(page.url());
      if (!capturedAipId) {
        throw new Error(`Unable to extract workflow AIP ID from URL: ${page.url()}`);
      }
      workflowAipId = capturedAipId;

      const inlineStatus = page.getByTestId("aip-processing-inline-status");
      if (await inlineStatus.isVisible().catch(() => false)) {
        await expect(inlineStatus).toBeHidden({ timeout: PROCESSING_TIMEOUT_MS });
      }

      await expect(page.getByTestId("aip-details-table-card")).toBeVisible({
        timeout: PROCESSING_TIMEOUT_MS,
      });
      await expect(page.getByTestId("aip-details-table")).toBeVisible();
      await expectRunQueryCleared(page);
      await expect(page.getByTestId("aip-status-badge")).toContainText(/draft/i);
    });
  });

  test("2. Barangay submit AIP to city", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    await withRolePage(browser, "barangay", async (page) => {
      await gotoLguPathWithAuth(page, "barangay", `/barangay/aips/${aipId}`);
      await expect(page.getByTestId("aip-submit-review-button")).toBeVisible();
      await page.getByTestId("aip-submit-review-button").click();

      await expect(page.getByTestId("aip-status-badge")).toContainText(/pending[_ ]review/i, {
        timeout: 30_000,
      });
    });
  });

  test("3. City request revision", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    const scenarioData = requireScenario(scenario);

    await withRolePage(browser, "city", async (page) => {
      await gotoLguPathWithAuth(page, "city", `/city/submissions/aip/${aipId}?mode=review`);
      await ensureClaimedReview(page);

      await page.getByTestId("city-review-note-input").fill(scenarioData.aipWorkflow.revisionComment);
      await page.getByTestId("city-request-revision-button").click();
      await page.getByTestId("city-request-revision-confirm-button").click();

      await expect(page.getByTestId("city-submission-status-badge")).toContainText(
        /for revision/i,
        {
          timeout: 30_000,
        }
      );
    });
  });

  test("4. Barangay sees revision note, replies, and resubmits", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    const scenarioData = requireScenario(scenario);

    await withRolePage(browser, "barangay", async (page) => {
      await gotoLguPathWithAuth(page, "barangay", `/barangay/aips/${aipId}`);
      await expect(page.getByTestId("aip-details-table")).toBeVisible({ timeout: 30_000 });

      await expect(
        page.getByText(scenarioData.aipWorkflow.revisionComment, { exact: false }).first()
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("aip-revision-reply-input").fill(scenarioData.aipWorkflow.resubmissionReply);
      await page.getByTestId("aip-save-revision-reply-button").click();
      await expect(page.getByTestId("aip-workflow-success")).toBeVisible({ timeout: 30_000 });

      await expect(page.getByTestId("aip-resubmit-button")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("aip-resubmit-button").click();
      await expect(page.getByTestId("aip-status-badge")).toContainText(/pending[_ ]review/i, {
        timeout: 30_000,
      });
    });
  });

  test("5. City approve/publish AIP", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    await withRolePage(browser, "city", async (page) => {
      await gotoLguPathWithAuth(page, "city", `/city/submissions/aip/${aipId}?mode=review`);
      await ensureClaimedReview(page);

      await page.getByTestId("city-publish-aip-button").click();
      await page.getByTestId("city-publish-confirm-button").click();
      await expect(page.getByTestId("city-publish-success-card")).toBeVisible({
        timeout: 30_000,
      });
    });
  });

  test("6. Citizen browse published AIP details/projects/budget allocation", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    await withRolePage(browser, "citizen", async (page) => {
      await page.goto("/aips", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/aips(?:$|[/?#])/);

      const card = page.getByTestId(`citizen-aip-card-${aipId}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByTestId(`citizen-aip-view-details-${aipId}`).click();

      await expect(page).toHaveURL(new RegExp(`/aips/${aipId}(?:$|[/?#])`));
      await expect(page.getByTestId("citizen-aip-overview-card")).toBeVisible();
      await expect(page.getByTestId("citizen-aip-projects-table")).toBeVisible();

      await page.goto("/budget-allocation", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/budget-allocation(?:$|[/?#])/);
      await expect(page.getByTestId("citizen-budget-allocation-overview-header")).toBeVisible();
    });
  });

  test("7. Citizen submit feedback", async ({ browser }) => {
    const aipId = requireWorkflowAipId(workflowAipId);
    const scenarioData = requireScenario(scenario);

    await withRolePage(browser, "citizen", async (page) => {
      await page.goto(`/aips/${aipId}?tab=feedback`, {
        waitUntil: "domcontentloaded",
      });

      await expect
        .poll(
          async () => {
            const threadCount = await page.getByTestId("citizen-feedback-thread").count();
            const emptyStateCount = await page
              .getByText("No citizen feedback yet. Be the first to share a commendation, suggestion, concern, or question.")
              .count();
            return threadCount + emptyStateCount;
          },
          { timeout: 30_000 }
        )
        .toBeGreaterThan(0);

      const feedbackThreads = page.getByTestId("citizen-feedback-thread");
      const initialThreadCount = await feedbackThreads.count();
      const feedbackMessage = `${scenarioData.citizen.feedbackMessage} [e2e-${Date.now()}]`;

      await ensureSelectValue(page, "feedback-kind-trigger", "feedback-kind-option-question");
      await page.getByTestId("feedback-message-input").fill(feedbackMessage);
      await page.getByTestId("feedback-submit-button").click();

      await expect(page.getByTestId("feedback-message-input")).toHaveValue("", {
        timeout: 30_000,
      });
      await expect(page.getByText(feedbackMessage, { exact: false }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () => page.getByTestId("citizen-feedback-thread").count(), {
          timeout: 30_000,
        })
        .toBeGreaterThan(initialThreadCount);
    });
  });

  test("8. Admin change usage controls and verify persisted effect", async ({ browser }) => {
    const scenarioData = requireScenario(scenario);
    await withRolePage(browser, "admin", async (page) => {
      await page.goto("/admin/usage-controls?tab=chatbot", { waitUntil: "domcontentloaded" });

      await page
        .getByTestId("admin-chatbot-max-requests-input")
        .fill(String(scenarioData.admin.usageControls.chatbotMaxRequests));
      await ensureSelectValue(
        page,
        "admin-chatbot-time-window-trigger",
        `admin-chatbot-time-window-option-${scenarioData.admin.usageControls.chatbotTimeWindow}`
      );

      await page.getByTestId("admin-save-chatbot-rate-limits").click();

      await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
        String(scenarioData.admin.usageControls.chatbotMaxRequests)
      );
      await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
        scenarioData.admin.usageControls.chatbotTimeWindow === "per_day" ? /per day/i : /per hour/i
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
        String(scenarioData.admin.usageControls.chatbotMaxRequests),
        { timeout: 20_000 }
      );
      await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
        scenarioData.admin.usageControls.chatbotTimeWindow === "per_day" ? /per day/i : /per hour/i
      );
    });
  });

  test("9. Admin verify audit logs for key actions", async ({ browser }) => {
    await withRolePage(browser, "admin", async (page) => {
      await expectAuditEvent(page, {
        event: "aip_review_record_created",
        q: "request_revision",
        rowPattern: /AIP Review Record Created/i,
      });
      await expectAuditEvent(page, {
        event: "aip_updated",
        q: "published",
        rowPattern: /AIP Record Updated/i,
      });
      await expectAuditEvent(page, {
        event: "feedback_created",
        rowPattern: /Feedback Created/i,
      });
      await expectAuditEvent(page, {
        event: "chatbot_rate_limit_updated",
        rowPattern: /Chatbot Rate Limit Updated/i,
      });
    });
  });
});
