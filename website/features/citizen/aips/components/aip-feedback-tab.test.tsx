import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AipFeedbackTab from "./aip-feedback-tab";

const mockListAipFeedback = vi.fn();
const mockCreateCitizenAipFeedback = vi.fn();
const mockCreateCitizenAipFeedbackReply = vi.fn();
const mockPush = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockGetUser = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
  }),
  usePathname: () => "/citizen/aips/aip-1",
  useSearchParams: () => ({
    toString: () => "",
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  }),
}));

vi.mock("./aip-feedback.api", async () => {
  const actual = await vi.importActual<typeof import("./aip-feedback.api")>("./aip-feedback.api");
  return {
    ...actual,
    listAipFeedback: (...args: unknown[]) => mockListAipFeedback(...args),
    createCitizenAipFeedback: (...args: unknown[]) => mockCreateCitizenAipFeedback(...args),
    createCitizenAipFeedbackReply: (...args: unknown[]) =>
      mockCreateCitizenAipFeedbackReply(...args),
  };
});

describe("AipFeedbackTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/profile/status") {
          return {
            ok: false,
            status: 401,
            json: async () => ({ ok: false, error: { message: "Authentication required." } }),
          } as Response;
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      })
    );
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockOnAuthStateChange.mockImplementation(
      () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })
    );
    mockListAipFeedback.mockResolvedValue({
      items: [
        {
          id: "fb-hidden-lgu",
          aipId: "aip-1",
          parentFeedbackId: null,
          kind: "lgu_note",
          isHidden: true,
          body: "This comment has been hidden due to policy violation.",
          createdAt: "2026-03-01T00:00:00.000Z",
          author: {
            id: "official-1",
            fullName: "Citizen User",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Sample",
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides LGU Note badge and applies hidden comment styling", async () => {
    render(<AipFeedbackTab aipId="aip-1" feedbackCount={1} />);

    await waitFor(() => {
      expect(screen.getByText("This comment has been hidden due to policy violation.")).toBeInTheDocument();
    });

    expect(screen.queryByText("LGU Note")).not.toBeInTheDocument();
    expect(screen.getByText("Hidden comment")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reply to feedback from Citizen User/i })
    ).not.toBeInTheDocument();
    const hiddenCard = screen
      .getByText("This comment has been hidden due to policy violation.")
      .closest("article");
    expect(hiddenCard).toHaveAttribute("data-hidden-comment", "true");
  });

  it("hides reply button for nested feedback items", async () => {
    mockListAipFeedback.mockResolvedValueOnce({
      items: [
        {
          id: "fb-root",
          aipId: "aip-1",
          parentFeedbackId: null,
          kind: "question",
          isHidden: false,
          body: "Root feedback",
          createdAt: "2026-03-01T00:00:00.000Z",
          author: {
            id: "citizen-root",
            fullName: "Root User",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Root",
          },
        },
        {
          id: "fb-reply",
          aipId: "aip-1",
          parentFeedbackId: "fb-root",
          kind: "question",
          isHidden: false,
          body: "Nested feedback",
          createdAt: "2026-03-01T01:00:00.000Z",
          author: {
            id: "citizen-reply",
            fullName: "Nested User",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Nested",
          },
        },
      ],
    });

    render(<AipFeedbackTab aipId="aip-1" feedbackCount={2} />);

    await waitFor(() => {
      expect(screen.getByText("Nested feedback")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Reply to feedback from Root User/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reply to feedback from Nested User/i })
    ).not.toBeInTheDocument();
  });

  it("shows blocked notice and hides feedback composer for blocked citizens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/profile/status") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              isComplete: true,
              userId: "citizen-1",
              isBlocked: true,
              blockedUntil: "2026-03-12",
              blockedReason: "Abusive language",
            }),
          } as Response;
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      })
    );

    render(<AipFeedbackTab aipId="aip-1" feedbackCount={1} />);

    await waitFor(() => {
      expect(
        screen.getByText("Your account is temporarily blocked from posting feedback.")
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /Post feedback/i })).not.toBeInTheDocument();
  });
});
