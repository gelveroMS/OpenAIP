import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AipHeader } from "../types";
import AipCard from "./aip-card";

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

function makeAip(overrides: Partial<AipHeader> = {}): AipHeader {
  return {
    id: "aip-001",
    scope: "barangay",
    barangayName: "Brgy. Test",
    title: "AIP 2026",
    description: "AIP description",
    year: 2026,
    budget: 1000000,
    uploadedAt: "2026-01-01",
    publishedAt: "2026-01-05",
    status: "published",
    fileName: "AIP_2026_Test.pdf",
    pdfUrl: "https://example.com/aip.pdf",
    sectors: ["General Sector"],
    uploader: {
      name: "Test Uploader",
      role: "Barangay Official",
      uploadDate: "Jan 1, 2026",
      budgetAllocated: 1000000,
    },
    ...overrides,
  };
}

describe("AipCard processing UI", () => {
  it("renders stage pill, metadata, and live progress details for running runs", () => {
    render(
      <AipCard
        aip={makeAip({
          status: "draft",
          uploadedAt: "2026-02-25",
          fileName: "AIP_2026.pdf",
          processing: {
            state: "processing",
            overallProgressPct: 51,
            message: "Extracting pages 13/25...",
            runId: "run-100",
            stage: "extract",
            status: "running",
          },
        })}
      />
    );

    expect(screen.getByText("Extracting")).toBeInTheDocument();
    expect(screen.getByText(/Uploaded: Feb 25, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/File: AIP_2026\.pdf/)).toBeInTheDocument();
    expect(screen.getByText("Overall progress")).toBeInTheDocument();
    expect(screen.getByText("51%")).toBeInTheDocument();
    expect(screen.getByText("Extracting pages 13/25...")).toBeInTheDocument();
  });

  it("renders scale_amounts as validating while preserving the scaling progress message", () => {
    render(
      <AipCard
        aip={makeAip({
          status: "draft",
          processing: {
            state: "processing",
            overallProgressPct: 72,
            message: "Scaling city monetary fields by 1000...",
            runId: "run-scale",
            stage: "scale_amounts",
            status: "running",
          },
        })}
      />
    );

    expect(screen.getByText("Validating")).toBeInTheDocument();
    expect(
      screen.getByText("Scaling city monetary fields by 1000...")
    ).toBeInTheDocument();
    expect(screen.queryByText("Scaling amounts")).not.toBeInTheDocument();
  });

  it("shows queued fallback label and message when run is queued", () => {
    render(
      <AipCard
        aip={makeAip({
          status: "draft",
          processing: {
            state: "processing",
            overallProgressPct: 0,
            message: null,
            runId: "run-queued",
            stage: null,
            status: "queued",
          },
        })}
      />
    );

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Queued for processing...")).toBeInTheDocument();
  });

  it("shows finalizing label and fallback message", () => {
    render(
      <AipCard
        aip={makeAip({
          status: "draft",
          processing: {
            state: "finalizing",
            overallProgressPct: 100,
            message: null,
            runId: "run-finalizing",
            stage: "categorize",
            status: "succeeded",
          },
        })}
      />
    );

    expect(screen.getByText("Finalizing")).toBeInTheDocument();
    expect(screen.getByText("Finalizing processed output...")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("AipCard chatbot readiness status", () => {
  it("shows Chatbot ready when embedding succeeded", () => {
    render(
      <AipCard
        aip={makeAip({
          embedding: {
            runId: "run-ready",
            status: "succeeded",
            progressMessage: null,
            errorMessage: null,
            overallProgressPct: null,
          },
        })}
      />
    );

    expect(screen.getByText("Chatbot ready")).toBeInTheDocument();
  });

  it("shows Currently embedding for queued/running embeddings", () => {
    render(
      <AipCard
        aip={makeAip({
          embedding: {
            runId: "run-embedding",
            status: "running",
            progressMessage: null,
            errorMessage: null,
            overallProgressPct: 42,
          },
        })}
      />
    );

    expect(screen.getByText("Currently embedding")).toBeInTheDocument();
  });

  it("shows Failed to embed for failed embeddings", () => {
    render(
      <AipCard
        aip={makeAip({
          embedding: {
            runId: "run-failed",
            status: "failed",
            progressMessage: null,
            errorMessage: "Embedding failed.",
            overallProgressPct: null,
          },
        })}
      />
    );

    expect(screen.getByText("Failed to embed")).toBeInTheDocument();
  });

  it("shows Needs embedding when no embedding run exists", () => {
    render(<AipCard aip={makeAip({ embedding: undefined })} />);

    expect(screen.getByText("Needs embedding")).toBeInTheDocument();
  });

  it("hides chatbot status for non-published AIPs", () => {
    render(
      <AipCard
        aip={makeAip({
          status: "draft",
          embedding: {
            runId: "run-ready",
            status: "succeeded",
            progressMessage: null,
            errorMessage: null,
            overallProgressPct: null,
          },
        })}
      />
    );

    expect(screen.queryByText("Chatbot ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Currently embedding")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to embed")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs embedding")).not.toBeInTheDocument();
  });
});
