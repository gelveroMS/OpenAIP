import { describe, expect, it } from "vitest";
import { createMockCitizenAipRepo } from "@/lib/repos/citizen-aips/repo.mock";

describe("CitizenAipRepo mock adapter", () => {
  it("lists only published AIPs", async () => {
    const repo = createMockCitizenAipRepo();
    const rows = await repo.listPublishedAips();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("returns null for unpublished AIP detail", async () => {
    const repo = createMockCitizenAipRepo();
    const detail = await repo.getPublishedAipDetail("aip-2026-santamaria-draft");

    expect(detail).toBeNull();
  });

  it("returns null for project detail not belonging to a published AIP", async () => {
    const repo = createMockCitizenAipRepo();
    const detail = await repo.getPublishedAipProjectDetail({
      aipId: "aip-2026-santamaria-draft",
      projectId: "aip-item-2026-santamaria-001",
    });

    expect(detail).toBeNull();
  });

  it("includes accountability uploader/approver identities and dates for published details", async () => {
    const repo = createMockCitizenAipRepo();
    const detail = await repo.getPublishedAipDetail("aip-2025-city");

    expect(detail).not.toBeNull();
    expect(detail?.accountability.uploadedBy?.name).toBe("Engineer Roberto Cruz");
    expect(detail?.accountability.approvedBy?.name).toBe("Jose Ramirez");
    expect(detail?.accountability.uploadDate).toBe("2025-01-08");
    expect(detail?.accountability.approvalDate).toBe("2025-02-15");
  });

  it("includes row-level LGU note marker and project AI issues array shape", async () => {
    const repo = createMockCitizenAipRepo();
    const detail = await repo.getPublishedAipDetail("aip-2025-city");
    const projectDetail = await repo.getPublishedAipProjectDetail({
      aipId: "aip-2025-city",
      projectId: "aiprow-040",
    });

    expect(detail).not.toBeNull();
    expect(detail?.projectRows.length).toBeGreaterThan(0);
    expect(
      detail?.projectRows.every((row) => typeof row.hasLguNote === "boolean")
    ).toBe(true);

    expect(projectDetail).not.toBeNull();
    expect(Array.isArray(projectDetail?.aiIssues)).toBe(true);
  });

  it("includes city/barangay scope metadata for filter hierarchy", async () => {
    const repo = createMockCitizenAipRepo();
    const rows = await repo.listPublishedAips();

    const cityRow = rows.find((row) => row.scopeType === "city");
    const barangayRow = rows.find((row) => row.scopeType === "barangay");

    expect(cityRow?.cityScopeId).toBeTruthy();
    expect(cityRow?.cityScopeLabel).toBeTruthy();
    expect(cityRow?.barangayScopeId ?? null).toBeNull();

    expect(barangayRow?.cityScopeId).toBeTruthy();
    expect(barangayRow?.cityScopeLabel).toBeTruthy();
    expect(barangayRow?.barangayScopeId).toBeTruthy();
    expect(barangayRow?.barangayScopeLabel).toBeTruthy();
  });
});
