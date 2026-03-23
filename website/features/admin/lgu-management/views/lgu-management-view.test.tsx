import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LguRecord } from "@/lib/repos/lgu/repo";
import LguManagementView from "./lgu-management-view";

const mockUseLguManagement = vi.fn();

vi.mock("../hooks/use-lgu-management", () => ({
  useLguManagement: (...args: unknown[]) => mockUseLguManagement(...args),
}));

vi.mock("../components/lgu-management-header", () => ({
  default: () => <div data-testid="lgu-management-header" />,
}));

vi.mock("../components/lgu-master-list", () => ({
  default: () => <div data-testid="lgu-master-list" />,
}));

vi.mock("../components/budget-categories-panel", () => ({
  default: () => <div data-testid="budget-categories-panel" />,
}));

vi.mock("../components/modals/add-lgu-modal", () => ({
  default: () => null,
}));

vi.mock("../components/modals/deactivate-lgu-modal", () => ({
  default: ({
    open,
    lgu,
    onConfirm,
    loading,
    submitError,
  }: {
    open: boolean;
    lgu: LguRecord | null;
    onConfirm: (id: string) => Promise<void>;
    loading: boolean;
    submitError: string | null;
  }) =>
    open ? (
      <div data-testid="deactivate-lgu-modal">
        {submitError ? (
          <div data-testid="deactivate-submit-error">{submitError}</div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (!lgu) return;
            void onConfirm(lgu.id);
          }}
          disabled={loading}
        >
          {loading ? "Deactivating..." : "Deactivate"}
        </button>
      </div>
    ) : null,
}));

vi.mock("../components/modals/edit-lgu-modal", () => ({
  default: ({
    open,
    lgu,
    onSave,
    submitError,
  }: {
    open: boolean;
    lgu: LguRecord | null;
    onSave: (id: string, patch: Record<string, unknown>, nextStatus: "active" | "deactivated") => Promise<void>;
    submitError: string | null;
  }) =>
    open ? (
      <div data-testid="edit-lgu-modal">
        {submitError ? <div data-testid="edit-submit-error">{submitError}</div> : null}
        <button
          type="button"
          onClick={() => {
            if (!lgu) return;
            void onSave(lgu.id, {}, "deactivated").catch(() => undefined);
          }}
        >
          Save Deactivated
        </button>
      </div>
    ) : null,
}));

const lgu: LguRecord = {
  id: "city-1",
  type: "city",
  name: "City of Sample",
  code: "123456",
  status: "active",
  updatedAt: "2026-03-22",
};

function makeHookReturn(input: {
  setStatus: (id: string, status: "active" | "deactivated") => Promise<unknown>;
  deactivateOpen?: boolean;
  editOpen?: boolean;
  setDeactivateOpen?: (open: boolean) => void;
  setEditOpen?: (open: boolean) => void;
}) {
  return {
    loading: false,
    error: null,
    query: "",
    setQuery: vi.fn(),
    typeFilter: "all",
    setTypeFilter: vi.fn(),
    statusFilter: "all",
    setStatusFilter: vi.fn(),
    lgus: [lgu],
    filteredLgus: [lgu],
    addOpen: false,
    setAddOpen: vi.fn(),
    editOpen: input.editOpen ?? false,
    setEditOpen: input.setEditOpen ?? vi.fn(),
    deactivateOpen: input.deactivateOpen ?? false,
    setDeactivateOpen: input.setDeactivateOpen ?? vi.fn(),
    selected: lgu,
    openAdd: vi.fn(),
    openEdit: vi.fn(),
    openDeactivate: vi.fn(),
    addLgu: vi.fn().mockResolvedValue(undefined),
    editLgu: vi.fn().mockResolvedValue(lgu),
    setStatus: input.setStatus,
  };
}

describe("LguManagementView deactivation error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps deactivate modal open and shows mapped child-LGU error on direct deactivate failure", async () => {
    const setDeactivateOpen = vi.fn();
    const setStatus = vi
      .fn()
      .mockRejectedValue(
        new Error("Cannot deactivate city while it still has active child LGUs.")
      );
    mockUseLguManagement.mockReturnValue(
      makeHookReturn({
        setStatus,
        deactivateOpen: true,
        setDeactivateOpen,
      })
    );

    render(<LguManagementView />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(screen.getByTestId("deactivate-submit-error")).toHaveTextContent(
        "This LGU cannot be deactivated while it still has active child LGUs. Deactivate child LGUs first."
      );
    });
    expect(setDeactivateOpen).not.toHaveBeenCalledWith(false);
  });

  it("keeps edit modal open and shows mapped error when edit->deactivate status update fails", async () => {
    const setEditOpen = vi.fn();
    const setStatus = vi.fn().mockRejectedValue(new Error("Unauthorized."));
    mockUseLguManagement.mockReturnValue(
      makeHookReturn({
        setStatus,
        editOpen: true,
        setEditOpen,
      })
    );

    render(<LguManagementView />);
    fireEvent.click(screen.getByRole("button", { name: "Save Deactivated" }));

    await waitFor(() => {
      expect(screen.getByTestId("edit-submit-error")).toHaveTextContent(
        "You do not have permission to deactivate LGUs."
      );
    });
    expect(setEditOpen).not.toHaveBeenCalledWith(false);
  });

  it("clears previous direct-deactivate error on retry and closes on success", async () => {
    const setDeactivateOpen = vi.fn();
    const setStatus = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Cannot deactivate city while it still has active child LGUs.")
      )
      .mockResolvedValueOnce(lgu);
    mockUseLguManagement.mockReturnValue(
      makeHookReturn({
        setStatus,
        deactivateOpen: true,
        setDeactivateOpen,
      })
    );

    render(<LguManagementView />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => {
      expect(screen.getByTestId("deactivate-submit-error")).toHaveTextContent(
        "This LGU cannot be deactivated while it still has active child LGUs. Deactivate child LGUs first."
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(setDeactivateOpen).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByTestId("deactivate-submit-error")).not.toBeInTheDocument();
    expect(setStatus).toHaveBeenCalledTimes(2);
  });
});
