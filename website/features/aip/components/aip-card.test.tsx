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
