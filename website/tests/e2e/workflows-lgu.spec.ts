import { expect, test } from "@playwright/test";
import { getPdfPathForProject } from "./helpers/env";
import { loadScenarioForProject } from "./helpers/scenario";
import { ensureClaimedReview, ensureSelectValue, gotoLguPathWithAuth, withRolePage } from "./helpers/ui";

const PROCESSING_TIMEOUT_MS = 300_000;

test.describe.serial("LGU AIP workflows", () => {
  test("1. Barangay upload AIP -> extraction completes -> validation displayed", async ({ browser }, testInfo) => {
    test.setTimeout(PROCESSING_TIMEOUT_MS + 120_000);
    const scenario = loadScenarioForProject(testInfo.project.name);
    const pdfPath = getPdfPathForProject(testInfo.project.name);

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
      await expect(page).toHaveURL(/\/barangay\/aips\/[^/?#]+/, { timeout: 60_000 });

      const inlineStatus = page.getByTestId("aip-processing-inline-status");
      if (await inlineStatus.isVisible().catch(() => false)) {
        await expect(inlineStatus).toBeHidden({ timeout: PROCESSING_TIMEOUT_MS });
      }

      await expect(page.getByTestId("aip-details-table-card")).toBeVisible({
        timeout: PROCESSING_TIMEOUT_MS,
      });
      await expect(page.getByTestId("aip-status-badge")).toBeVisible();
    });
  });

  test("2. Barangay fix/resubmit -> submit to city", async ({ browser }, testInfo) => {
    const scenario = loadScenarioForProject(testInfo.project.name);

    await withRolePage(browser, "barangay", async (page) => {
      await gotoLguPathWithAuth(page, "barangay", `/barangay/aips/${scenario.aipWorkflow.submissionAipId}`);

      const submitForReviewButton = page.getByTestId("aip-submit-review-button");
      const resubmitButton = page.getByTestId("aip-resubmit-button");

      if (await submitForReviewButton.isVisible().catch(() => false)) {
        await submitForReviewButton.click();
      } else if (await resubmitButton.isVisible().catch(() => false)) {
        await page.getByTestId("aip-revision-reply-input").fill(scenario.aipWorkflow.resubmissionReply);
        await page.getByTestId("aip-save-revision-reply-button").click();
        await resubmitButton.click();
      } else {
        throw new Error("Expected submit or resubmit action to be available for workflow 2.");
      }

      await expect(page.getByTestId("aip-status-badge")).toContainText(/pending review/i, {
        timeout: 30_000,
      });
    });
  });

  test("3. City view barangay submissions -> request revision", async ({ browser }, testInfo) => {
    const scenario = loadScenarioForProject(testInfo.project.name);

    await withRolePage(browser, "city", async (page) => {
      await gotoLguPathWithAuth(
        page,
        "city",
        `/city/submissions/aip/${scenario.aipWorkflow.submissionAipId}?mode=review`
      );

      await ensureClaimedReview(page);
      await page.getByTestId("city-review-note-input").fill(scenario.aipWorkflow.revisionComment);
      await page.getByTestId("city-request-revision-button").click();
      await page.getByTestId("city-request-revision-confirm-button").click();

      await expect(page.getByTestId("city-submission-status-badge")).toContainText(/for revision/i, {
        timeout: 30_000,
      });
    });
  });

  test("4. Barangay resubmit revised AIP", async ({ browser }, testInfo) => {
    const scenario = loadScenarioForProject(testInfo.project.name);

    await withRolePage(browser, "barangay", async (page) => {
      await gotoLguPathWithAuth(page, "barangay", `/barangay/aips/${scenario.aipWorkflow.submissionAipId}`);

      await page.getByTestId("aip-revision-reply-input").fill(scenario.aipWorkflow.resubmissionReply);
      await page.getByTestId("aip-save-revision-reply-button").click();
      await page.getByTestId("aip-resubmit-button").click();

      await expect(page.getByTestId("aip-status-badge")).toContainText(/pending review/i, {
        timeout: 30_000,
      });
    });
  });

  test("5. City approve/publish AIP", async ({ browser }, testInfo) => {
    const scenario = loadScenarioForProject(testInfo.project.name);

    await withRolePage(browser, "city", async (page) => {
      await gotoLguPathWithAuth(
        page,
        "city",
        `/city/submissions/aip/${scenario.aipWorkflow.submissionAipId}?mode=review`
      );

      await ensureClaimedReview(page);
      await page.getByTestId("city-publish-aip-button").click();
      await page.getByTestId("city-publish-confirm-button").click();

      await expect(page.getByTestId("city-publish-success-card")).toBeVisible({
        timeout: 30_000,
      });
    });
  });
});
