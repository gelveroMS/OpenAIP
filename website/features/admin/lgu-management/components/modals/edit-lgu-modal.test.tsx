import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LguRecord } from "@/lib/repos/lgu/repo";
import EditLguModal from "./edit-lgu-modal";

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

describe("EditLguModal selector option policy", () => {
  it("shows active region/province options and only currently selected deactivated options as disabled", () => {
    const cityLgu: LguRecord = {
      id: "city-1",
      type: "city",
      name: "City Under Edit",
      code: "111111",
      regionId: "region-deactivated-current",
      provinceId: "province-deactivated-current",
      status: "active",
      updatedAt: "2026-03-22",
    };

    const lgus: LguRecord[] = [
      {
        id: "region-active",
        type: "region",
        name: "Region Active",
        code: "01",
        status: "active",
        updatedAt: "2026-03-22",
      },
      {
        id: "region-deactivated-current",
        type: "region",
        name: "Region Deactivated Current",
        code: "02",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
      {
        id: "region-deactivated-other",
        type: "region",
        name: "Region Deactivated Other",
        code: "03",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
      {
        id: "province-active",
        type: "province",
        name: "Province Active",
        code: "0201",
        regionId: "region-deactivated-current",
        status: "active",
        updatedAt: "2026-03-22",
      },
      {
        id: "province-deactivated-current",
        type: "province",
        name: "Province Deactivated Current",
        code: "0202",
        regionId: "region-deactivated-current",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
      {
        id: "province-deactivated-other",
        type: "province",
        name: "Province Deactivated Other",
        code: "0203",
        regionId: "region-deactivated-current",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
    ];

    render(
      <EditLguModal
        open
        onOpenChange={vi.fn()}
        lgu={cityLgu}
        lgus={lgus}
        onSave={vi.fn().mockResolvedValue(undefined)}
        submitError={null}
      />
    );

    expect(screen.getByText("Region Active")).toBeInTheDocument();
    const regionDeactivatedCurrent = screen.getByText(
      "Region Deactivated Current (Deactivated)"
    );
    expect(regionDeactivatedCurrent).toHaveAttribute("data-disabled", "true");
    expect(regionDeactivatedCurrent).toHaveClass("text-slate-400");
    expect(screen.queryByText("Region Deactivated Other")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Region Deactivated Other (Deactivated)")
    ).not.toBeInTheDocument();

    expect(screen.getByText("Province Active")).toBeInTheDocument();
    const provinceDeactivatedCurrent = screen.getByText(
      "Province Deactivated Current (Deactivated)"
    );
    expect(provinceDeactivatedCurrent).toHaveAttribute("data-disabled", "true");
    expect(provinceDeactivatedCurrent).toHaveClass("text-slate-400");
    expect(screen.queryByText("Province Deactivated Other")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Province Deactivated Other (Deactivated)")
    ).not.toBeInTheDocument();
  });

  it("shows active parent options and only selected deactivated parent as disabled", () => {
    const barangayLgu: LguRecord = {
      id: "barangay-1",
      type: "barangay",
      name: "Barangay Under Edit",
      code: "010101001",
      regionId: "region-1",
      provinceId: "province-1",
      parentType: "city",
      parentId: "city-parent-deactivated-current",
      status: "active",
      updatedAt: "2026-03-22",
    };

    const lgus: LguRecord[] = [
      {
        id: "region-1",
        type: "region",
        name: "Region One",
        code: "01",
        status: "active",
        updatedAt: "2026-03-22",
      },
      {
        id: "province-1",
        type: "province",
        name: "Province One",
        code: "0101",
        regionId: "region-1",
        status: "active",
        updatedAt: "2026-03-22",
      },
      {
        id: "city-parent-active",
        type: "city",
        name: "City Parent Active",
        code: "010101",
        regionId: "region-1",
        provinceId: "province-1",
        status: "active",
        updatedAt: "2026-03-22",
      },
      {
        id: "city-parent-deactivated-current",
        type: "city",
        name: "City Parent Deactivated Current",
        code: "010102",
        regionId: "region-1",
        provinceId: "province-1",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
      {
        id: "city-parent-deactivated-other",
        type: "city",
        name: "City Parent Deactivated Other",
        code: "010103",
        regionId: "region-1",
        provinceId: "province-1",
        status: "deactivated",
        updatedAt: "2026-03-22",
      },
    ];

    render(
      <EditLguModal
        open
        onOpenChange={vi.fn()}
        lgu={barangayLgu}
        lgus={lgus}
        onSave={vi.fn().mockResolvedValue(undefined)}
        submitError={null}
      />
    );

    expect(screen.getByText("City Parent Active")).toBeInTheDocument();
    const parentDeactivatedCurrent = screen.getByText(
      "City Parent Deactivated Current (Deactivated)"
    );
    expect(parentDeactivatedCurrent).toHaveAttribute("data-disabled", "true");
    expect(parentDeactivatedCurrent).toHaveClass("text-slate-400");
    expect(screen.queryByText("City Parent Deactivated Other")).not.toBeInTheDocument();
    expect(
      screen.queryByText("City Parent Deactivated Other (Deactivated)")
    ).not.toBeInTheDocument();
  });
});

