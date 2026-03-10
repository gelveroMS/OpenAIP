import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsInbox from "@/features/notifications/components/notifications-inbox";

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockOnAuthStateChange = vi.fn();
const authState = vi.hoisted(() => ({
  callback:
    undefined as
      | ((event: string, session: { user: { id: string } } | null) => void)
      | undefined,
}));
const realtimeState = vi.hoisted(() => ({
  userId: null as string | null,
  onEvent: undefined as ((event: unknown) => void) | undefined,
  onStatusChange: undefined as ((status: string) => void) | undefined,
}));

vi.mock("next/link", () => ({
  default: (props: { children: ReactNode; href: string; className?: string }) => (
    <a href={props.href} className={props.className}>
      {props.children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/notifications",
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

vi.mock("@/lib/security/csrf", () => ({
  withCsrfHeader: (init: RequestInit) => init,
}));

vi.mock("@/features/notifications/realtime-listener", () => ({
  default: (props: {
    userId?: string | null;
    onEvent?: (event: unknown) => void;
    onStatusChange?: (status: string) => void;
  }) => {
    realtimeState.userId = props.userId ?? null;
    realtimeState.onEvent = props.onEvent;
    realtimeState.onStatusChange = props.onStatusChange;
    return null;
  },
}));

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe("NotificationsInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.callback = undefined;
    realtimeState.userId = null;
    realtimeState.onEvent = undefined;
    realtimeState.onStatusChange = undefined;
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-123" } } },
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });
    mockOnAuthStateChange.mockImplementation(
      (callback: (event: string, session: { user: { id: string } } | null) => void) => {
        authState.callback = callback;
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

  it("renders all and unread counts on initial load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              event_type: "AIP_SUBMITTED",
              recipient_role: "city_official",
              scope_type: "city",
              title: "Submission updated",
              message: "AIP submission was returned for revision.",
              action_url: "/city/submissions/aip/aip-1",
              metadata: {
                fiscal_year: 2026,
                barangay_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              event_type: "AIP_CLAIMED",
              recipient_role: "barangay_official",
              scope_type: "barangay",
              title: "Read item",
              message: "The city reviewer approved the update.",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                lgu_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-02T00:00:00.000Z",
              read_at: "2026-03-03T00:00:00.000Z",
            },
          ],
          offset: 0,
          limit: 20,
          total: 7,
          hasNext: false,
          nextOffset: null,
        });
      }

      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount: 1 });
      }

      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox title="All Notifications" />);

    expect((await screen.findAllByText("AIP submitted")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "All (7)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unread (1)" })).toBeInTheDocument();
    });
    expect(screen.getByText("Showing 7 notifications")).toBeInTheDocument();
  });

  it("switches to the unread tab using the unread API filter", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              event_type: "AIP_REVISION_REQUESTED",
              recipient_role: "barangay_official",
              scope_type: "barangay",
              title: "Unread item",
              message: "Unread review note.",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                lgu_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              event_type: "AIP_CLAIMED",
              recipient_role: "barangay_official",
              scope_type: "barangay",
              title: "Read item",
              message: "Already read update.",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                lgu_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-02T00:00:00.000Z",
              read_at: "2026-03-03T00:00:00.000Z",
            },
          ],
          offset: 0,
          limit: 20,
          total: 2,
          hasNext: false,
          nextOffset: null,
        });
      }

      if (url === "/api/notifications?offset=0&limit=20&status=unread") {
        return okJson({
          items: [
            {
              id: "notif-1",
              event_type: "AIP_REVISION_REQUESTED",
              recipient_role: "barangay_official",
              scope_type: "barangay",
              title: "Unread item",
              message: "Unread review note.",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                lgu_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
          ],
          offset: 0,
          limit: 20,
          total: 1,
          hasNext: false,
          nextOffset: null,
        });
      }

      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount: 1 });
      }

      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    await screen.findByText("Revision requested for AIP");
    fireEvent.click(screen.getByRole("button", { name: "Unread (1)" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications?offset=0&limit=20&status=unread",
        expect.objectContaining({ method: "GET" })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("AIP claimed for review")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Revision requested for AIP")).toBeInTheDocument();
  });

  it("renders fully clickable cards with destination read-tracking query params", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              event_type: "AIP_SUBMITTED",
              recipient_role: "city_official",
              scope_type: "city",
              title: "Unread item",
              message: "Pending review item.",
              action_url: "/city/submissions/aip/aip-1",
              metadata: {
                fiscal_year: 2026,
                barangay_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
          ],
          offset: 0,
          limit: 20,
          total: 1,
          hasNext: false,
          nextOffset: null,
        });
      }

      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount: 1 });
      }

      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    const cardLink = await screen.findByRole("link", { name: /AIP submitted/i });
    expect(cardLink).toHaveAttribute(
      "href",
      "/city/submissions/aip/aip-1?notificationId=notif-1"
    );
    expect(screen.queryByText("Open related page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
  });

  it("starts realtime listener after delayed auth session availability", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [],
          offset: 0,
          limit: 20,
          total: 0,
          hasNext: false,
          nextOffset: null,
        });
      }
      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount: 0 });
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    await waitFor(() => {
      expect(realtimeState.userId).toBeNull();
    });

    act(() => {
      authState.callback?.("SIGNED_IN", { user: { id: "user-123" } });
    });

    await waitFor(() => {
      expect(realtimeState.userId).toBe("user-123");
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications?offset=0&limit=20&status=all",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  it("refreshes unread count and list on realtime events and reconnect subscribe", async () => {
    let unreadCount = 1;
    let allItems = [
      {
        id: "notif-1",
        event_type: "AIP_SUBMITTED",
        recipient_role: "city_official",
        scope_type: "city",
        title: "Initial item",
        message: "Initial item",
        action_url: null,
        metadata: {
          fiscal_year: 2026,
          barangay_name: "Barangay Uno",
          entity_type: "aip",
        },
        created_at: "2026-03-03T00:00:00.000Z",
        read_at: null,
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: allItems,
          offset: 0,
          limit: 20,
          total: allItems.length,
          hasNext: false,
          nextOffset: null,
        });
      }
      if (url === "/api/notifications?offset=0&limit=20&status=unread") {
        return okJson({
          items: allItems.filter((item) => item.read_at === null),
          offset: 0,
          limit: 20,
          total: unreadCount,
          hasNext: false,
          nextOffset: null,
        });
      }
      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount });
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    await waitFor(() => {
      expect(screen.getAllByText("AIP submitted").length).toBe(1);
    });
    expect(screen.getByRole("button", { name: "Unread (1)" })).toBeInTheDocument();

    act(() => {
      unreadCount = 2;
      allItems = [
        ...allItems,
        {
          id: "notif-2",
          event_type: "AIP_SUBMITTED",
          recipient_role: "city_official",
          scope_type: "city",
          title: "Realtime item",
          message: "Realtime item",
          action_url: null,
          metadata: {
            fiscal_year: 2026,
            barangay_name: "Barangay Uno",
            entity_type: "aip",
          },
          created_at: "2026-03-03T00:01:00.000Z",
          read_at: null,
        },
      ];
      realtimeState.onEvent?.({ eventType: "INSERT" });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unread (2)" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("AIP submitted").length).toBe(2);
    });

    act(() => {
      unreadCount = 3;
      allItems = [
        ...allItems,
        {
          id: "notif-3",
          event_type: "AIP_SUBMITTED",
          recipient_role: "city_official",
          scope_type: "city",
          title: "Reconnect item",
          message: "Reconnect item",
          action_url: null,
          metadata: {
            fiscal_year: 2026,
            barangay_name: "Barangay Uno",
            entity_type: "aip",
          },
          created_at: "2026-03-03T00:02:00.000Z",
          read_at: null,
        },
      ];
      realtimeState.onStatusChange?.("SUBSCRIBED");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unread (3)" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("AIP submitted").length).toBe(3);
    });
  });

  it("marks all notifications as read from the all tab", async () => {
    const unreadCountResponses = [2];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              event_type: "AIP_SUBMITTED",
              recipient_role: "city_official",
              scope_type: "city",
              title: "Unread item 1",
              message: "Unread item 1",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                barangay_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              event_type: "AIP_SUBMITTED",
              recipient_role: "city_official",
              scope_type: "city",
              title: "Unread item 2",
              message: "Unread item 2",
              action_url: null,
              metadata: {
                fiscal_year: 2026,
                barangay_name: "Barangay Uno",
                entity_type: "aip",
              },
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
          ],
          offset: 0,
          limit: 20,
          total: 2,
          hasNext: false,
          nextOffset: null,
        });
      }

      if (url === "/api/notifications/unread-count") {
        return okJson({ unreadCount: unreadCountResponses.shift() ?? 0 });
      }

      if (url === "/api/notifications/read-all") {
        expect(init).toMatchObject({ method: "POST" });
        return okJson({ ok: true });
      }

      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    expect((await screen.findAllByText("AIP submitted")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/read-all",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unread (0)" })).toBeInTheDocument();
    });
  });
});
