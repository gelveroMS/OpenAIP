import { describe, expect, it } from "vitest";
import { mapEvidenceFromCitations } from "./chat-message-presenter";

describe("mapEvidenceFromCitations", () => {
  it("builds citizen project evidence links and labels from enriched citations", () => {
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
      linkLabel: "Mamatid FY 2025 Health Station Upgrade",
    });
  });

  it("builds citizen AIP totals evidence link and label from enriched totals citations", () => {
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
      linkLabel: "Mamatid FY 2025 AIP",
    });
  });

  it("keeps totals evidence unresolved when required AIP label inputs are missing", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S3",
        snippet: "Computed from published AIP line-item totals.",
        aipId: "aip-2",
        metadata: {
          type: "aip_line_items",
          aggregate_type: "total_investment_program",
        },
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      href: null,
      linkLabel: null,
      snippet: "Computed from published AIP line-item totals.",
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
        snippet: "Road concreting line item evidence.",
        scopeType: "barangay",
        scopeName: "Mamatid",
      },
    ]);

    expect(evidence).toHaveLength(2);
    expect(evidence.some((item) => item.snippet === "Road concreting line item evidence.")).toBe(true);
  });
});
