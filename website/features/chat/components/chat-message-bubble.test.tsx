import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatMessageBubble from "./ChatMessageBubble";

describe("ChatMessageBubble", () => {
  function expandEvidence() {
    fireEvent.click(screen.getByTestId("chat-evidence-summary"));
  }

  it("renders one-line evidence entries and removes match-metric labels", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-1",
          role: "assistant",
          content: "Sample response",
          timeLabel: "10:00 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "L1",
              scopeName: "Barangay Mamatid - FY 2026 - Honoraria",
              scopeType: "barangay",
              fiscalYear: 2026,
              snippet: "Snippet A",
              distance: 0.23456,
            },
            {
              sourceId: "L2",
              scopeName: "Barangay Mamatid - FY 2026 - Road",
              scopeType: "barangay",
              fiscalYear: 2026,
              snippet: "Snippet B",
              matchScore: 0.75,
            },
            {
              sourceId: "L3",
              scopeName: "Barangay Mamatid - FY 2026 - Legacy",
              scopeType: "barangay",
              fiscalYear: 2026,
              snippet: "Snippet C",
              similarity: 0.64,
            },
          ],
        }}
      />
    );

    expandEvidence();
    expect(
      screen.getByText("[L1] Barangay Mamatid - FY 2026 - Honoraria FY 2026 Unknown Program")
    ).toBeInTheDocument();
    expect(screen.queryByText("DIST 0.235")).not.toBeInTheDocument();
    expect(screen.queryByText("MATCH 75%")).not.toBeInTheDocument();
    expect(screen.queryByText("MATCH 64%")).not.toBeInTheDocument();
  });

  it("renders assistant evidence in a collapsed details container by default", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-evidence-collapsed",
          role: "assistant",
          content: "Sample response",
          timeLabel: "10:00 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "L1",
              scopeName: "Barangay Mamatid - FY 2026 - Honoraria",
              scopeType: "barangay",
              fiscalYear: 2026,
              snippet: "Snippet A",
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId("chat-evidence-summary")).toHaveTextContent("Evidence (1)");
    expect(screen.getByTestId("chat-evidence-details")).not.toHaveAttribute("open");
  });

  it("shows clarification badge without grounded refusal text", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-clarification",
          role: "assistant",
          content: "Which one did you mean?",
          timeLabel: "10:01 AM",
          deliveryStatus: "sent",
          retrievalMeta: {
            refused: false,
            reason: "clarification_needed",
            status: "clarification",
          },
          citations: [
            {
              sourceId: "S0",
              scopeName: "System",
              scopeType: "system",
              snippet: "Clarification required",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Clarification needed.")).toBeInTheDocument();
    expect(screen.queryByText(/Grounded refusal/i)).not.toBeInTheDocument();
  });

  it("shows grounded refusal badge for refusal messages", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-refusal",
          role: "assistant",
          content: "I cannot answer right now.",
          timeLabel: "10:02 AM",
          deliveryStatus: "sent",
          retrievalMeta: {
            refused: true,
            reason: "insufficient_evidence",
          },
          citations: [
            {
              sourceId: "S0",
              scopeName: "System",
              scopeType: "system",
              snippet: "Insufficient evidence",
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/Grounded refusal/i)).toBeInTheDocument();
  });

  it("renders retrieval suggestions when provided", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-suggestions",
          role: "assistant",
          content: "I couldn't find a matching entry.",
          timeLabel: "10:03 AM",
          deliveryStatus: "sent",
          retrievalMeta: {
            refused: true,
            reason: "insufficient_evidence",
            status: "refusal",
            suggestions: [
              "Try the exact project title as written in the AIP.",
              "Provide the Ref code (e.g., 8000-003-002-006).",
              "Remove extra filters (scope/year) to broaden search.",
            ],
          },
          citations: [],
        }}
      />
    );

    expect(screen.getByText("Try:")).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes("1. Try the exact project title as written in the AIP.")
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes("2. Provide the Ref code (e.g., 8000-003-002-006).")
      )
    ).toBeInTheDocument();
  });

  it("shows failed status and retry action for failed user messages", () => {
    const onRetry = vi.fn();
    render(
      <ChatMessageBubble
        message={{
          id: "msg-failed-user",
          role: "user",
          content: "Tell me about project ABC",
          timeLabel: "10:04 AM",
          deliveryStatus: "failed",
          onRetry,
          retrievalMeta: null,
          citations: [],
        }}
      />
    );

    expect(screen.getByText("Failed to send.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders barangay project evidence as scoped project detail link", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-brgy-link",
          role: "assistant",
          content: "Here is the supporting project.",
          timeLabel: "10:05 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S4",
              scopeName: "Mamatid",
              scopeType: "barangay",
              fiscalYear: 2025,
              snippet: "Fallback snippet",
              aipId: "aip-1",
              projectId: "project-1",
              lguName: "Mamatid",
              resolvedFiscalYear: 2025,
              projectTitle: "Health Station Upgrade",
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", {
      name: "[S4] Mamatid FY 2025 Health Station Upgrade",
    });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-1/project-1");
  });

  it("renders city project evidence as scoped project detail link", () => {
    render(
      <ChatMessageBubble
        routeScope="city"
        message={{
          id: "msg-city-link",
          role: "assistant",
          content: "City project citation.",
          timeLabel: "10:06 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S5",
              scopeName: "Cabuyao City",
              scopeType: "city",
              fiscalYear: 2024,
              snippet: "Fallback city snippet",
              aipId: "aip-city",
              projectId: "project-city",
              lguName: "Cabuyao City",
              resolvedFiscalYear: 2024,
              projectTitle: "Flood Control Rehabilitation",
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", {
      name: "[S5] Cabuyao City FY 2024 Flood Control Rehabilitation",
    });
    expect(link).toHaveAttribute("href", "/city/aips/aip-city/project-city");
  });

  it("renders barangay totals evidence as scoped AIP detail link", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-brgy-totals-link",
          role: "assistant",
          content: "Totals citation.",
          timeLabel: "10:06 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S6",
              scopeName: "Published AIP totals",
              scopeType: "unknown",
              snippet: "Total investment program value from structured totals table.",
              aipId: "aip-2025-1",
              lguName: "Mamatid",
              resolvedFiscalYear: 2025,
              metadata: {
                type: "aip_totals",
              },
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", { name: "[S6] Mamatid FY 2025 AIP" });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-2025-1");
  });

  it("renders city totals evidence as scoped AIP detail link", () => {
    render(
      <ChatMessageBubble
        routeScope="city"
        message={{
          id: "msg-city-totals-link",
          role: "assistant",
          content: "Totals citation.",
          timeLabel: "10:07 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S7",
              scopeName: "Published AIP line items",
              scopeType: "unknown",
              snippet: "Computed from published AIP line-item totals.",
              aipId: "aip-city-2025",
              lguName: "Cabuyao City",
              resolvedFiscalYear: 2025,
              metadata: {
                type: "aip_line_items",
                aggregate_type: "total_investment_program",
              },
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", { name: "[S7] Cabuyao City FY 2025 AIP" });
    expect(link).toHaveAttribute("href", "/city/aips/aip-city-2025");
  });

  it("renders system-scope totals evidence and resolves AIP link from metadata.aip_id", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-system-totals-link",
          role: "assistant",
          content: "Totals citation from structured SQL.",
          timeLabel: "10:07 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S12",
              scopeName: "Published AIP totals",
              scopeType: "system",
              snippet: "Total investment program value from structured totals table.",
              insufficient: false,
              lguName: "Mamatid",
              resolvedFiscalYear: 2025,
              metadata: {
                type: "aip_totals",
                aip_id: "aip-meta-1",
              },
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", { name: "[S12] Mamatid FY 2025 AIP" });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-meta-1");
  });

  it("prefers project detail link over totals link when both metadata paths are present", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-project-precedence",
          role: "assistant",
          content: "Link precedence.",
          timeLabel: "10:08 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S8",
              scopeName: "Mamatid",
              scopeType: "barangay",
              snippet: "Project citation snippet.",
              aipId: "aip-precedence",
              projectId: "project-precedence",
              lguName: "Mamatid",
              resolvedFiscalYear: 2026,
              projectTitle: "Road Concreting",
              metadata: {
                type: "aip_totals",
              },
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", { name: "[S8] Mamatid FY 2026 Road Concreting" });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-precedence/project-precedence");
    expect(screen.queryByRole("link", { name: "[S8] Mamatid FY 2026 AIP" })).not.toBeInTheDocument();
  });

  it("does not render evidence container for system-only citations", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-system-citation",
          role: "assistant",
          content: "Unable to retrieve a project citation.",
          timeLabel: "10:07 AM",
          deliveryStatus: "sent",
          retrievalMeta: {
            refused: true,
            reason: "insufficient_evidence",
            status: "refusal",
          },
          citations: [
            {
              sourceId: "S0",
              scopeName: "System",
              scopeType: "system",
              snippet: "Pipeline request failed.",
              insufficient: true,
            },
          ],
        }}
      />
    );

    expect(screen.queryByTestId("chat-evidence-details")).not.toBeInTheDocument();
    expect(screen.queryByText("Pipeline request failed.")).not.toBeInTheDocument();
  });

  it("renders evidence container when citations include at least one non-system citation", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-mixed-citations",
          role: "assistant",
          content: "Mixed citations response.",
          timeLabel: "10:08 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S0",
              scopeName: "System",
              scopeType: "system",
              snippet: "No retrieval citations were produced for this response.",
              insufficient: true,
            },
            {
              sourceId: "S10",
              scopeName: "Mamatid",
              scopeType: "barangay",
              snippet: "Road concreting line item evidence.",
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId("chat-evidence-details")).toBeInTheDocument();
    expect(screen.getByTestId("chat-evidence-summary")).toHaveTextContent("Evidence (1)");
    expandEvidence();
    expect(screen.getByText("[S10] Mamatid FY Unknown FY Unknown Program")).toBeInTheDocument();
    expect(screen.queryByText("[S0] Unknown LGU FY Unknown FY Unknown Program")).not.toBeInTheDocument();
  });

  it("does not render evidence container for insufficient-context fallback reply", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-insufficient-context",
          role: "assistant",
          content: "I couldn\u2019t find a reliable answer for that in the published AIP records.",
          timeLabel: "10:09 AM",
          deliveryStatus: "sent",
          retrievalMeta: {
            refused: true,
            reason: "insufficient_evidence",
            status: "refusal",
          },
          citations: [
            {
              sourceId: "S11",
              scopeName: "Mamatid",
              scopeType: "barangay",
              snippet: "Road concreting line item evidence.",
              lguName: "Mamatid",
              fiscalYear: 2026,
              projectTitle: "Road Concreting",
            },
          ],
        }}
      />
    );

    expect(screen.queryByTestId("chat-evidence-details")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-evidence-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("[S11] Mamatid FY 2026 Road Concreting")).not.toBeInTheDocument();
  });

  it("keeps totals citations clickable when AIP route exists", () => {
    render(
      <ChatMessageBubble
        routeScope="barangay"
        message={{
          id: "msg-incomplete-totals",
          role: "assistant",
          content: "Incomplete totals evidence.",
          timeLabel: "10:09 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [
            {
              sourceId: "S9",
              scopeName: "Published AIP totals",
              scopeType: "unknown",
              snippet: "Totals evidence snippet.",
              aipId: "aip-incomplete",
              metadata: {
                type: "aip_totals",
              },
            },
          ],
        }}
      />
    );

    expandEvidence();
    const link = screen.getByRole("link", { name: "[S9] Unknown LGU FY Unknown FY AIP" });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-incomplete");
  });

  it("does not render evidence container when there are no citations", () => {
    render(
      <ChatMessageBubble
        message={{
          id: "msg-no-evidence",
          role: "assistant",
          content: "No evidence for this response.",
          timeLabel: "10:10 AM",
          deliveryStatus: "sent",
          retrievalMeta: null,
          citations: [],
        }}
      />
    );

    expect(screen.queryByTestId("chat-evidence-details")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-evidence-summary")).not.toBeInTheDocument();
  });
});
