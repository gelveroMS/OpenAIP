import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLguChatbot } from "./use-lgu-chatbot";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useLguChatbot sending state flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("switches from sending to awaiting and marks optimistic user message as sent", async () => {
    const sendDeferred = createDeferred<Response>();

    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/barangay/chat/sessions") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            sessions: [
              {
                id: "session-1",
                userId: "user-1",
                title: "Budget Chat",
                context: {},
                lastMessageAt: null,
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            ],
          })
        );
      }

      if (url.endsWith("/api/barangay/chat/sessions/session-1/messages") && method === "GET") {
        return Promise.resolve(jsonResponse({ messages: [] }));
      }

      if (url.endsWith("/api/barangay/chat/messages") && method === "POST") {
        return sendDeferred.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLguChatbot("/api/barangay/chat"));

    await waitFor(() => {
      expect(result.current.isSessionsLoading).toBe(false);
      expect(result.current.activeSessionId).toBe("session-1");
    });

    act(() => {
      result.current.setMessageInput("What is our FY 2026 budget?");
    });

    act(() => {
      void result.current.handleSend();
    });

    await waitFor(() => {
      expect(result.current.isAwaitingAssistant).toBe(true);
      expect(result.current.isSending).toBe(false);
      expect(result.current.bubbles).toHaveLength(1);
      expect(result.current.bubbles[0]?.deliveryStatus).toBe("sent");
    });

    await act(async () => {
      sendDeferred.resolve(
        jsonResponse({
          sessionId: "session-1",
          userMessage: {
            id: "user-msg-1",
            sessionId: "session-1",
            role: "user",
            content: "What is our FY 2026 budget?",
            createdAt: "2026-03-01T00:00:10.000Z",
            citations: null,
            retrievalMeta: null,
          },
          assistantMessage: {
            id: "assistant-msg-1",
            sessionId: "session-1",
            role: "assistant",
            content: "The FY 2026 total is ...",
            createdAt: "2026-03-01T00:00:20.000Z",
            citations: [],
            retrievalMeta: { status: "answer", refused: false, reason: "ok" },
          },
        })
      );
    });

    await waitFor(() => {
      expect(result.current.isAwaitingAssistant).toBe(false);
      expect(result.current.bubbles).toHaveLength(2);
      expect(result.current.bubbles[1]?.role).toBe("assistant");
    });
  });

  it("marks optimistic messages as failed when the send request fails", async () => {
    const sendDeferred = createDeferred<Response>();

    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/barangay/chat/sessions") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            sessions: [
              {
                id: "session-1",
                userId: "user-1",
                title: "Budget Chat",
                context: {},
                lastMessageAt: null,
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            ],
          })
        );
      }

      if (url.endsWith("/api/barangay/chat/sessions/session-1/messages") && method === "GET") {
        return Promise.resolve(jsonResponse({ messages: [] }));
      }

      if (url.endsWith("/api/barangay/chat/messages") && method === "POST") {
        return sendDeferred.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLguChatbot("/api/barangay/chat"));

    await waitFor(() => {
      expect(result.current.isSessionsLoading).toBe(false);
      expect(result.current.activeSessionId).toBe("session-1");
    });

    act(() => {
      result.current.setMessageInput("Show missing data");
    });

    act(() => {
      void result.current.handleSend();
    });

    await waitFor(() => {
      expect(result.current.isAwaitingAssistant).toBe(true);
    });

    await act(async () => {
      sendDeferred.reject(new Error("Request failed."));
    });

    await waitFor(() => {
      expect(result.current.isAwaitingAssistant).toBe(false);
      expect(result.current.error).toBe("Request failed.");
      expect(result.current.bubbles).toHaveLength(1);
      expect(result.current.bubbles[0]?.deliveryStatus).toBe("failed");
    });
  });
});
