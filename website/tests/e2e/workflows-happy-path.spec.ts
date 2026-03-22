import { expect, test, type Page } from "@playwright/test";
import { getPdfPathForProject } from "./helpers/env";
import { resetWorkflowAipFixture } from "./helpers/reset";
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

  test.beforeAll(async ({ request }, testInfo) => {
    workflowAipId = null;
    await resetWorkflowAipFixture({
      request,
      phase: "beforeAll",
      projectName: testInfo.project.name,
    });
  });

  test.afterAll(async ({ request }, testInfo) => {
    await resetWorkflowAipFixture({
      request,
      phase: "afterAll",
      projectName: testInfo.project.name,
      aipId: workflowAipId,
      bestEffort: true,
    });
  });

  test("Barangay -> City -> Citizen -> Admin canonical flow", async ({ browser }, testInfo) => {
    test.setTimeout(PROCESSING_TIMEOUT_MS + 420_000);

    const scenario = loadScenarioForProject(testInfo.project.name);
    const pdfPath = getPdfPathForProject(testInfo.project.name);

    await test.step(
      "1. Barangay upload -> extraction complete -> refresh settles -> validation visible",
      async () => {
        await withRolePage(browser, "barangay", async (page) => {
          await gotoLguPathWithAuth(page, "barangay", "/barangay/aips", {
            landingPath: "/barangay",
          });

          await expect(page.getByTestId("aip-upload-open-button")).toBeVisible();
          await page.getByTestId("aip-upload-open-button").click();
          await page.getByTestId("aip-upload-file-input").setInputFiles(pdfPath);
          await ensureSelectValue(
            page,
            "aip-upload-year-select",
            `aip-upload-year-option-${scenario.aipWorkflow.uploadFiscalYear}`
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
      }
    );

    await test.step("2. Barangay submit AIP to city", async () => {
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

    await test.step("3. City request revision", async () => {
      const aipId = requireWorkflowAipId(workflowAipId);
      await withRolePage(browser, "city", async (page) => {
        await gotoLguPathWithAuth(page, "city", `/city/submissions/aip/${aipId}?mode=review`);
        await ensureClaimedReview(page);

        await page.getByTestId("city-review-note-input").fill(scenario.aipWorkflow.revisionComment);
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

    await test.step("4. Barangay reply to revision and resubmit", async () => {
      const aipId = requireWorkflowAipId(workflowAipId);
      await withRolePage(browser, "barangay", async (page) => {
        await gotoLguPathWithAuth(page, "barangay", `/barangay/aips/${aipId}?tab=comments`);

        await expect(
          page.getByText(scenario.aipWorkflow.revisionComment, { exact: false }).first()
        ).toBeVisible({ timeout: 30_000 });

        await page.getByTestId("aip-revision-reply-input").fill(scenario.aipWorkflow.resubmissionReply);
        await page.getByTestId("aip-save-revision-reply-button").click();
        // await expect(page.getByTestId("aip-workflow-error")).toBeHidden();

        await page.getByTestId("aip-resubmit-button").click();
        await expect(page.getByTestId("aip-status-badge")).toContainText(/pending[_ ]review/i, {
          timeout: 30_000,
        });
      });
    });

    await test.step("5. City approve/publish AIP", async () => {
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

    await test.step(
      "6. Citizen browse published AIP details/projects/budget allocation",
      async () => {
        const aipId = requireWorkflowAipId(workflowAipId);
        await withRolePage(browser, "citizen", async (page) => {
          await page.goto("/", { waitUntil: "domcontentloaded" });
          await page.getByTestId("citizen-nav-aips").click();
          await expect(page).toHaveURL(/\/aips(?:$|[/?#])/);

          const card = page.getByTestId(`citizen-aip-card-${aipId}`);
          await expect(card).toBeVisible({ timeout: 30_000 });
          await card.getByTestId(`citizen-aip-view-details-${aipId}`).click();

          await expect(page).toHaveURL(new RegExp(`/aips/${aipId}(?:$|[/?#])`));
          await expect(page.getByTestId("citizen-aip-overview-card")).toBeVisible();
          await expect(page.getByTestId("citizen-aip-projects-table")).toBeVisible();

          await page.getByTestId("citizen-nav-budget-allocation").click();
          await expect(page).toHaveURL(/\/budget-allocation(?:$|[/?#])/);
          await expect(page.getByTestId("citizen-budget-allocation-overview-header")).toBeVisible();
        });
      }
    );

    await test.step("7. Citizen submit feedback", async () => {
      const aipId = requireWorkflowAipId(workflowAipId);
      await withRolePage(browser, "citizen", async (page) => {
        await page.goto(`/aips/${aipId}?tab=feedback`, {
          waitUntil: "domcontentloaded",
        });

        const feedbackThreads = page.getByTestId("citizen-feedback-thread");
        const initialThreadCount = await feedbackThreads.count();

        await ensureSelectValue(page, "feedback-kind-trigger", "feedback-kind-option-question");
        await page.getByTestId("feedback-message-input").fill(scenario.citizen.feedbackMessage);
        await page.getByTestId("feedback-submit-button").click();

        await expect
          .poll(async () => page.getByTestId("citizen-feedback-thread").count(), {
            timeout: 30_000,
          })
          .toBeGreaterThan(initialThreadCount);
      });
    });

    await test.step("8. Admin change usage controls and verify persisted effect", async () => {
      await withRolePage(browser, "admin", async (page) => {
        await page.goto("/admin/usage-controls?tab=chatbot", { waitUntil: "domcontentloaded" });

        await page
          .getByTestId("admin-chatbot-max-requests-input")
          .fill(String(scenario.admin.usageControls.chatbotMaxRequests));
        await ensureSelectValue(
          page,
          "admin-chatbot-time-window-trigger",
          `admin-chatbot-time-window-option-${scenario.admin.usageControls.chatbotTimeWindow}`
        );

        await page.getByTestId("admin-save-chatbot-rate-limits").click();
        await expect(page.getByTestId("admin-chatbot-rate-limit-saved")).toBeVisible({
          timeout: 20_000,
        });
        await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
          String(scenario.admin.usageControls.chatbotMaxRequests)
        );
        await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
          scenario.admin.usageControls.chatbotTimeWindow === "per_day" ? /per day/i : /per hour/i
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
          String(scenario.admin.usageControls.chatbotMaxRequests),
          { timeout: 20_000 }
        );
        await expect(page.getByTestId("admin-chatbot-current-limit")).toContainText(
          scenario.admin.usageControls.chatbotTimeWindow === "per_day" ? /per day/i : /per hour/i
        );
      });
    });

    await test.step("9. Admin verify audit logs for key actions", async () => {
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
});
