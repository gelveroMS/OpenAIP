import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAuditLogsView from "./admin-audit-logs-view";
import type { ActivityLogRow } from "@/lib/repos/audit/types";

const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
  }),
  usePathname: () => "/admin/audit-logs",
  useSearchParams: () => currentSearchParams,
}));

function latestPushParams(): URLSearchParams {
  const href = String(mockPush.mock.calls.at(-1)?.[0] ?? "");
  const url = new URL(href, "http://localhost");
  return url.searchParams;
}

const LOGS: ActivityLogRow[] = [
  {
    id: "audit-row-1",
    actorId: "citizen_001",
    actorRole: "citizen",
    action: "feedback_created",
    entityType: "feedback",
    entityId: "feedback-1",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Citizen One",
      actor_position: "Citizen",
      details: "Created feedback entry (question).",
    },
    createdAt: "2026-02-28T10:00:00.000Z",
  },
  {
    id: "audit-row-2",
    actorId: "admin_001",
    actorRole: "admin",
    action: "revision_requested",
    entityType: "aip",
    entityId: "aip-1",
    scope: {
      scope_type: "none",
      barangay_id: null,
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "System Admin",
      actor_position: "Administrator",
      details: "Requested revision.",
    },
    createdAt: "2026-02-27T10:00:00.000Z",
  },
];

describe("AdminAuditLogsView", () => {
  beforeEach(() => {
    mockPush.mockReset();
    currentSearchParams = new URLSearchParams(
      "page=2&pageSize=20&role=all&year=all&event=all&q=seed"
    );
  });

  it("rewrites URL when role filter changes and resets to page 1", () => {
    render(
      <AdminAuditLogsView
        logs={LOGS}
        total={40}
        filters={{
          page: 2,
          pageSize: 20,
          role: "all",
          year: "all",
          event: "all",
          q: "seed",
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Role filter"), {
      target: { value: "citizen" },
    });

    const params = latestPushParams();
    expect(params.get("page")).toBe("1");
    expect(params.get("role")).toBe("citizen");
    expect(params.get("q")).toBe("seed");
  });

  it("resets page when page size changes", () => {
    render(
      <AdminAuditLogsView
        logs={LOGS}
        total={40}
        filters={{
          page: 2,
          pageSize: 20,
          role: "all",
          year: "all",
          event: "all",
          q: "seed",
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Rows per page"), {
      target: { value: "50" },
    });

    const params = latestPushParams();
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("50");
  });

  it("updates page with pagination controls", () => {
    render(
      <AdminAuditLogsView
        logs={LOGS}
        total={40}
        filters={{
          page: 1,
          pageSize: 20,
          role: "all",
          year: "all",
          event: "all",
          q: "",
        }}
      />
    );

    const previous = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(previous).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    const params = latestPushParams();
    expect(params.get("page")).toBe("2");
  });

  it("renders rows and applies search updates to URL", () => {
    render(
      <AdminAuditLogsView
        logs={LOGS}
        total={2}
        filters={{
          page: 1,
          pageSize: 20,
          role: "all",
          year: "all",
          event: "all",
          q: "",
        }}
      />
    );

    expect(screen.getByText("Citizen One")).toBeInTheDocument();
    expect(screen.getByText("System Admin")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-2 of 2 events")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search filter"), {
      target: { value: "feedback" },
    });
    fireEvent.blur(screen.getByLabelText("Search filter"));

    const params = latestPushParams();
    expect(params.get("q")).toBe("feedback");
    expect(params.get("page")).toBe("1");
  });
});
