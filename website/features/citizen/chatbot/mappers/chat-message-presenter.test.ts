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
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      href: "/aips/aip-1/project-1",
      linkLabel: "Mamatid FY 2025 Health Station Upgrade",
    });
  });

  it("keeps unresolved evidence as plain-text entry metadata", () => {
    const evidence = mapEvidenceFromCitations([
      {
        sourceId: "S2",
        snippet: "Pipeline request failed.",
        scopeType: "system",
        scopeName: "System",
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      snippet: "Pipeline request failed.",
      href: null,
      linkLabel: null,
    });
  });
});
