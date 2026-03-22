import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LguRecord } from "@/lib/repos/lgu/repo";
import DeactivateLguModal from "./deactivate-lgu-modal";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const lgu: LguRecord = {
  id: "city-1",
  type: "city",
  name: "City of Sample",
  code: "123456",
  status: "active",
  updatedAt: "2026-03-22",
};

describe("DeactivateLguModal", () => {
  it("renders destructive submitError in the modal", () => {
    render(
      <DeactivateLguModal
        open
        onOpenChange={vi.fn()}
        lgu={lgu}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        loading={false}
        submitError="Cannot deactivate while child LGUs are active."
      />
    );

    expect(screen.getByTestId("admin-deactivate-lgu-error")).toHaveTextContent(
      "Cannot deactivate while child LGUs are active."
    );
  });

  it("disables actions and shows loading label while submitting", () => {
    render(
      <DeactivateLguModal
        open
        onOpenChange={vi.fn()}
        lgu={lgu}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        loading
        submitError={null}
      />
    );

    expect(
      screen.getByRole("button", { name: "Deactivating..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

