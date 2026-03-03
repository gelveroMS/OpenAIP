import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCitizenChatbot } from "./hooks/use-citizen-chatbot";

const mockReplace = vi.fn();
const mockOnAuthStateChange = vi.fn();

const mockRepo = {
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  listMessages: vi.fn(),
  appendUserMessage: vi.fn(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/ai-assistant",
  useRouter: () => ({
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  }),
}));

vi.mock("@/lib/repos/citizen-chat/repo", () => ({
  getCitizenChatRepo: () => mockRepo,
}));

describe("useCitizenChatbot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });
    mockRepo.listSessions.mockResolvedValue([]);
    mockRepo.listMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands authenticated users in a new-chat state even when sessions exist", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockRepo.listSessions.mockResolvedValue([
      {
        id: "session-1",
        userId: "citizen-1",
        title: "Budget Q&A",
        context: {},
        lastMessageAt: "2026-03-01T00:00:00.000Z",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, isComplete: true, userId: "citizen-1" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.isBootstrapping).toBe(false);
    });

    expect(result.current.composerMode).toBe("send");
    expect(result.current.activeSessionId).toBeNull();
    expect(result.current.sessionItems).toHaveLength(1);
    expect(mockRepo.listSessions).toHaveBeenCalledWith("citizen-1");
  });

  it("uses sign-in composer mode for anonymous users and opens auth modal query", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: { message: "Authentication required." } }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.isBootstrapping).toBe(false);
    });

    expect(result.current.composerMode).toBe("sign_in");
    expect(result.current.sessionItems).toHaveLength(0);
    expect(mockRepo.listSessions).not.toHaveBeenCalled();

    act(() => {
      result.current.handleComposerPrimaryAction();
    });

    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("auth=login"), { scroll: false });
  });

  it("uses complete-profile composer mode for signed-in incomplete profiles", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, isComplete: false, userId: "citizen-2" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.isBootstrapping).toBe(false);
    });

    expect(result.current.composerMode).toBe("complete_profile");

    act(() => {
      result.current.handleComposerPrimaryAction();
    });

    const href = String(mockReplace.mock.calls.at(-1)?.[0] ?? "");
    expect(href).toContain("completeProfile=1");
    expect(href).not.toContain("auth=login");
  });

  it("reacts to auth-sync event from authenticated to anonymous", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, isComplete: true, userId: "citizen-4" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: { message: "Authentication required." } }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    mockRepo.listSessions.mockResolvedValue([
      {
        id: "session-4",
        userId: "citizen-4",
        title: "Existing Session",
        context: {},
        lastMessageAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.composerMode).toBe("send");
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("openaip:citizen-auth-changed"));
    });

    await waitFor(() => {
      expect(result.current.composerMode).toBe("sign_in");
    });
    expect(result.current.sessionItems).toHaveLength(0);
  });

  it("reacts to auth-sync event from anonymous to authenticated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: { message: "Authentication required." } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, isComplete: true, userId: "citizen-5" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    mockRepo.listSessions.mockResolvedValue([
      {
        id: "session-5",
        userId: "citizen-5",
        title: "Recovered Session",
        context: {},
        lastMessageAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.composerMode).toBe("sign_in");
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("openaip:citizen-auth-changed"));
    });

    await waitFor(() => {
      expect(result.current.composerMode).toBe("send");
    });
    expect(result.current.sessionItems).toHaveLength(1);
  });

  it("disables sending and shows blocked placeholder when citizen is blocked", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        isComplete: true,
        userId: "citizen-10",
        isBlocked: true,
        blockedUntil: "2026-03-20",
        blockedReason: "Policy violation",
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCitizenChatbot());

    await waitFor(() => {
      expect(result.current.isBootstrapping).toBe(false);
    });

    expect(result.current.composerMode).toBe("send");
    expect(result.current.isComposerDisabled).toBe(true);
    expect(result.current.composerPlaceholder).toContain(
      "temporarily blocked from using the AI Assistant"
    );
  });
});
