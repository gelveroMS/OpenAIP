"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNotificationRelativeTime } from "@/features/notifications/components/notification-time";
import { withCsrfHeader } from "@/lib/security/csrf";
import { cn } from "@/lib/ui/utils";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  action_url: string | null;
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

async function markOneRead(notificationId: string): Promise<void> {
  const response = await fetch(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    withCsrfHeader({
      method: "PATCH",
    })
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Failed to mark notification as read.");
  }
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

export default function NotificationsInbox({
  title = "Notifications",
  description = "Latest updates across workflow, feedback, and moderation events.",
}: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  const syncUnreadTotal = useCallback(async () => {
    try {
      const next = await fetchUnreadCount();
      setUnreadTotal(next);
    } catch {
      // Keep the current badge total if the count refresh fails.
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

  const handleMarkRead = async (id: string) => {
    setBusyId(id);
    try {
      await markOneRead(id);
      setItems((current) =>
        activeFilter === "unread"
          ? current.filter((item) => item.id !== id)
          : current.map((item) =>
              item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item
            )
      );
      if (activeFilter === "unread") {
        setFilteredTotal((current) => Math.max(0, current - 1));
      }
      await syncUnreadTotal();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Failed to mark notification as read."
      );
    } finally {
      setBusyId(null);
    }
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

  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const emptyStateMessage = activeFilter === "unread" ? "No unread notifications." : "No notifications found.";
  const visibleTotal = activeFilter === "all" ? allTotal : unreadTotal;
  const showPagination = !loading && filteredTotal > 0;

  const renderedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        isUnread: item.read_at === null,
        primaryText: item.message || item.title,
      })),
    [items]
  );

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
        {renderedItems.map((item) => (
          <article
            key={item.id}
            className={cn(
              "rounded-[22px] border px-5 py-4 shadow-sm transition-colors",
              item.isUnread
                ? "border-[#4B8191]/50 bg-[#F4FAFC]"
                : "border-slate-200 bg-white"
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                <Bell className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-6 text-slate-800">{item.primaryText}</p>
                <p className="mt-2 text-xs font-medium text-slate-400">
                  {formatNotificationRelativeTime(item.created_at)}
                </p>
                {item.action_url ? (
                  <Link
                    href={item.action_url}
                    className="mt-3 inline-flex text-xs font-semibold text-[#0E7490] underline-offset-2 hover:underline"
                  >
                    Open related page
                  </Link>
                ) : null}
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

                {item.isUnread ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-slate-300 px-3 text-xs font-semibold text-[#022437] hover:bg-slate-50"
                    disabled={busyId === item.id}
                    onClick={() => {
                      void handleMarkRead(item.id);
                    }}
                  >
                    Mark as read
                  </Button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
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
    </section>
  );
}
