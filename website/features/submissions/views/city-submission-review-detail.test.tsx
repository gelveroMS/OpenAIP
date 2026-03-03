import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CitySubmissionReviewDetail from "./city-submission-review-detail";
import type { AipHeader } from "@/features/aip/types";
import type { AipRevisionFeedbackCycle } from "@/lib/repos/aip/repo";
import type { LatestReview } from "@/lib/repos/submissions/repo";
import { claimReviewAction } from "../actions/submissionsReview.actions";

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockToCityRevisionFeedbackCycles = vi.hoisted(
  () => vi.fn<() => AipRevisionFeedbackCycle[]>(() => [])
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/layout/breadcrumb-nav", () => ({
  BreadcrumbNav: () => <div data-testid="breadcrumb-nav" />,
}));

vi.mock("@/features/aip/components/aip-pdf-container", () => ({
  AipPdfContainer: () => <div data-testid="aip-pdf-container" />,
}));

vi.mock("@/features/aip/components/aip-details-summary", () => ({
  AipDetailsSummary: () => <div data-testid="aip-details-summary" />,
}));

vi.mock("@/features/aip/components/aip-uploader-info", () => ({
  AipUploaderInfo: () => <div data-testid="aip-uploader-info" />,
}));

vi.mock("@/features/aip/views/aip-details-table", () => ({
  AipDetailsTableView: () => <div data-testid="aip-details-table-view" />,
}));

vi.mock("../components/PublishSuccessCard", () => ({
  PublishSuccessCard: () => <div data-testid="publish-success-card" />,
}));

vi.mock("../components/city-revision-feedback-history-card", () => ({
  CityRevisionFeedbackHistoryCard: () => <div data-testid="city-history-card" />,
  toCityRevisionFeedbackCycles: mockToCityRevisionFeedbackCycles,
}));

vi.mock("../actions/submissionsReview.actions", () => ({
  claimReviewAction: vi.fn(async () => ({ ok: true })),
  publishAipAction: vi.fn(async () => ({ ok: true })),
  requestRevisionAction: vi.fn(async () => ({ ok: true })),
}));

const mockClaimReviewAction = vi.mocked(claimReviewAction);

function baseAip(overrides: Partial<AipHeader> = {}): AipHeader {
  return {
    id: "aip-001",
    scope: "barangay",
    barangayName: "Brgy. Test",
    title: "Annual Investment Program 2026",
    description: "AIP description",
    year: 2026,
    budget: 1000000,
    uploadedAt: "2026-01-01",
    status: "published",
    fileName: "AIP_2026_Test.pdf",
    pdfUrl: "https://example.com/aip.pdf",
    sectors: ["General Sector"],
    uploader: {
      name: "Test User",
      role: "Barangay Official",
      uploadDate: "Jan 1, 2026",
      budgetAllocated: 1000000,
    },
    ...overrides,
  };
}

describe("CitySubmissionReviewDetail sidebar behavior", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockRefresh.mockReset();
    mockClaimReviewAction.mockResolvedValue({ ok: true });
    mockToCityRevisionFeedbackCycles.mockReset();
    mockToCityRevisionFeedbackCycles.mockReturnValue([]);
  });

  it("hides feedback history for published AIP with no feedback cycles", () => {
    render(
      <CitySubmissionReviewDetail
        aip={baseAip({
          status: "published",
          publishedBy: {
            reviewerId: "city-user-001",
            reviewerName: "City Reviewer",
            createdAt: "2026-01-02T08:30:00.000Z",
          },
        })}
        latestReview={null}
        actorUserId="city-user-001"
        actorRole="city_official"
      />
    );

    expect(screen.getByText("Published Status")).toBeInTheDocument();
    expect(screen.getByText("Publication Details")).toBeInTheDocument();
    expect(screen.getByText(/City Reviewer/)).toBeInTheDocument();
    expect(screen.queryByTestId("city-history-card")).not.toBeInTheDocument();
  });

  it("shows feedback history for published AIP when feedback cycles exist", () => {
    mockToCityRevisionFeedbackCycles.mockReturnValueOnce([
      {
        cycleId: "cycle-001",
        reviewerRemark: {
          id: "remark-001",
          body: "Please revise.",
          createdAt: "2026-01-01T08:00:00.000Z",
          authorRole: "reviewer",
        },
        replies: [],
      },
    ]);

    render(
      <CitySubmissionReviewDetail
        aip={baseAip({
          status: "published",
          publishedBy: {
            reviewerId: "city-user-001",
            reviewerName: "City Reviewer",
            createdAt: "2026-01-02T08:30:00.000Z",
          },
        })}
        latestReview={null}
        actorUserId="city-user-001"
        actorRole="city_official"
      />
    );

    expect(screen.getByText("Published Status")).toBeInTheDocument();
    expect(screen.getByTestId("city-history-card")).toBeInTheDocument();
  });

  it("keeps review actions branch when reviewer owns under_review item", () => {
    const latestReview: LatestReview = {
      reviewerId: "city-user-001",
      reviewerName: "City Reviewer",
      action: "claim_review",
      note: null,
      createdAt: "2026-01-01T08:00:00.000Z",
    };

    render(
      <CitySubmissionReviewDetail
        aip={baseAip({ status: "under_review" })}
        latestReview={latestReview}
        actorUserId="city-user-001"
        actorRole="city_official"
        mode="review"
      />
    );

    expect(screen.getByText("Review Actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish AIP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request Revision" })).toBeInTheDocument();
    expect(screen.queryByText("Publication Details")).not.toBeInTheDocument();
    expect(screen.getByTestId("city-history-card")).toBeInTheDocument();
  });

  it("treats intent=review as review mode when reviewer owns under_review item", () => {
    const latestReview: LatestReview = {
      reviewerId: "city-user-001",
      reviewerName: "City Reviewer",
      action: "claim_review",
      note: null,
      createdAt: "2026-01-01T08:00:00.000Z",
    };

    render(
      <CitySubmissionReviewDetail
        aip={baseAip({ status: "under_review" })}
        latestReview={latestReview}
        actorUserId="city-user-001"
        actorRole="city_official"
        intent="review"
      />
    );

    expect(screen.getByText("Review Actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish AIP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request Revision" })).toBeInTheDocument();
  });

  it("keeps review assignment branch for pending_review", () => {
    render(
      <CitySubmissionReviewDetail
        aip={baseAip({ status: "pending_review" })}
        latestReview={null}
        actorUserId="city-user-001"
        actorRole="city_official"
      />
    );

    expect(screen.getByText("Review Assignment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Claim AIP" })).toBeInTheDocument();
    expect(screen.getByTestId("city-history-card")).toBeInTheDocument();
  });

  it("shows review actions immediately after claim from review-intent dialog", async () => {
    render(
      <CitySubmissionReviewDetail
        aip={baseAip({ status: "pending_review" })}
        latestReview={null}
        actorUserId="city-user-001"
        actorRole="city_official"
        intent="review"
      />
    );

    const claimDialogTitle = await screen.findByText("Claim Review Ownership");
    const dialog = claimDialogTitle.closest("[role='dialog']") as HTMLElement | null;
    if (!dialog) throw new Error("Claim dialog is not open.");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Review & Claim AIP" })
    );

    await waitFor(() => {
      expect(screen.getByText("Review Actions")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Publish AIP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request Revision" })).toBeInTheDocument();
    expect(mockClaimReviewAction).toHaveBeenCalledWith({ aipId: "aip-001" });
    expect(mockReplace).toHaveBeenCalledWith("/city/submissions/aip/aip-001?mode=review");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows review actions immediately after claim from in-page button", async () => {
    render(
      <CitySubmissionReviewDetail
        aip={baseAip({ status: "pending_review" })}
        latestReview={null}
        actorUserId="city-user-001"
        actorRole="city_official"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Review & Claim AIP" }));

    await waitFor(() => {
      expect(screen.getByText("Review Actions")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Publish AIP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request Revision" })).toBeInTheDocument();
    expect(mockClaimReviewAction).toHaveBeenCalledWith({ aipId: "aip-001" });
    expect(mockReplace).toHaveBeenCalledWith("/city/submissions/aip/aip-001?mode=review");
    expect(mockRefresh).toHaveBeenCalled();
  });
});
