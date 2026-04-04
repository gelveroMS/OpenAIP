import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatMessageBubble from "./ChatMessageBubble";

describe("ChatMessageBubble", () => {
  it("shows DIST or MATCH labels and never shows SIM", () => {
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

    expect(screen.getByText("DIST 0.235")).toBeInTheDocument();
    expect(screen.getByText("MATCH 75%")).toBeInTheDocument();
    expect(screen.getByText("MATCH 64%")).toBeInTheDocument();
    expect(screen.queryByText(/sim/i)).not.toBeInTheDocument();
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

    const link = screen.getByRole("link", { name: "Mamatid FY 2025 Health Station Upgrade" });
    expect(link).toHaveAttribute("href", "/barangay/aips/aip-1/project-1");
    expect(screen.queryByText("Fallback snippet")).not.toBeInTheDocument();
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

    const link = screen.getByRole("link", { name: "Cabuyao City FY 2024 Flood Control Rehabilitation" });
    expect(link).toHaveAttribute("href", "/city/aips/aip-city/project-city");
  });

  it("keeps non-project system citations as plain text evidence", () => {
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
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Pipeline request failed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /FY/i })).not.toBeInTheDocument();
  });
});
