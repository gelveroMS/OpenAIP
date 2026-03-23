import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LguOption, OfficialRole } from "@/lib/repos/accounts/repo";
import CreateOfficialModal from "./create-official-modal";

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
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const roleOptions: OfficialRole[] = ["barangay_official"];
const lguOptions: LguOption[] = [
  {
    key: "barangay:brgy-1",
    scopeType: "barangay",
    id: "brgy-1",
    label: "Barangay: Sample",
    isActive: true,
  },
];

describe("CreateOfficialModal submit errors", () => {
  it("renders submitError from parent mutation handling", () => {
    render(
      <CreateOfficialModal
        open
        onOpenChange={vi.fn()}
        roleOptions={roleOptions}
        lguOptions={lguOptions}
        onSave={vi.fn().mockResolvedValue(undefined)}
        loading={false}
        submitError="Failed to create account."
      />
    );

    expect(screen.getByTestId("admin-create-official-error")).toHaveTextContent(
      "Failed to create account."
    );
  });

  it("shows only active LGUs in assignment options", () => {
    const mixedLguOptions: LguOption[] = [
      {
        key: "barangay:brgy-active",
        scopeType: "barangay",
        id: "brgy-active",
        label: "Barangay: Active Option",
        isActive: true,
      },
      {
        key: "barangay:brgy-deactivated",
        scopeType: "barangay",
        id: "brgy-deactivated",
        label: "Barangay: Deactivated Option",
        isActive: false,
      },
      {
        key: "city:city-active",
        scopeType: "city",
        id: "city-active",
        label: "City: Unrelated Scope",
        isActive: true,
      },
    ];

    render(
      <CreateOfficialModal
        open
        onOpenChange={vi.fn()}
        roleOptions={roleOptions}
        lguOptions={mixedLguOptions}
        onSave={vi.fn().mockResolvedValue(undefined)}
        loading={false}
        submitError={null}
      />
    );

    expect(screen.getByText("Barangay: Active Option")).toBeInTheDocument();
    expect(screen.queryByText("Barangay: Deactivated Option")).not.toBeInTheDocument();
    expect(screen.queryByText("City: Unrelated Scope")).not.toBeInTheDocument();
  });
});
