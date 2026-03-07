import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsBell from "@/features/notifications/components/notifications-bell";
import type { NotificationRealtimeEvent } from "@/features/notifications/realtime-listener";
import { NOTIFICATION_READ_EVENT } from "@/lib/notifications/read-events";

const mockGetUser = vi.fn();
const realtimeState: { onEvent?: (event: NotificationRealtimeEvent) => void } = {};
const dropdownState = vi.hoisted(() => ({
  open: false,
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
}));

vi.mock("next/link", () => ({
  default: (props: {
    children: ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a
      href={props.href}
      onClick={(event) => {
        event.preventDefault();
        props.onClick?.();
      }}
      className={props.className}
    >
      {props.children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock("@/lib/security/csrf", () => ({
  withCsrfHeader: (init: RequestInit) => init,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => {
    dropdownState.open = Boolean(open);
    dropdownState.onOpenChange = onOpenChange;
    return <>{children}</>;
  },
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <span
      onClick={() => {
        dropdownState.onOpenChange?.(!dropdownState.open);
      }}
    >
      {children}
    </span>
  ),
  DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) =>
    dropdownState.open ? <div className={className}>{children}</div> : null,
}));

vi.mock("@/features/notifications/realtime-listener", () => ({
  default: (props: { onEvent?: (event: NotificationRealtimeEvent) => void }) => {
    realtimeState.onEvent = props.onEvent;
    return null;
  },
}));

describe("NotificationsBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeState.onEvent = undefined;
    dropdownState.open = false;
    dropdownState.onOpenChange = undefined;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });
  });

  it("loads unread count on mount and keeps passed trigger classes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications/unread-count") {
        return {
          ok: true,
          json: async () => ({ unreadCount: 3 }),
        };
      }

      return {
        ok: true,
        json: async () => ({ items: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsBell href="/notifications" className="h-9 w-9" />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Open notifications" })).toHaveClass("h-9", "w-9");
  });

  it("opens the preview, caps unread items at five, and closes when view-all is clicked", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications/unread-count") {
        return {
          ok: true,
          json: async () => ({ unreadCount: 6 }),
        };
      }

      if (url === "/api/notifications?offset=0&limit=5&status=unread") {
        return {
          ok: true,
          json: async () => ({
            items: Array.from({ length: 6 }, (_, index) => ({
              id: `notif-${index + 1}`,
              event_type: "FEEDBACK_CREATED",
              scope_type: "citizen",
              recipient_role: "citizen",
              title: `Title ${index + 1}`,
              message: `Preview item ${index + 1}`,
              action_url: `/notifications/${index + 1}`,
              metadata: {},
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            })),
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsBell href="/notifications" />);

    const trigger = await screen.findByRole("button", { name: "Open notifications" });
    fireEvent.click(trigger);

    expect((await screen.findAllByText("New feedback was posted.")).length).toBe(5);
    const viewAllLink = screen.getByRole("link", { name: "View all notifications" });
    expect(viewAllLink).toHaveAttribute(
      "href",
      "/notifications"
    );
    fireEvent.click(viewAllLink);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "View all notifications" })).not.toBeInTheDocument();
    });
  });

  it("decrements the bell count only after a read-success event", async () => {
    const unreadCountResponses = [1, 0];
    const unreadPreviewResponses = [
      [
        {
          id: "notif-1",
          event_type: "AIP_REVISION_REQUESTED",
          scope_type: "barangay",
          recipient_role: "barangay_official",
          title: "Review update",
          message: "Returned for revision",
          action_url: "/city/projects/1",
          metadata: {
            fiscal_year: 2026,
            lgu_name: "Barangay Uno",
          },
          created_at: "2026-03-03T00:00:00.000Z",
          read_at: null,
        },
      ],
      [],
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications/unread-count") {
        return {
          ok: true,
          json: async () => ({ unreadCount: unreadCountResponses.shift() ?? 0 }),
        };
      }

      if (url === "/api/notifications?offset=0&limit=5&status=unread") {
        return {
          ok: true,
          json: async () => ({
            items: unreadPreviewResponses.shift() ?? [],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsBell href="/notifications" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open notifications" }));
    const previewLink = await screen.findByRole("link", { name: /Revision requested for your AIP/i });
    expect(previewLink).toHaveAttribute("href", "/city/projects/1?notificationId=notif-1");

    fireEvent.click(previewLink);
    expect(screen.getByText("1")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_READ_EVENT, {
          detail: { notificationId: "notif-1" },
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole("button", { name: "Open notifications" }));
    await screen.findByText("No unread notifications.");

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/notifications/notif-1/read",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("updates unread badge and preview list when a realtime notification arrives", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications/unread-count") {
        return {
          ok: true,
          json: async () => ({ unreadCount: 1 }),
        };
      }

      if (url === "/api/notifications?offset=0&limit=5&status=unread") {
        return {
          ok: true,
          json: async () => ({ items: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsBell href="/notifications" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open notifications" }));
    await screen.findByText("No unread notifications.");

    act(() => {
      realtimeState.onEvent?.({
        eventType: "INSERT",
        row: {
          id: "notif-live",
          recipient_user_id: "user-123",
          recipient_role: "citizen",
          scope_type: "citizen",
          event_type: "FEEDBACK_CREATED",
          action_url: "/notifications/live",
          metadata: {},
          created_at: "2026-03-03T00:00:00.000Z",
          read_at: null,
          title: "Live update",
          message: "A realtime notification arrived.",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
    expect(screen.getAllByText("New feedback was posted.").length).toBeGreaterThan(0);
  });
});
