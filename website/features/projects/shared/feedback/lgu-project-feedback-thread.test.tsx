import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LguProjectFeedbackThread } from "./lgu-project-feedback-thread";
import type { ListProjectFeedbackResponse } from "./feedback.types";

const mockListProjectFeedback = vi.fn();
const mockCreateProjectLguFeedbackReply = vi.fn();

vi.mock("./feedback.api", async () => {
  const actual = await vi.importActual<typeof import("./feedback.api")>("./feedback.api");
  return {
    ...actual,
    listProjectFeedback: (...args: unknown[]) => mockListProjectFeedback(...args),
    createProjectLguFeedbackReply: (...args: unknown[]) =>
      mockCreateProjectLguFeedbackReply(...args),
  };
});

function buildResponse(): ListProjectFeedbackResponse {
  return {
    items: [
      {
        id: "root-1",
        projectId: "proj-1",
        parentFeedbackId: null,
        kind: "question",
        body: "Citizen question",
        createdAt: "2026-02-28T08:00:00.000Z",
        author: {
          id: "citizen-1",
          fullName: "Citizen One",
          role: "citizen",
          roleLabel: "Citizen",
          lguLabel: "Brgy. Sample",
        },
      },
      {
        id: "reply-1",
        projectId: "proj-1",
        parentFeedbackId: "root-1",
        kind: "lgu_note",
        isHidden: true,
        body: "Official response",
        createdAt: "2026-02-28T09:00:00.000Z",
        author: {
          id: "official-1",
          fullName: "Official One",
          role: "barangay_official",
          roleLabel: "Barangay Official",
          lguLabel: "Brgy. Sample",
        },
      },
      {
        id: "root-lgu",
        projectId: "proj-1",
        parentFeedbackId: null,
        kind: "lgu_note",
        body: "LGU started thread",
        createdAt: "2026-02-28T10:00:00.000Z",
        author: {
          id: "official-2",
          fullName: "Official Two",
          role: "barangay_official",
          roleLabel: "Barangay Official",
          lguLabel: "Brgy. Sample",
        },
      },
    ],
  };
}

describe("LguProjectFeedbackThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjectFeedback.mockResolvedValue(buildResponse());
    mockCreateProjectLguFeedbackReply.mockResolvedValue({
      item: {
        id: "reply-new",
        projectId: "proj-1",
        parentFeedbackId: "root-1",
        kind: "lgu_note",
        body: "We are on it.",
        createdAt: "2026-02-28T11:00:00.000Z",
        author: {
          id: "official-1",
          fullName: "Official One",
          role: "barangay_official",
          roleLabel: "Barangay Official",
          lguLabel: "Brgy. Sample",
        },
      },
    });
  });

  it("renders citizen-rooted threads only and hides lgu_note badges", async () => {
    render(
      <LguProjectFeedbackThread
        projectId="proj-1"
        scope="barangay"
        selectedThreadId="root-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Citizen question")).toBeInTheDocument();
    });

    expect(screen.queryByText("LGU started thread")).not.toBeInTheDocument();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.queryByText("LGU Note")).not.toBeInTheDocument();
    expect(screen.queryByText("Feedback kind")).not.toBeInTheDocument();
    expect(screen.queryByText("Add feedback")).not.toBeInTheDocument();
    expect(screen.getByText("Hidden comment")).toBeInTheDocument();
    const hiddenCard = screen.getByText("Official response").closest("article");
    expect(hiddenCard).toHaveAttribute("data-hidden-comment", "true");

    const selectedThread = document.querySelector('[data-thread-id="root-1"]');
    expect(selectedThread?.getAttribute("data-thread-selected")).toBe("true");
  });

  it("posts scoped official replies without kind selection", async () => {
    render(<LguProjectFeedbackThread projectId="proj-1" scope="city" />);

    await waitFor(() => {
      expect(screen.getByText("Citizen question")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Reply to feedback/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Write your response..."), {
      target: { value: "We are on it." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await waitFor(() => {
      expect(mockCreateProjectLguFeedbackReply).toHaveBeenCalledWith({
        scope: "city",
        projectId: "proj-1",
        parentFeedbackId: "root-1",
        body: "We are on it.",
      });
    });
  });
});
