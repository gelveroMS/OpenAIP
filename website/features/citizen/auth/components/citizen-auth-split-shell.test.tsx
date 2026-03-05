import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import CitizenAuthSplitShell from "@/features/citizen/auth/components/citizen-auth-split-shell";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

function renderSplitShell(formFirst: boolean) {
  render(
    <CitizenAuthSplitShell
      open
      onOpenChange={vi.fn()}
      titleId="citizen-auth-title"
      descriptionId="citizen-auth-description"
      formFirst={formFirst}
      formPanel={<div>Form Panel</div>}
      brandPanel={<div>Brand Panel</div>}
    />
  );
}

describe("CitizenAuthSplitShell ordering", () => {
  it("uses form-first classes when formFirst=true", () => {
    renderSplitShell(true);

    const formSection = screen.getByText("Form Panel").closest("section");
    const brandSection = screen.getByText("Brand Panel").closest("section");

    expect(formSection).not.toBeNull();
    expect(brandSection).not.toBeNull();
    expect(formSection).toHaveClass("order-1", "md:order-1");
    expect(brandSection).toHaveClass("order-2", "md:order-2");
  });

  it("keeps mobile form-first and flips desktop classes when formFirst=false", () => {
    renderSplitShell(false);

    const formSection = screen.getByText("Form Panel").closest("section");
    const brandSection = screen.getByText("Brand Panel").closest("section");

    expect(formSection).not.toBeNull();
    expect(brandSection).not.toBeNull();
    expect(formSection).toHaveClass("order-1", "md:order-2");
    expect(brandSection).toHaveClass("order-2", "md:order-1");
  });
});
