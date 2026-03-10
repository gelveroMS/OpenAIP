import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AipDetailView from "./aip-detail-view";
import type { AipHeader, AipStatus } from "../types";
import type { AipRevisionFeedbackCycle } from "@/lib/repos/aip/repo";
import { EMBED_SKIP_NO_ARTIFACT_MESSAGE } from "@/lib/constants/embedding";
import type {
  ExtractionRunRealtimeEvent,
  UseExtractionRunsRealtimeInput,
} from "../hooks/use-extraction-runs-realtime";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();
let mockPathname = "/barangay/aips/aip-001";
let lastDetailsTableProps: {
  scope: "city" | "barangay";
  enablePagination?: boolean;
} | null = null;
let mockProjectsState = {
  rows: [] as Array<{
    id: string;
    projectRefCode: string;
    aipDescription: string;
    reviewStatus: "ai_flagged" | "reviewed" | "unreviewed";
  }>,
  loading: false,
  error: null as string | null,
  unresolvedAiCount: 0,
};
let mockSearchParams = new URLSearchParams();
let latestRealtimeArgs: UseExtractionRunsRealtimeInput | null = null;
let realtimeArgsHistory: UseExtractionRunsRealtimeInput[] = [];

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/components/layout/breadcrumb-nav", () => ({
  BreadcrumbNav: () => <div data-testid="breadcrumb-nav" />,
}));

vi.mock("../components/aip-pdf-container", () => ({
  AipPdfContainer: () => <div data-testid="aip-pdf-container" />,
}));

vi.mock("../components/aip-details-summary", () => ({
  AipDetailsSummary: () => <div data-testid="aip-details-summary" />,
}));

vi.mock("../components/aip-uploader-info", () => ({
  AipUploaderInfo: () => <div data-testid="aip-uploader-info" />,
}));

vi.mock("../components/aip-processing-inline-status", () => ({
  AipProcessingInlineStatus: () => <div data-testid="aip-processing-inline-status" />,
}));

vi.mock("../components/lgu-aip-feedback-thread", () => ({
  LguAipFeedbackThread: () => <div data-testid="lgu-aip-feedback-thread" />,
}));

vi.mock("./aip-details-table", () => ({
  AipDetailsTableView: ({
    onProjectsStateChange,
    scope,
    enablePagination,
  }: {
    onProjectsStateChange?: (state: {
      rows: unknown[];
      loading: boolean;
      error: string | null;
      unresolvedAiCount: number;
    }) => void;
    scope: "city" | "barangay";
    enablePagination?: boolean;
  }) => {
    lastDetailsTableProps = { scope, enablePagination };
    React.useEffect(() => {
      onProjectsStateChange?.({
        rows: mockProjectsState.rows,
        loading: mockProjectsState.loading,
        error: mockProjectsState.error,
        unresolvedAiCount: mockProjectsState.unresolvedAiCount,
      });
    }, [onProjectsStateChange]);
    return <div data-testid="aip-details-table-view" />;
  },
}));

vi.mock("@/features/feedback", () => ({
  CommentThreadsSplitView: () => <div data-testid="comment-threads-split-view" />,
}));

vi.mock("../actions/aip-workflow.actions", () => ({
  submitAipForReviewAction: vi.fn(async () => ({ ok: true, message: "Submitted" })),
  submitCityAipForPublishAction: vi.fn(async () => ({ ok: true, message: "Published" })),
  saveAipRevisionReplyAction: vi.fn(async () => ({ ok: true, message: "Saved" })),
  deleteAipDraftAction: vi.fn(async () => ({ ok: true, message: "Deleted" })),
  cancelAipSubmissionAction: vi.fn(async () => ({ ok: true, message: "Canceled" })),
}));

vi.mock("../hooks/use-extraction-runs-realtime", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-extraction-runs-realtime")>(
    "../hooks/use-extraction-runs-realtime"
  );
  return {
    ...actual,
    useExtractionRunsRealtime: vi.fn((args: UseExtractionRunsRealtimeInput) => {
      realtimeArgsHistory.push(args);
      if (args.runId) {
        latestRealtimeArgs = args;
        return;
      }
      if (!latestRealtimeArgs || !latestRealtimeArgs.runId) {
        latestRealtimeArgs = args;
      }
    }),
  };
});

function baseAip(status: AipStatus, overrides: Partial<AipHeader> = {}): AipHeader {
  return {
    id: "aip-001",
    scope: "barangay",
    barangayName: "Brgy. Test",
    title: "Annual Investment Program 2026",
    description: "AIP description",
    year: 2026,
    budget: 1000000,
    uploadedAt: "2026-01-01",
    status,
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

function revisionCycle(overrides: Partial<AipRevisionFeedbackCycle> = {}): AipRevisionFeedbackCycle {
  return {
    cycleId: "cycle-001",
    reviewerRemark: {
      id: "remark-001",
      body: "Please revise.",
      createdAt: "2026-01-01T08:00:00.000Z",
      authorRole: "reviewer",
      authorName: "Reviewer",
    },
    replies: [],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flaggedProject(
  id: string,
  refCode: string,
  description: string
): {
  id: string;
  projectRefCode: string;
  aipDescription: string;
  reviewStatus: "ai_flagged";
} {
  return {
    id,
    projectRefCode: refCode,
    aipDescription: description,
    reviewStatus: "ai_flagged",
  };
}

function findLatestRealtimeArgs(
  predicate: (args: UseExtractionRunsRealtimeInput) => boolean
): UseExtractionRunsRealtimeInput | null {
  for (let index = realtimeArgsHistory.length - 1; index >= 0; index -= 1) {
    const args = realtimeArgsHistory[index];
    if (predicate(args)) return args;
  }
  return null;
}

describe("AipDetailView sidebar behavior", () => {
  beforeEach(() => {
    lastDetailsTableProps = null;
    mockPathname = "/barangay/aips/aip-001";
    mockSearchParams = new URLSearchParams();
    latestRealtimeArgs = null;
    realtimeArgsHistory = [];
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    mockProjectsState = {
      rows: [],
      loading: false,
      error: null,
      unresolvedAiCount: 0,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows actionable sidebar for for_revision", async () => {
    render(
      <AipDetailView
        aip={baseAip("for_revision", {
          feedback: "Reviewer feedback is available.",
          revisionFeedbackCycles: [revisionCycle()],
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Official Comment / Justification")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeInTheDocument();
    expect(screen.getByText("Reviewer Feedback History")).toBeInTheDocument();
    expect(screen.queryByText("Cycle 1 of 1")).not.toBeInTheDocument();
  });

  it("shows read-only notice and hides workflow actions for non-uploader barangay official", async () => {
    render(
      <AipDetailView
        aip={baseAip("for_revision", {
          revisionFeedbackCycles: [revisionCycle()],
          workflowPermissions: {
            canManageBarangayWorkflow: false,
            lockReason: "Only the uploader of this AIP can modify this workflow.",
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(
      screen.getAllByText("Only the uploader of this AIP can modify this workflow.")
        .length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Resubmit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for Review" })).not.toBeInTheDocument();
  });

  it("paginates reviewer feedback history by revision cycle", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          revisionFeedbackCycles: [
            revisionCycle({
              cycleId: "cycle-002",
              reviewerRemark: {
                id: "remark-002",
                body: "Latest reviewer remark.",
                createdAt: "2026-01-03T08:00:00.000Z",
                authorRole: "reviewer",
                authorName: "Latest Reviewer",
              },
              replies: [],
            }),
            revisionCycle({
              cycleId: "cycle-001",
              reviewerRemark: {
                id: "remark-001",
                body: "Older reviewer remark.",
                createdAt: "2026-01-01T08:00:00.000Z",
                authorRole: "reviewer",
                authorName: "Older Reviewer",
              },
              replies: [],
            }),
          ],
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Latest reviewer remark.")).toBeInTheDocument();
    expect(screen.queryByText("Older reviewer remark.")).not.toBeInTheDocument();
    expect(screen.getByText("Cycle 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByText("Latest reviewer remark.")).not.toBeInTheDocument();
    expect(screen.getByText("Older reviewer remark.")).toBeInTheDocument();
    expect(screen.getByText("Cycle 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByText("Latest reviewer remark.")).toBeInTheDocument();
    expect(screen.queryByText("Older reviewer remark.")).not.toBeInTheDocument();
    expect(screen.getByText("Cycle 1 of 2")).toBeInTheDocument();
  });

  it("shows cancel action sidebar for pending_review", async () => {
    render(
      <AipDetailView
        aip={baseAip("pending_review", {
          revisionFeedbackCycles: [revisionCycle()],
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Official Comment / Justification")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Submission" })).toBeInTheDocument();
    expect(screen.getByText("Reviewer Feedback History")).toBeInTheDocument();
  });

  it("shows status info sidebar for under_review with no workflow actions", async () => {
    render(
      <AipDetailView
        aip={baseAip("under_review", {
          revisionFeedbackCycles: [revisionCycle()],
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Under Review Status")).toBeInTheDocument();
    expect(screen.queryByText("Official Comment / Justification")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resubmit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Submission" })).not.toBeInTheDocument();
    expect(screen.queryByText("Publication Details")).not.toBeInTheDocument();
    expect(screen.getByText("Reviewer Feedback History")).toBeInTheDocument();
  });

  it("shows status info sidebar for published with no workflow actions", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          revisionFeedbackCycles: [revisionCycle()],
          publishedBy: {
            reviewerId: "city-user-001",
            reviewerName: "City Reviewer",
            createdAt: "2026-01-02T08:30:00.000Z",
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Published Status")).toBeInTheDocument();
    expect(screen.queryByText("Official Comment / Justification")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resubmit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Submission" })).not.toBeInTheDocument();
    expect(screen.getByText("Publication Details")).toBeInTheDocument();
    expect(screen.getByText(/City Reviewer/)).toBeInTheDocument();
    expect(screen.getByText("Reviewer Feedback History")).toBeInTheDocument();
  });

  it("shows Chatbot Ready status for published AIP with successful embedding", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          embedding: {
            runId: "run-ready",
            status: "succeeded",
            progressMessage: null,
            errorMessage: null,
            overallProgressPct: null,
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Chatbot Ready")).toBeInTheDocument();
    expect(
      screen.getByText("This AIP is embedded and can now be queried through the chatbot.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Embedding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Embedding" })).not.toBeInTheDocument();
  });

  it("shows Currently Embedding status and progress for active embedding run", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          embedding: {
            runId: "run-embedding",
            status: "running",
            progressMessage: null,
            errorMessage: null,
            overallProgressPct: 48,
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Currently Embedding")).toBeInTheDocument();
    expect(screen.getByText("Progress: 48%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Embedding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Embedding" })).not.toBeInTheDocument();
  });

  it("shows Failed to Embed status with retry action", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          embedding: {
            runId: "run-failed",
            status: "failed",
            progressMessage: null,
            errorMessage: "Embedding pipeline timeout.",
            overallProgressPct: null,
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Failed to Embed")).toBeInTheDocument();
    expect(screen.getByText("Embedding pipeline timeout.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Embedding" })).toBeInTheDocument();
  });

  it("shows Needs Embedding status and start action when no embedding run exists", async () => {
    render(<AipDetailView aip={baseAip("published", { embedding: undefined })} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Needs Embedding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Embedding" })).toBeInTheDocument();
  });

  it("maps skipped embedding to Needs Embedding with start action", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          embedding: {
            runId: "run-skipped",
            status: "succeeded",
            progressMessage: EMBED_SKIP_NO_ARTIFACT_MESSAGE,
            errorMessage: null,
            overallProgressPct: null,
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Needs Embedding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Embedding" })).toBeInTheDocument();
  });

  it("updates embed sidebar state from aip-level realtime events without takeover layout", async () => {
    render(<AipDetailView aip={baseAip("published", { embedding: undefined })} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    const embedRealtimeArgs = await waitFor(() => {
      const args = findLatestRealtimeArgs(
        (value) =>
          value.aipId === "aip-001" &&
          value.channelKey?.includes("aip-detail-embed-aip-001") === true
      );
      expect(args).not.toBeNull();
      return args as UseExtractionRunsRealtimeInput;
    });

    act(() => {
      embedRealtimeArgs.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-embed-100",
          aip_id: "aip-001",
          stage: "embed",
          status: "running",
          error_message: null,
          overall_progress_pct: 34,
          stage_progress_pct: 34,
          progress_message: "Indexing chunks...",
          progress_updated_at: "2026-03-10T10:00:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("Currently Embedding")).toBeInTheDocument();
    });
    expect(screen.getByText("Progress: 34%")).toBeInTheDocument();
    expect(screen.queryByTestId("aip-processing-inline-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("aip-pdf-container")).toBeInTheDocument();

    act(() => {
      embedRealtimeArgs.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-embed-100",
          aip_id: "aip-001",
          stage: "embed",
          status: "failed",
          error_message: "Embedding provider timeout.",
          overall_progress_pct: 34,
          stage_progress_pct: 34,
          progress_message: "Embedding provider timeout.",
          progress_updated_at: "2026-03-10T10:01:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to Embed")).toBeInTheDocument();
    });
    expect(screen.getByText("Embedding provider timeout.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Embedding" })).toBeInTheDocument();
    expect(screen.queryByText("Pipeline Failed")).not.toBeInTheDocument();

    act(() => {
      embedRealtimeArgs.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-embed-101",
          aip_id: "aip-001",
          stage: "embed",
          status: "succeeded",
          error_message: null,
          overall_progress_pct: 100,
          stage_progress_pct: 100,
          progress_message: EMBED_SKIP_NO_ARTIFACT_MESSAGE,
          progress_updated_at: "2026-03-10T10:02:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("Needs Embedding")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Start Embedding" })).toBeInTheDocument();
  });

  it("keeps detail layout visible when active lookup returns an embed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/aip-001/runs/active")) {
          return new Response(
            JSON.stringify({
              run: {
                runId: "run-embed-lookup",
                aipId: "aip-001",
                stage: "embed",
                status: "running",
                errorMessage: null,
                createdAt: "2026-03-10T10:00:00.000Z",
              },
              failedRun: null,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null, failedRun: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("published", { embedding: undefined })} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Currently Embedding")).toBeInTheDocument();
    expect(screen.queryByTestId("aip-processing-inline-status")).not.toBeInTheDocument();
    expect(screen.queryByText("Pipeline Failed")).not.toBeInTheDocument();
    expect(screen.getByTestId("aip-pdf-container")).toBeInTheDocument();
    expect(screen.getByTestId("aip-details-table-view")).toBeInTheDocument();
  });

  it("rehydrates embed snapshot when embed realtime reconnects", async () => {
    let embedSnapshotCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/barangay/aips/aip-001/runs/active")) {
        return new Response(
          JSON.stringify({
            run: {
              runId: "run-embed-lookup",
              aipId: "aip-001",
              stage: "embed",
              status: "running",
              errorMessage: null,
              createdAt: "2026-03-10T10:00:00.000Z",
            },
            failedRun: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (url.includes("/api/barangay/aips/runs/run-embed-lookup")) {
        embedSnapshotCallCount += 1;
        if (embedSnapshotCallCount === 1) {
          return new Response(
            JSON.stringify({
              runId: "run-embed-lookup",
              aipId: "aip-001",
              stage: "embed",
              status: "running",
              errorMessage: null,
              overallProgressPct: 85,
              stageProgressPct: 85,
              progressMessage: "Computing embeddings.",
              progressUpdatedAt: "2026-03-10T10:00:00.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(
          JSON.stringify({
            runId: "run-embed-lookup",
            aipId: "aip-001",
            stage: "embed",
            status: "succeeded",
            errorMessage: null,
            overallProgressPct: 100,
            stageProgressPct: 100,
            progressMessage: "Search indexing completed successfully.",
            progressUpdatedAt: "2026-03-10T10:01:00.000Z",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ run: null, failedRun: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AipDetailView aip={baseAip("published", { embedding: undefined })} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Currently Embedding")).toBeInTheDocument();
    });

    const embedRealtimeArgs = await waitFor(() => {
      const args = findLatestRealtimeArgs(
        (value) =>
          value.aipId === "aip-001" &&
          value.channelKey?.includes("aip-detail-embed-aip-001") === true
      );
      expect(args).not.toBeNull();
      return args as UseExtractionRunsRealtimeInput;
    });

    const callsBeforeReconnect = fetchMock.mock.calls.length;
    act(() => {
      embedRealtimeArgs.onStatusChange?.("SUBSCRIBED" as never);
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeReconnect);
    });
    await waitFor(() => {
      expect(screen.getByText("Chatbot Ready")).toBeInTheDocument();
    });
    expect(screen.queryByText("Currently Embedding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-processing-inline-status")).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("keeps detail layout visible when active lookup returns failed embed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/aip-001/runs/active")) {
          return new Response(
            JSON.stringify({
              run: null,
              failedRun: {
                runId: "run-embed-failed",
                aipId: "aip-001",
                stage: "embed",
                status: "failed",
                errorMessage: "Embedding request failed.",
                createdAt: "2026-03-10T10:01:00.000Z",
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null, failedRun: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("published", { embedding: undefined })} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Failed to Embed")).toBeInTheDocument();
    expect(screen.getByText("Embedding request failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Embedding" })).toBeInTheDocument();
    expect(screen.queryByText("Pipeline Failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-processing-inline-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("aip-pdf-container")).toBeInTheDocument();
  });

  it("dispatches embed retry without requiring router refresh", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/barangay/aips/aip-001/embed/retry")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            reason: "failed",
            message: "Search indexing retry dispatched.",
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ run: null, failedRun: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AipDetailView
        aip={baseAip("published", {
          embedding: {
            runId: "run-embed-old",
            status: "failed",
            progressMessage: null,
            errorMessage: "Previous embedding failed.",
            overallProgressPct: null,
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry Embedding" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([request]) =>
          String(request).includes("/api/barangay/aips/aip-001/embed/retry")
        )
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByText("Embedding retry dispatched.")).toBeInTheDocument();
    });
    expect(screen.getByText("Currently Embedding")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("hides reviewer feedback history for published AIP with no feedback cycles", async () => {
    render(
      <AipDetailView
        aip={baseAip("published", {
          revisionFeedbackCycles: [],
          publishedBy: {
            reviewerId: "city-user-001",
            reviewerName: "City Reviewer",
            createdAt: "2026-01-02T08:30:00.000Z",
          },
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Published Status")).toBeInTheDocument();
    expect(screen.getByText("Publication Details")).toBeInTheDocument();
    expect(screen.queryByText("Reviewer Feedback History")).not.toBeInTheDocument();
  });

  it("shows actionable sidebar for draft with revision history", async () => {
    render(
      <AipDetailView
        aip={baseAip("draft", {
          revisionFeedbackCycles: [revisionCycle()],
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Official Comment / Justification")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Reply" })).toBeInTheDocument();
    expect(screen.getByText("Reviewer Feedback History")).toBeInTheDocument();
  });

  it("hides right sidebar for draft without revision history", async () => {
    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Official Comment / Justification")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewer Feedback History")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft Status")).not.toBeInTheDocument();
  });

  it("shows city submit and publish CTA for draft", async () => {
    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Submit & Publish" })).toBeInTheDocument();
    const firstFetchPath = ((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] ?? "") as string;
    expect(firstFetchPath).toContain("/api/city/aips/");
  });

  it("enables project pagination for both barangay and city detail views", async () => {
    const { rerender } = render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });
    expect(lastDetailsTableProps).toEqual({
      scope: "barangay",
      enablePagination: true,
    });

    rerender(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(lastDetailsTableProps).toEqual({
        scope: "city",
        enablePagination: true,
      });
    });
  });

  it("opens draft delete confirmation and deletes barangay draft", async () => {
    const actions = await import("../actions/aip-workflow.actions");
    const deleteDraftAction = vi.mocked(actions.deleteAipDraftAction);

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    expect(screen.getByText("Delete Draft AIP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));

    await waitFor(() => {
      expect(deleteDraftAction).toHaveBeenCalledWith({ aipId: "aip-001" });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/barangay/aips");
    });
  });

  it("opens draft delete confirmation and deletes city draft", async () => {
    const actions = await import("../actions/aip-workflow.actions");
    const deleteDraftAction = vi.mocked(actions.deleteAipDraftAction);

    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    expect(screen.getByText("Delete Draft AIP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));

    await waitFor(() => {
      expect(deleteDraftAction).toHaveBeenCalledWith({ aipId: "aip-001" });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/city/aips");
    });
  });

  it("shows city submit and publish CTA for for_revision", async () => {
    render(
      <AipDetailView
        aip={baseAip("for_revision", { scope: "city" })}
        scope="city"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Submit & Publish" })).toBeInTheDocument();
  });

  it("opens city publish confirmation and submits publish action", async () => {
    const actions = await import("../actions/aip-workflow.actions");
    const publishAction = vi.mocked(actions.submitCityAipForPublishAction);

    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    const submitButton = screen.getByRole("button", { name: "Submit & Publish" });
    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    fireEvent.click(submitButton);
    expect(screen.getByText("Publish AIP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm & Publish" }));

    await waitFor(() => {
      expect(publishAction).toHaveBeenCalledWith({ aipId: "aip-001" });
    });
  });

  it("shows unresolved AI advisory message for city submit", async () => {
    mockProjectsState = {
      rows: [
        flaggedProject("project-001", "REF-001", "Flagged project 1"),
        flaggedProject("project-002", "REF-002", "Flagged project 2"),
        flaggedProject("project-003", "REF-003", "Flagged project 3"),
        flaggedProject("project-004", "REF-004", "Flagged project 4"),
        flaggedProject("project-005", "REF-005", "Flagged project 5"),
        flaggedProject("project-006", "REF-006", "Flagged project 6"),
      ],
      loading: false,
      error: null,
      unresolvedAiCount: 6,
    };

    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "6 AI-flagged project(s) have not been addressed with an LGU feedback note yet. You may still continue, but citizens will see these as unaddressed."
        )
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "REF-001" })).toHaveAttribute(
      "href",
      "/city/aips/aip-001/project-001"
    );
    expect(screen.getByRole("link", { name: "REF-005" })).toHaveAttribute(
      "href",
      "/city/aips/aip-001/project-005"
    );
    expect(screen.queryByRole("link", { name: "REF-006" })).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "REF-006" })).toHaveAttribute(
      "href",
      "/city/aips/aip-001/project-006"
    );
    expect(screen.queryByRole("link", { name: "REF-001" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "REF-001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit & Publish" })).toBeEnabled();
  });

  it("does not show flagged-project pagination controls when unresolved list is 5 or fewer", async () => {
    mockProjectsState = {
      rows: [
        flaggedProject("project-001", "REF-001", "Flagged project 1"),
        flaggedProject("project-002", "REF-002", "Flagged project 2"),
        flaggedProject("project-003", "REF-003", "Flagged project 3"),
      ],
      loading: false,
      error: null,
      unresolvedAiCount: 3,
    };

    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "3 AI-flagged project(s) have not been addressed with an LGU feedback note yet. You may still continue, but citizens will see these as unaddressed."
        )
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "REF-001" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "REF-003" })).toBeInTheDocument();
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });

  it("shows failed-run notice from active lookup and hides city detail UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/city/aips/aip-001/runs/active")) {
          return new Response(
            JSON.stringify({
              run: null,
              failedRun: {
                runId: "run-failed-001",
                aipId: "aip-001",
                stage: "extract",
                status: "failed",
                errorMessage: "Extraction exceeded timeout (1800.00s) after 91 page(s).",
                createdAt: "2026-02-21T00:04:00.000Z",
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null, failedRun: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft", { scope: "city" })} scope="city" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("breadcrumb-nav")).toBeInTheDocument();
    expect(screen.getByText("Annual Investment Program 2026")).toBeInTheDocument();
    expect(screen.getByText("Pipeline Failed")).toBeInTheDocument();
    expect(screen.getByText("Completed stages:")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Failed at:")).toBeInTheDocument();
    expect(screen.getByText("Extraction")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart from Extraction Stage" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Scratch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-pdf-container")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-details-table-view")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit & Publish" })).not.toBeInTheDocument();
  });

  it("tracks run updates via realtime and clears run query after success", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting from snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(
      <AipDetailView
        aip={baseAip("draft", {
          summaryText: "Summary already available.",
        })}
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "extract",
          status: "running",
          error_message: null,
          overall_progress_pct: 15,
          stage_progress_pct: 35,
          progress_message: "Extracting...",
          progress_updated_at: "2026-02-21T00:01:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "categorize",
          status: "succeeded",
          error_message: null,
          overall_progress_pct: 100,
          stage_progress_pct: 100,
          progress_message: null,
          progress_updated_at: "2026-02-21T00:03:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/barangay/aips/aip-001", {
        scroll: false,
      });
    });
  });

  it("clears run query after city realtime success using city pathname", async () => {
    mockPathname = "/city/aips/aip-001";
    mockSearchParams = new URLSearchParams("run=run-001");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/city/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting city snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(
      <AipDetailView
        aip={baseAip("draft", {
          scope: "city",
          summaryText: "Summary already available.",
        })}
        scope="city"
      />
    );

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "categorize",
          status: "succeeded",
          error_message: null,
          overall_progress_pct: 100,
          stage_progress_pct: 100,
          progress_message: null,
          progress_updated_at: "2026-02-21T00:03:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/city/aips/aip-001", {
        scroll: false,
      });
    });
  });

  it("does not refresh while run query is still present during finalization", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting from snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "categorize",
          status: "succeeded",
          error_message: null,
          overall_progress_pct: 100,
          stage_progress_pct: 100,
          progress_message: null,
          progress_updated_at: "2026-02-21T00:03:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/barangay/aips/aip-001", {
        scroll: false,
      });
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("auto-cleans stale run query on 404 and shows latest AIP details notice", async () => {
    mockSearchParams = new URLSearchParams("run=run-stale-001");
    mockReplace.mockImplementation((nextUrl: string) => {
      const rawQuery = nextUrl.includes("?") ? nextUrl.split("?")[1] : "";
      mockSearchParams = new URLSearchParams(rawQuery);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-stale-001")) {
          return new Response(JSON.stringify({ message: "Run not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/barangay/aips/aip-001/runs/active")) {
          return new Response(JSON.stringify({ run: null, failedRun: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/barangay/aips/aip-001", {
        scroll: false,
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("aip-processing-inline-status")).not.toBeInTheDocument();
    });

    expect(
      screen.getByText("This run link is no longer active. Showing the latest AIP details.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("aip-pdf-container")).toBeInTheDocument();
  });

  it("shows failed-run focused layout with stage context and dual retry actions", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting from snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "summarize",
          status: "failed",
          error_message: "Extraction exceeded timeout (1800.00s) after 91 page(s).",
          overall_progress_pct: 36,
          stage_progress_pct: 91,
          progress_message: "Extraction exceeded timeout (1800.00s) after 91 page(s).",
          progress_updated_at: "2026-02-21T00:04:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("Pipeline Failed")).toBeInTheDocument();
    });

    expect(screen.getByTestId("breadcrumb-nav")).toBeInTheDocument();
    expect(screen.getByText("Annual Investment Program 2026")).toBeInTheDocument();
    expect(screen.getByText("Completed stages:")).toBeInTheDocument();
    expect(screen.getByText("Extraction > Validation")).toBeInTheDocument();
    expect(screen.getByText("Failed at:")).toBeInTheDocument();
    expect(screen.getByText("Summarization")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart from Summarization Stage" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart from Scratch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-pdf-container")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aip-details-table-view")).not.toBeInTheDocument();
  });

  it("keeps failed-stage retry flow working from failed-run focused layout", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    const retryResponse = createDeferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001/retry")) {
          return retryResponse.promise;
        }
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting from snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "extract",
          status: "failed",
          error_message: "Extraction exceeded timeout (1800.00s) after 91 page(s).",
          overall_progress_pct: 36,
          stage_progress_pct: 91,
          progress_message: "Extraction exceeded timeout (1800.00s) after 91 page(s).",
          progress_updated_at: "2026-02-21T00:04:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Restart from Extraction Stage" })
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Restart from Extraction Stage" })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restarting..." })).toBeInTheDocument();
    });

    const retryCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => String(args[0]).includes("/api/barangay/aips/runs/run-001/retry")
    );
    expect(retryCall).toBeDefined();
    expect(retryCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((retryCall?.[1] as RequestInit).body))).toEqual({
      retryMode: "failed_stage",
    });

    retryResponse.resolve(
      new Response(
        JSON.stringify({
          runId: "run-002",
          status: "queued",
          aipId: "aip-001",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("sends scratch retry mode when restarting from scratch", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001/retry")) {
          return new Response(
            JSON.stringify({
              runId: "run-003",
              status: "queued",
              aipId: "aip-001",
              retryMode: "scratch",
              resumeFromStage: "extract",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "extract",
              status: "running",
              errorMessage: null,
              overallProgressPct: 10,
              stageProgressPct: 25,
              progressMessage: "Extracting from snapshot...",
              progressUpdatedAt: "2026-02-21T00:00:30.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    act(() => {
      latestRealtimeArgs?.onRunEvent?.({
        eventType: "UPDATE",
        run: {
          id: "run-001",
          aip_id: "aip-001",
          stage: "validate",
          status: "failed",
          error_message: "Validation failed.",
          overall_progress_pct: 50,
          stage_progress_pct: 10,
          progress_message: "Validation failed.",
          progress_updated_at: "2026-02-21T00:04:00.000Z",
        },
      } as ExtractionRunRealtimeEvent);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restart from Scratch" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Restart from Scratch" }));

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    const retryCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => String(args[0]).includes("/api/barangay/aips/runs/run-001/retry")
    );
    expect(retryCall).toBeDefined();
    expect(retryCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((retryCall?.[1] as RequestInit).body))).toEqual({
      retryMode: "scratch",
    });
  });

  it("shows a non-blocking notice when realtime status tracking fails", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/barangay/aips/runs/run-001")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              aipId: "aip-001",
              stage: "validate",
              status: "running",
              errorMessage: null,
              overallProgressPct: 62,
              stageProgressPct: 80,
              progressMessage: "Validating snapshot...",
              progressUpdatedAt: "2026-02-21T00:01:00.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ run: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
    });

    act(() => {
      latestRealtimeArgs?.onStatusChange?.("CHANNEL_ERROR" as never);
    });

    expect(latestRealtimeArgs?.onSubscribeError).toBeTypeOf("function");
    act(() => {
      latestRealtimeArgs?.onSubscribeError?.(new Error("channel error"));
    });

    expect(latestRealtimeArgs?.onStatusChange).toBeTypeOf("function");
    expect(screen.getByTestId("aip-processing-inline-status")).toBeInTheDocument();
  });

  it("rehydrates run snapshot when realtime reconnects", async () => {
    mockSearchParams = new URLSearchParams("run=run-001");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/barangay/aips/runs/run-001")) {
        return new Response(
          JSON.stringify({
            runId: "run-001",
            aipId: "aip-001",
            stage: "summarize",
            status: "running",
            errorMessage: null,
            overallProgressPct: 74,
            stageProgressPct: 40,
            progressMessage: "Reconnect snapshot...",
            progressUpdatedAt: "2026-02-21T00:02:00.000Z",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ run: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(latestRealtimeArgs?.enabled).toBe(true);
    });

    const callsBeforeReconnect = fetchMock.mock.calls.length;
    act(() => {
      latestRealtimeArgs?.onStatusChange?.("SUBSCRIBED" as never);
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeReconnect);
    });
  });

  it("shows workflow and citizen feedback containers in feedback tab when published", async () => {
    mockSearchParams = new URLSearchParams("tab=comments&thread=thread-1");
    render(<AipDetailView aip={baseAip("published")} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("No workflow feedback history yet.")).toBeInTheDocument();
    expect(screen.getByText("Citizen Feedback")).toBeInTheDocument();
    expect(screen.getByTestId("lgu-aip-feedback-thread")).toBeInTheDocument();
  });

  it("hides citizen feedback container in feedback tab before publish", async () => {
    mockSearchParams = new URLSearchParams("tab=comments");
    render(<AipDetailView aip={baseAip("draft")} scope="barangay" />);

    await waitFor(() => {
      expect(screen.queryByText("Checking extraction status...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("No workflow feedback history yet.")).toBeInTheDocument();
    expect(screen.queryByText("Citizen Feedback")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lgu-aip-feedback-thread")).not.toBeInTheDocument();
  });
});
