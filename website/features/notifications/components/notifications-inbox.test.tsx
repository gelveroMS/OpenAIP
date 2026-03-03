import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsInbox from "@/features/notifications/components/notifications-inbox";

vi.mock("next/link", () => ({
  default: (props: { children: ReactNode; href: string; className?: string }) => (
    <a href={props.href} className={props.className}>
      {props.children}
    </a>
  ),
}));

vi.mock("@/lib/security/csrf", () => ({
  withCsrfHeader: (init: RequestInit) => init,
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
  });

  it("renders all and unread counts on initial load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              title: "Submission updated",
              message: "AIP submission was returned for revision.",
              action_url: "/city/projects/1",
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              title: "Read item",
              message: "The city reviewer approved the update.",
              action_url: null,
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

    await screen.findByText("AIP submission was returned for revision.");
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
              title: "Unread item",
              message: "Unread review note.",
              action_url: null,
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              title: "Read item",
              message: "Already read update.",
              action_url: null,
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
              title: "Unread item",
              message: "Unread review note.",
              action_url: null,
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

    await screen.findByText("Unread review note.");
    fireEvent.click(screen.getByRole("button", { name: "Unread (1)" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications?offset=0&limit=20&status=unread",
        expect.objectContaining({ method: "GET" })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Already read update.")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Unread review note.")).toBeInTheDocument();
  });

  it("removes a notification from the unread tab when marked as read", async () => {
    const unreadCountResponses = [1, 1, 0];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/notifications?offset=0&limit=20&status=all") {
        return okJson({
          items: [
            {
              id: "notif-1",
              title: "Unread item",
              message: "Pending review item.",
              action_url: null,
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

      if (url === "/api/notifications?offset=0&limit=20&status=unread") {
        return okJson({
          items: [
            {
              id: "notif-1",
              title: "Unread item",
              message: "Pending review item.",
              action_url: null,
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
        return okJson({ unreadCount: unreadCountResponses.shift() ?? 0 });
      }

      if (url === "/api/notifications/notif-1/read") {
        expect(init).toMatchObject({ method: "PATCH" });
        return okJson({ ok: true });
      }

      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsInbox />);

    await screen.findByText("Pending review item.");
    fireEvent.click(screen.getByRole("button", { name: "Unread (1)" }));
    await screen.findAllByText("Pending review item.");

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/notif-1/read",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    await waitFor(() => {
      expect(screen.getByText("No unread notifications.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Unread (0)" })).toBeInTheDocument();
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
              title: "Unread item 1",
              message: "Unread item 1",
              action_url: null,
              created_at: "2026-03-03T00:00:00.000Z",
              read_at: null,
            },
            {
              id: "notif-2",
              title: "Unread item 2",
              message: "Unread item 2",
              action_url: null,
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

    await screen.findByText("Unread item 1");
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
    expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
  });
});
