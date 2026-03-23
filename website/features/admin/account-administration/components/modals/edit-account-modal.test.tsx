import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AccountRecord, LguOption } from "@/lib/repos/accounts/repo";
import EditAccountModal from "./edit-account-modal";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    disabled,
    className,
  }: {
    children: ReactNode;
    disabled?: boolean;
    className?: string;
  }) => (
    <div data-disabled={disabled ? "true" : "false"} className={className}>
      {children}
    </div>
  ),
}));

const account: AccountRecord = {
  id: "acct-1",
  tab: "officials",
  fullName: "Official User",
  email: "official@example.com",
  role: "city_official",
  status: "active",
  isActive: true,
  lguScopeType: "city",
  lguScopeId: "city-deactivated-current",
  lguAssignment: "City: Deactivated Current",
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
  lastLoginAt: null,
  invitedAt: null,
  emailConfirmedAt: null,
  invitationPending: false,
  canResendInvite: false,
};

const lguOptions: LguOption[] = [
  {
    key: "city:city-active-1",
    scopeType: "city",
    id: "city-active-1",
    label: "City: Active One",
    isActive: true,
  },
  {
    key: "city:city-active-2",
    scopeType: "city",
    id: "city-active-2",
    label: "City: Active Two",
    isActive: true,
  },
  {
    key: "city:city-deactivated-current",
    scopeType: "city",
    id: "city-deactivated-current",
    label: "City: Deactivated Current",
    isActive: false,
  },
  {
    key: "city:city-deactivated-other",
    scopeType: "city",
    id: "city-deactivated-other",
    label: "City: Deactivated Other",
    isActive: false,
  },
  {
    key: "municipality:mun-active",
    scopeType: "municipality",
    id: "mun-active",
    label: "Municipality: Active",
    isActive: true,
  },
];

function toLguKey(scopeType: AccountRecord["lguScopeType"], scopeId: string | null) {
  if (scopeType === "none" || !scopeId) return "none";
  return `${scopeType}:${scopeId}`;
}

describe("EditAccountModal LGU option policy", () => {
  it("shows active LGUs and only the currently selected deactivated LGU as disabled", () => {
    render(
      <EditAccountModal
        open
        onOpenChange={vi.fn()}
        account={account}
        lguOptions={lguOptions}
        toLguKey={toLguKey}
        onSave={vi.fn().mockResolvedValue(undefined)}
        loading={false}
      />
    );

    expect(screen.getByText("City: Active One")).toBeInTheDocument();
    expect(screen.getByText("City: Active Two")).toBeInTheDocument();
    expect(screen.queryByText("Municipality: Active")).not.toBeInTheDocument();

    const deactivatedOption = screen.getByText("City: Deactivated Current (Deactivated)");
    expect(deactivatedOption).toHaveAttribute("data-disabled", "true");
    expect(deactivatedOption).toHaveClass("text-slate-400");

    expect(screen.queryByText("City: Deactivated Other")).not.toBeInTheDocument();
    expect(
      screen.queryByText("City: Deactivated Other (Deactivated)")
    ).not.toBeInTheDocument();
  });
});

