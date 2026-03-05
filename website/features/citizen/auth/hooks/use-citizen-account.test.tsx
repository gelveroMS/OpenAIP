import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCitizenAccount } from "./use-citizen-account";
import { invalidateCitizenProfileStatusCache } from "@/features/citizen/auth/utils/profile-status-client";

const mockOnAuthStateChange = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  }),
}));

function createProfilePayload() {
  return {
    ok: true,
    fullName: "Juan Dela Cruz",
    email: "juan@example.com",
    firstName: "Juan",
    lastName: "Dela Cruz",
    barangay: "Barangay Uno",
    city: "Cabuyao",
    province: "Laguna",
  };
}

type ProfileStatusPayload = {
  ok?: boolean;
  isComplete?: boolean;
  userId?: string;
  error?: { message?: string };
};

function createFetchMock(input: {
  statusPayload: ProfileStatusPayload | null;
  statusCode?: number;
  profilePayload?: Record<string, unknown> | null;
  profileCode?: number;
}) {
  return vi.fn(async (url: string) => {
    if (url === "/profile/status") {
      return {
        ok: (input.statusCode ?? 200) >= 200 && (input.statusCode ?? 200) < 300,
        status: input.statusCode ?? 200,
        json: async () => input.statusPayload,
      } as Response;
    }

    if (url === "/profile/me") {
      return {
        ok: (input.profileCode ?? 200) >= 200 && (input.profileCode ?? 200) < 300,
        status: input.profileCode ?? 200,
        json: async () => input.profilePayload ?? createProfilePayload(),
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

describe("useCitizenAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCitizenProfileStatusCache();
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores INITIAL_SESSION callback and fetches profile from status+me on mount", async () => {
    const unsubscribe = vi.fn();
    const fetchMock = createFetchMock({
      statusPayload: { ok: true, isComplete: true, userId: "citizen-1" },
    });
    mockOnAuthStateChange.mockImplementation(
      (callback: (event: string, session: { user: { id: string } } | null) => void) => {
        callback("INITIAL_SESSION", { user: { id: "citizen-1" } });
        return {
          data: {
            subscription: {
              unsubscribe,
            },
          },
        };
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useCitizenAccount());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/profile/me",
        expect.objectContaining({ method: "GET", cache: "no-store" })
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/profile/status",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refresh calls", async () => {
    const fetchMock = createFetchMock({
      statusPayload: { ok: true, isComplete: true, userId: "citizen-1" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenAccount());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    fetchMock.mockClear();

    await act(async () => {
      await Promise.all([result.current.refresh(), result.current.refresh()]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/profile/status");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/profile/me");
  });

  it("handles incomplete profile as authenticated with null profile", async () => {
    const fetchMock = createFetchMock({
      statusPayload: { ok: true, isComplete: false, userId: "citizen-2" },
      profileCode: 404,
      profilePayload: { ok: false, error: { message: "Citizen profile not found." } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenAccount());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("updates to signed-out state on auth-sync event without manual refresh", async () => {
    let isSignedIn = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/profile/status") {
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
          json: async () => ({ ok: true, isComplete: true, userId: "citizen-3" }),
        } as Response;
      }

      if (url === "/profile/me") {
        return {
          ok: true,
          status: 200,
          json: async () => createProfilePayload(),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenAccount());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    isSignedIn = false;
    act(() => {
      window.dispatchEvent(new CustomEvent("openaip:citizen-auth-changed"));
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });
    expect(result.current.profile).toBeNull();
  });
});
