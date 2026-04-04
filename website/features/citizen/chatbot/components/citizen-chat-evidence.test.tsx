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
  it("renders project evidence link with citizen route and required label format", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-1",
            documentLabel: "Published AIP",
            snippet: "Fallback snippet",
            fiscalYear: "2025",
            pageOrSection: "Page 3",
            href: "/aips/aip-1/project-1",
            linkLabel: "Mamatid FY 2025 Health Station Upgrade",
          },
        ]}
      />
    );

    const link = screen.getByRole("link", {
      name: "Mamatid FY 2025 Health Station Upgrade",
    });
    expect(link).toHaveAttribute("href", "/aips/aip-1/project-1");
    expect(screen.queryByText("Fallback snippet")).not.toBeInTheDocument();
  });

  it("renders totals evidence link with citizen AIP detail route and standard label", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-2",
            documentLabel: "Published AIP totals",
            snippet: "Totals snippet",
            fiscalYear: "2025",
            pageOrSection: "Page 1",
            href: "/aips/aip-2",
            linkLabel: "Mamatid FY 2025 AIP",
          },
        ]}
      />
    );

    const link = screen.getByRole("link", { name: "Mamatid FY 2025 AIP" });
    expect(link).toHaveAttribute("href", "/aips/aip-2");
  });

  it("keeps unresolved evidence as plain snippet text", () => {
    render(
      <CitizenChatEvidence
        evidence={[
          {
            id: "evidence-3",
            documentLabel: "System",
            snippet: "No retrieval citations were produced for this response.",
            fiscalYear: null,
            pageOrSection: null,
            href: null,
            linkLabel: null,
          },
        ]}
      />
    );

    expect(screen.getByText("No retrieval citations were produced for this response.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
