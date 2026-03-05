"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  ClipboardCheck,
  ClipboardList,
  CornerDownRight,
  Globe,
  Inbox,
  Megaphone,
  MessageSquare,
  Pencil,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNotificationRelativeTime } from "@/features/notifications/components/notification-time";
import NotificationsRealtimeListener from "@/features/notifications/realtime-listener";
import { buildNotificationDestinationHref } from "@/lib/notifications/open-link";
import { buildDisplay } from "@/lib/notifications/templates";
import type { NotificationIconKey } from "@/lib/notifications/templates";
import { withCsrfHeader } from "@/lib/security/csrf";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/ui/utils";

type NotificationItem = {
  id: string;
  recipient_role: string | null;
  scope_type: string | null;
  event_type: string;
  title: string;
  message: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

type NotificationResponse = {
  items: NotificationItem[];
  offset: number;
  limit: number;
  total: number;
  hasNext: boolean;
  nextOffset: number | null;
};

type FilterStatus = "all" | "unread";

type Props = {
  title?: string;
  description?: string;
};

const PAGE_SIZE = 20;

async function fetchUnreadCount(): Promise<number> {
  const response = await fetch("/api/notifications/unread-count", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load unread notification count.");
  }

  const payload = (await response.json().catch(() => null)) as { unreadCount?: number } | null;
  if (!payload || typeof payload.unreadCount !== "number") {
    throw new Error("Failed to load unread notification count.");
  }

  return payload.unreadCount;
}

async function listNotifications(
  offset: number,
  status: FilterStatus
): Promise<NotificationResponse> {
  const response = await fetch(
    `/api/notifications?offset=${offset}&limit=${PAGE_SIZE}&status=${status}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Failed to load notifications.");
  }
  return (await response.json()) as NotificationResponse;
}

async function markAllRead(): Promise<void> {
  const response = await fetch(
    "/api/notifications/read-all",
    withCsrfHeader({
      method: "POST",
    })
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Failed to mark all notifications as read.");
  }
}

function getIcon(iconKey: NotificationIconKey) {
  switch (iconKey) {
    case "clipboard-check":
      return ClipboardCheck;
    case "pencil-alert":
      return Pencil;
    case "globe":
      return Globe;
    case "inbox":
      return Inbox;
    case "refresh-cw":
      return RefreshCw;
    case "message-square":
      return MessageSquare;
    case "corner-down-right":
      return CornerDownRight;
    case "shield":
      return Shield;
    case "megaphone":
      return Megaphone;
    case "alert-triangle":
      return AlertTriangle;
    case "clipboard-list":
      return ClipboardList;
    case "x-circle":
      return XCircle;
    default:
      return Bell;
  }
}

export default function NotificationsInbox({
  title = "Notifications",
  description = "Latest updates across workflow, feedback, and moderation events.",
}: Props) {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  useEffect(() => {
    let isActive = true;
    const client = supabaseBrowser();
    void client.auth.getUser().then(({ data }) => {
      if (!isActive) return;
      setUserId(data.user?.id ?? null);
    });

    return () => {
      isActive = false;
    };
  }, []);

  const syncUnreadTotal = useCallback(async () => {
    try {
      const next = await fetchUnreadCount();
      setUnreadTotal(next);
    } catch {
      // Keep the current unread count when refresh fails.
    }
  }, []);

  const refreshAllTotal = useCallback(async () => {
    try {
      const data = await listNotifications(0, "all");
      setAllTotal(data.total);
    } catch {
      // Keep the current all tab count when refresh fails.
    }
  }, []);

  const loadPage = useCallback(
    async (nextOffset: number, nextFilter: FilterStatus) => {
      setLoading(true);
      setError(null);
      try {
        const data = await listNotifications(nextOffset, nextFilter);
        setItems(data.items);
        setOffset(data.offset);
        setFilteredTotal(data.total);
        setHasNext(data.hasNext);
        if (nextFilter === "all") {
          setAllTotal(data.total);
        }
        void syncUnreadTotal();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load notifications.");
      } finally {
        setLoading(false);
      }
    },
    [syncUnreadTotal]
  );

  useEffect(() => {
    void loadPage(0, "all");
  }, [loadPage]);

  const handleFilterChange = (nextFilter: FilterStatus) => {
    if (nextFilter === activeFilter) return;
    setActiveFilter(nextFilter);
    void loadPage(0, nextFilter);
  };

  const handleMarkAllRead = async () => {
    setMarkAllBusy(true);
    try {
      await markAllRead();
      if (activeFilter === "unread") {
        setItems([]);
        setFilteredTotal(0);
        setHasNext(false);
      } else {
        setItems((current) =>
          current.map((item) => ({
            ...item,
            read_at: item.read_at ?? new Date().toISOString(),
          }))
        );
      }
      setUnreadTotal(0);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Failed to mark all notifications as read."
      );
    } finally {
      setMarkAllBusy(false);
    }
  };

  const handleRealtimeEvent = useCallback(async () => {
    await Promise.all([syncUnreadTotal(), refreshAllTotal()]);
    await loadPage(0, activeFilter);
  }, [activeFilter, loadPage, refreshAllTotal, syncUnreadTotal]);

  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const emptyStateMessage =
    activeFilter === "unread" ? "No unread notifications." : "No notifications found.";
  const visibleTotal = activeFilter === "all" ? allTotal : unreadTotal;
  const showPagination = !loading && filteredTotal > 0;

  const renderedItems = useMemo(() => {
    const fallbackHref = pathname || "/notifications";
    return items.map((item) => {
      const display = buildDisplay(item, "page");
      return {
        ...item,
        isUnread: item.read_at === null,
        display,
        destinationHref: buildNotificationDestinationHref({
          next: display.actionUrl ?? fallbackHref,
          notificationId: item.id,
        }),
      };
    });
  }, [items, pathname]);

  return (
    <section className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#022437]">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-slate-300 px-4 text-[#022437] hover:bg-slate-50"
            disabled={markAllBusy || unreadTotal === 0}
            onClick={handleMarkAllRead}
          >
            Mark all read
          </Button>
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                activeFilter === "all"
                  ? "bg-[#022437] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
              onClick={() => {
                handleFilterChange("all");
              }}
            >
              {`All (${allTotal})`}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                activeFilter === "unread"
                  ? "bg-[#0E7490] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
              onClick={() => {
                handleFilterChange("unread");
              }}
            >
              {`Unread (${unreadTotal})`}
            </button>
          </div>
          <p className="text-sm text-slate-500">{`Showing ${visibleTotal} notification${visibleTotal === 1 ? "" : "s"}`}</p>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading notifications...</p> : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loading && renderedItems.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
          {emptyStateMessage}
        </div>
      ) : null}

      <div className="space-y-3">
        {renderedItems.map((item) => {
          const ItemIcon = getIcon(item.display.iconKey);
          return (
            <Link key={item.id} href={item.destinationHref} className="block">
              <article
                className={cn(
                  "rounded-[22px] border px-5 py-4 shadow-sm transition-colors hover:border-slate-300",
                  item.isUnread ? "border-[#4B8191]/50 bg-[#F4FAFC]" : "border-slate-200 bg-white"
                )}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <ItemIcon className="h-5 w-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-6 text-slate-800">{item.display.title}</p>
                      {item.display.pill ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {item.display.pill}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs font-medium text-slate-500">{item.display.context}</p>
                    {item.display.excerpt ? (
                      <p className="mt-2 line-clamp-2 whitespace-pre-line text-sm text-slate-700">
                        {item.display.excerpt}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs font-medium text-slate-400">
                      {formatNotificationRelativeTime(item.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    {item.isUnread ? (
                      <span
                        className="h-2.5 w-2.5 rounded-full bg-[#16B7E8]"
                        aria-label="Unread notification"
                      />
                    ) : (
                      <span className="text-xs font-medium text-slate-400">Read</span>
                    )}
                  </div>
                </div>
              </article>
            </Link>
          );
        })}
      </div>

      {showPagination ? (
        <div className="flex items-center justify-between rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs text-slate-500">{`Showing ${offset + 1}-${Math.min(
            offset + PAGE_SIZE,
            filteredTotal
          )} of ${filteredTotal}`}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => {
                void loadPage(prevOffset, activeFilter);
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasNext || loading}
              onClick={() => {
                void loadPage(offset + PAGE_SIZE, activeFilter);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <NotificationsRealtimeListener
        userId={userId}
        onEvent={() => {
          void handleRealtimeEvent();
        }}
      />
    </section>
  );
}
