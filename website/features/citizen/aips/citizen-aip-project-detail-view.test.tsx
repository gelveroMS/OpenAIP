import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CitizenAipProjectDetailView from "./views/citizen-aip-project-detail-view";
import type { AipDetails, AipProjectDetails } from "./types";

const mockFeedbackThread = vi.fn();

vi.mock("@/components/layout/breadcrumb-nav", () => ({
  BreadcrumbNav: () => <div data-testid="breadcrumb" />,
}));

vi.mock("@/features/projects/shared/feedback", () => ({
  FeedbackThread: (props: unknown) => {
    mockFeedbackThread(props);
    return <div data-testid="feedback-thread" />;
  },
}));

function buildAip(): AipDetails {
  return {
    id: "aip-1",
    scopeType: "city",
    scopeId: "city-1",
    lguLabel: "City of Cabuyao",
    title: "City of Cabuyao - Annual Investment Plan (AIP) 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-15T00:00:00.000Z",
    budgetTotal: 1000000,
    projectsCount: 1,
    description: "AIP description",
    subtitle: "Annual Investment Plan for Fiscal Year 2026",
    fileName: "AIP_2026.pdf",
    pdfUrl: "https://example.com/aip.pdf",
    summaryText: "Summary",
    detailedDescriptionIntro: "Intro",
    detailedBullets: [],
    detailedClosing: "Closing",
    projectRows: [],
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

function buildProject(aiIssues: string[], hasLguNote = false): AipProjectDetails {
  return {
    aipId: "aip-1",
    projectId: "project-1",
    category: "other",
    sector: "General Sector",
    projectRefCode: "1000-001-000-001",
    title: "Road rehabilitation project",
    description: "Project description",
    implementingAgency: "City Engineering Office",
    sourceOfFunds: "General Fund",
    expectedOutput: "Rehabilitated roads",
    startDate: "2026-03-01",
    completionDate: "2026-06-30",
    totalAmount: 500000,
    aiIssues,
    hasLguNote,
  };
}

describe("CitizenAipProjectDetailView AI status", () => {
  beforeEach(() => {
    mockFeedbackThread.mockClear();
  });

  it("renders separate citizen and workflow feedback containers", () => {
    render(<CitizenAipProjectDetailView aip={buildAip()} project={buildProject([])} />);

    expect(screen.getAllByTestId("feedback-thread")).toHaveLength(2);
    expect(mockFeedbackThread).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: "project-1",
        rootFilter: "citizen",
      })
    );
    expect(mockFeedbackThread).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectId: "project-1",
        rootFilter: "workflow",
        readOnly: true,
      })
    );
  });

  it("shows flagged state and issue list when AI issues exist", () => {
    render(
      <CitizenAipProjectDetailView
        aip={buildAip()}
        project={buildProject([
          "Budget breakdown is missing.",
          "Timeline milestone details are incomplete.",
        ])}
      />
    );

    expect(screen.getByText("AI flagged this project for potential issues.")).toBeInTheDocument();
    expect(screen.getByText("Budget breakdown is missing.")).toBeInTheDocument();
    expect(screen.getByText("Timeline milestone details are incomplete.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This AI-flagged project has not been addressed by an LGU feedback note yet."
      )
    ).toBeInTheDocument();
  });

  it("shows clean state when there are no AI issues", () => {
    render(<CitizenAipProjectDetailView aip={buildAip()} project={buildProject([])} />);

    expect(screen.getByText("No AI-detected issues for this project.")).toBeInTheDocument();
  });

  it("hides unresolved notice when an LGU note already addresses AI issues", () => {
    render(
      <CitizenAipProjectDetailView
        aip={buildAip()}
        project={buildProject(["Budget breakdown is missing."], true)}
      />
    );

    expect(screen.getByText("AI flagged this project for potential issues.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This AI-flagged project has not been addressed by an LGU feedback note yet."
      )
    ).not.toBeInTheDocument();
  });

  it("applies wrap-safe classes to project meta badges for mobile", () => {
    render(<CitizenAipProjectDetailView aip={buildAip()} project={buildProject([])} />);

    const refBadge = screen.getByText("1000-001-000-001");
    const sectorBadge = screen.getByText("General Sector");
    expect(refBadge.className).toContain("break-words");
    expect(sectorBadge.className).toContain("break-words");
  });
});
