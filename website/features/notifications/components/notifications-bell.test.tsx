import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsBell from "@/features/notifications/components/notifications-bell";
import type { NotificationRealtimeEvent } from "@/features/notifications/realtime-listener";

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

  it("opens the preview, caps unread items at five, and shows the view-all action", async () => {
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
              title: `Title ${index + 1}`,
              message: `Preview item ${index + 1}`,
              action_url: `/notifications/${index + 1}`,
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

    await screen.findByText("Preview item 1");
    expect(screen.getByText("Preview item 5")).toBeInTheDocument();
    expect(screen.queryByText("Preview item 6")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all notifications" })).toHaveAttribute(
      "href",
      "/notifications"
    );
  });

  it("marks a preview item as read when clicked", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          json: async () => ({
            items: [
              {
                id: "notif-1",
                title: "Review update",
                message: "Returned for revision",
                action_url: "/city/projects/1",
                created_at: "2026-03-03T00:00:00.000Z",
                read_at: null,
              },
            ],
          }),
        };
      }

      if (url === "/api/notifications/notif-1/read") {
        expect(init).toMatchObject({ method: "PATCH" });
        return {
          ok: true,
          json: async () => ({ ok: true }),
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
    const previewLink = await screen.findByRole("link", { name: /Returned for revision/i });
    expect(previewLink).toHaveAttribute("href", "/city/projects/1");

    fireEvent.click(previewLink);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/notif-1/read",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Returned for revision")).not.toBeInTheDocument();
    });
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
          read_at: null,
          title: "Live update",
          message: "A realtime notification arrived.",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
    expect(screen.getAllByText("A realtime notification arrived.").length).toBeGreaterThan(0);
  });
});
