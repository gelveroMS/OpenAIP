import { describe, expect, it } from "vitest";
import { mapEvidenceFromCitations } from "./chat-message-presenter";

describe("mapEvidenceFromCitations", () => {
  it("builds project evidence line in the standardized format", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S1",
        snippet: "Fallback snippet",
        aipId: "aip-1",
        projectId: "project-1",
        lguName: "Mamatid",
        resolvedFiscalYear: 2025,
        projectTitle: "Health Station Upgrade",
        documentLabel: "Published AIP",
        metadata: {
          type: "aip_totals",
        },
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      href: "/aips/aip-1/project-1",
      displayLine: "[S1] Mamatid FY 2025 Health Station Upgrade",
    });
  });

  it("builds totals evidence line with AIP label", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S2",
        snippet: "Total investment program value from structured totals table.",
        aipId: "aip-1",
        lguName: "Mamatid",
        resolvedFiscalYear: 2025,
        metadata: {
          type: "aip_totals",
        },
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      href: "/aips/aip-1",
      displayLine: "[S2] Mamatid FY 2025 AIP",
    });
  });

  it("uses placeholders when LGU, fiscal year, and program are missing", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S3",
        snippet: "Missing key labels.",
        scopeType: "barangay",
        scopeName: "Unknown scope",
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      href: null,
      displayLine: "[S3] Unknown LGU FY Unknown FY Unknown Program",
    });
  });

  it("filters out evidence when citations are system-only", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S4",
        snippet: "Pipeline request failed.",
        scopeType: "system",
        scopeName: "System",
      },
    ]);

    expect(evidence).toEqual([]);
  });

  it("keeps evidence renderable when citations are mixed system and non-system", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S0",
        snippet: "No retrieval citations were produced for this response.",
        scopeType: "system",
        scopeName: "System",
        insufficient: true,
      },
      {
        sourceId: "S5",
        snippet: "Road line item evidence.",
        scopeType: "barangay",
        lguName: "Mamatid",
        fiscalYear: 2026,
        projectTitle: "Road Concreting",
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      displayLine: "[S5] Mamatid FY 2026 Road Concreting",
    });
  });
});
