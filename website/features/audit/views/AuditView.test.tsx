import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuditView from "./AuditView";
import type { ActivityLogRow } from "@/lib/repos/audit/repo";

function buildLog(index: number): ActivityLogRow {
  return {
    id: `audit-${index}`,
    actorId: `actor-${index}`,
    actorRole: "barangay_official",
    action: "feedback_created",
    entityType: "feedback",
    entityId: `feedback-${index}`,
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_001",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: `Actor ${index}`,
      actor_position: "Barangay Official",
      details: `Event details ${index}`,
    },
    createdAt: `2026-03-${String(Math.min(index, 28)).padStart(2, "0")}T10:00:00.000Z`,
  };
}

describe("AuditView", () => {
  it("paginates by 15 items per page", () => {
    const logs = Array.from({ length: 16 }, (_, index) => buildLog(index + 1));

    render(<AuditView logs={logs} />);

    expect(screen.getByText("Showing 1-15 of 16 events")).toBeInTheDocument();
    expect(screen.getByText("Actor 16")).toBeInTheDocument();
    expect(screen.queryByText("Actor 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 16-16 of 16 events")).toBeInTheDocument();
    expect(screen.getByText("Actor 1")).toBeInTheDocument();
  });
});
