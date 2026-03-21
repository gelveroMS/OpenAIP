import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AccountRecord } from "@/lib/repos/accounts/repo";
import DeleteAccountModal from "./delete-account-modal";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const account: AccountRecord = {
  id: "acct-1",
  tab: "officials",
  fullName: "Sample Official",
  email: "official@example.gov.ph",
  role: "barangay_official",
  status: "active",
  isActive: true,
  lguScopeType: "barangay",
  lguScopeId: "brgy-1",
  lguAssignment: "Barangay: Sample",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  lastLoginAt: null,
  invitedAt: null,
  emailConfirmedAt: null,
  invitationPending: false,
  canResendInvite: false,
};

describe("DeleteAccountModal submit errors", () => {
  it("renders destructive submitError in-modal", () => {
    render(
      <DeleteAccountModal
        open
        onOpenChange={vi.fn()}
        account={account}
        onConfirm={vi.fn()}
        loading={false}
        submitError="Failed to delete account."
      />
    );

    expect(screen.getByTestId("admin-delete-account-error")).toHaveTextContent(
      "Failed to delete account."
    );
  });
});
