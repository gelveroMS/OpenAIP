import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackThread } from "./feedback-thread";

const mockListProjectFeedback = vi.fn();
const mockCreateProjectFeedback = vi.fn();
const mockCreateProjectFeedbackReply = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
  usePathname: () => "/projects/infrastructure/proj-1",
  useSearchParams: () => ({
    toString: () => "",
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  }),
}));

vi.mock("./feedback.api", async () => {
  const actual = await vi.importActual<typeof import("./feedback.api")>("./feedback.api");
  return {
    ...actual,
    listProjectFeedback: (...args: unknown[]) => mockListProjectFeedback(...args),
    createProjectFeedback: (...args: unknown[]) => mockCreateProjectFeedback(...args),
    createProjectFeedbackReply: (...args: unknown[]) => mockCreateProjectFeedbackReply(...args),
  };
});

describe("FeedbackThread auth status loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjectFeedback.mockResolvedValue({ items: [] });
    mockOnAuthStateChange.mockImplementation(
      (callback: (event: string, session: { user: { id: string } } | null) => void) => {
        callback("INITIAL_SESSION", null);
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(),
            },
          },
        };
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /profile/status once when INITIAL_SESSION is emitted", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, isComplete: true, userId: "citizen-1" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<FeedbackThread projectId="proj-1" />);

    await waitFor(() => {
      expect(mockListProjectFeedback).toHaveBeenCalledWith("proj-1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith("/profile/status", {
      method: "GET",
      cache: "no-store",
    });
  });

  it("revalidates auth state when auth-sync event is dispatched", async () => {
    let isSignedIn = false;
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async () => {
      if (!isSignedIn) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ ok: false, error: { message: "Authentication required." } }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, isComplete: true, userId: "citizen-2" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeedbackThread projectId="proj-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    isSignedIn = true;
    window.dispatchEvent(new CustomEvent("openaip:citizen-auth-changed"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows blocked notice and hides feedback composer when citizen is blocked", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        isComplete: true,
        userId: "citizen-9",
        isBlocked: true,
        blockedUntil: "2026-03-10",
        blockedReason: "Abusive comments",
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<FeedbackThread projectId="proj-1" />);

    await waitFor(() => {
      expect(mockListProjectFeedback).toHaveBeenCalledWith("proj-1");
    });

    expect(
      screen.getByText("Your account is temporarily blocked from posting feedback.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Add project feedback")).not.toBeInTheDocument();
  });
});
