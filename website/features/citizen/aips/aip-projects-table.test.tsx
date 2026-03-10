import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AipProjectsTable from "./components/aip-projects-table";
import type { AipDetails } from "./types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

function buildAipDetails(): AipDetails {
  const generalRows = Array.from({ length: 12 }, (_, index) => ({
    id: `general-${index + 1}`,
    category: "other" as const,
    sector: "General Sector" as const,
    projectRefCode: `1000-${String(index + 1).padStart(3, "0")}`,
    programDescription: `General Program ${index + 1}`,
    totalAmount: 1000 + index,
    hasAiIssues: index <= 1,
    hasLguNote: index === 0,
  }));

  const socialRows = Array.from({ length: 3 }, (_, index) => ({
    id: `social-${index + 1}`,
    category: "health" as const,
    sector: "Social Sector" as const,
    projectRefCode: `3000-${String(index + 1).padStart(3, "0")}`,
    programDescription: `Social Program ${index + 1}`,
    totalAmount: 2000 + index,
    hasAiIssues: false,
    hasLguNote: false,
  }));

  return {
    id: "aip-1",
    scopeType: "city",
    scopeId: "city-1",
    lguLabel: "City of Cabuyao",
    title: "City of Cabuyao - Annual Investment Plan (AIP) 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-15T00:00:00.000Z",
    budgetTotal: 999999,
    projectsCount: generalRows.length + socialRows.length,
    description: "AIP description",
    subtitle: "Annual Investment Plan for Fiscal Year 2026",
    fileName: "AIP_2026.pdf",
    pdfUrl: "https://example.com/aip.pdf",
    summaryText: "Summary",
    detailedDescriptionIntro: "Intro",
    detailedBullets: [],
    detailedClosing: "Closing",
    projectRows: [...generalRows, ...socialRows],
    accountability: {
      uploadedBy: null,
      reviewedBy: null,
      approvedBy: null,
      uploadDate: null,
      approvalDate: null,
    },
    feedbackCount: 0,
  };
}

describe("AipProjectsTable", () => {
  it("uses offset pagination and supports next/previous navigation", () => {
    render(<AipProjectsTable aip={buildAipDetails()} />);

    expect(screen.getByText("Showing 1-10 of 12 projects")).toBeInTheDocument();
    expect(screen.getByText("General Program 1")).toBeInTheDocument();
    expect(screen.queryByText("General Program 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 11-12 of 12 projects")).toBeInTheDocument();
    expect(screen.getByText("General Program 11")).toBeInTheDocument();
    expect(screen.queryByText("General Program 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByText("Showing 1-10 of 12 projects")).toBeInTheDocument();
    expect(screen.getByText("General Program 1")).toBeInTheDocument();
  });

  it("applies row status styling precedence for LGU notes and AI flags", () => {
    render(<AipProjectsTable aip={buildAipDetails()} />);

    const rowWithLguNote = screen.getByText("General Program 1").closest("tr");
    const rowWithUnresolvedAiFlag = screen.getByText("General Program 2").closest("tr");
    const rowWithoutFlags = screen.getByText("General Program 3").closest("tr");

    expect(rowWithLguNote).toHaveClass("bg-amber-50");
    expect(rowWithLguNote).not.toHaveClass("bg-rose-50");

    expect(rowWithUnresolvedAiFlag).toHaveClass("bg-rose-50");
    expect(rowWithUnresolvedAiFlag).not.toHaveClass("bg-amber-50");

    expect(rowWithoutFlags).not.toHaveClass("bg-amber-50");
    expect(rowWithoutFlags).not.toHaveClass("bg-rose-50");
  });

  it("shows unresolved AI notice when flagged projects have no LGU note", () => {
    render(<AipProjectsTable aip={buildAipDetails()} />);

    expect(
      screen.getByText(
        "Notice: 1 AI-flagged project(s) in this AIP have not been addressed by an LGU feedback note yet."
      )
    ).toBeInTheDocument();
  });

  it("hides unresolved AI notice when all AI-flagged projects have LGU notes", () => {
    const aip = buildAipDetails();
    aip.projectRows = aip.projectRows.map((row) =>
      row.hasAiIssues ? { ...row, hasLguNote: true } : row
    );

    render(<AipProjectsTable aip={aip} />);

    expect(
      screen.queryByText(
        /AI-flagged project\(s\) in this AIP have not been addressed by an LGU feedback note yet\./
      )
    ).not.toBeInTheDocument();
  });

  it("resets offset when search changes", () => {
    render(<AipProjectsTable aip={buildAipDetails()} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11-12 of 12 projects")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by project name or keyword"), {
      target: { value: "General Program 12" },
    });
    expect(screen.getByText("Showing 1-1 of 1 projects")).toBeInTheDocument();
  });

  it("resets offset when sector changes", () => {
    render(<AipProjectsTable aip={buildAipDetails()} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11-12 of 12 projects")).toBeInTheDocument();

    const socialTab = screen.getByRole("tab", { name: "Social Sector" });
    fireEvent.mouseDown(socialTab);
    fireEvent.click(socialTab);

    expect(screen.getByText("Showing 1-3 of 3 projects")).toBeInTheDocument();
    expect(screen.getByText("Social Program 1")).toBeInTheDocument();
    expect(screen.queryByText("General Program 11")).not.toBeInTheDocument();
  });
});
