import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenChatEvidence from "./citizen-chat-evidence";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string | URL;
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));

describe("CitizenChatEvidence", () => {
  it("renders one-line clickable evidence content when href exists", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-1",
            displayLine: "[S1] Mamatid FY 2025 Health Station Upgrade",
            href: "/aips/aip-1/project-1",
          },
        ]}
      />
    );

    const link = screen.getByRole("link", {
      name: "[S1] Mamatid FY 2025 Health Station Upgrade",
    });
    expect(link).toHaveAttribute("href", "/aips/aip-1/project-1");
    expect(screen.queryByText("Published AIP")).not.toBeInTheDocument();
    expect(screen.queryByText("Page 3")).not.toBeInTheDocument();
  });

  it("renders one-line totals evidence as clickable content", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-2",
            displayLine: "[S2] Mamatid FY 2025 AIP",
            href: "/aips/aip-2",
          },
        ]}
      />
    );

    const link = screen.getByRole("link", { name: "[S2] Mamatid FY 2025 AIP" });
    expect(link).toHaveAttribute("href", "/aips/aip-2");
  });

  it("renders one-line plain text evidence when href is missing", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-3",
            displayLine: "[S3] Unknown LGU FY Unknown FY Unknown Program",
            href: null,
          },
        ]}
      />
    );

    expect(screen.getByText("[S3] Unknown LGU FY Unknown FY Unknown Program")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
