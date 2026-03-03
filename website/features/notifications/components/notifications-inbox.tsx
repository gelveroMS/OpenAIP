"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { withCsrfHeader } from "@/lib/security/csrf";

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

type Props = {
  title?: string;
  description?: string;
};

const PAGE_SIZE = 20;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function listNotifications(offset: number): Promise<NotificationResponse> {
  const response = await fetch(`/api/notifications?offset=${offset}&limit=${PAGE_SIZE}`, {
    method: "GET",
    cache: "no-store",
  });
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
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  const loadPage = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listNotifications(nextOffset);
      setItems(data.items);
      setOffset(data.offset);
      setTotal(data.total);
      setHasNext(data.hasNext);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const unreadCount = useMemo(
    () => items.filter((item) => item.read_at === null).length,
    [items]
  );

  const handleMarkRead = async (id: string) => {
    setBusyId(id);
    try {
      await markOneRead(id);
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item
        )
      );
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
      setItems((current) =>
        current.map((item) => ({
          ...item,
          read_at: item.read_at ?? new Date().toISOString(),
        }))
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Failed to mark all notifications as read."
      );
    } finally {
      setMarkAllBusy(false);
    }
  };

  const prevOffset = Math.max(0, offset - PAGE_SIZE);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{`Unread on page: ${unreadCount}`}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={markAllBusy || unreadCount === 0}
            onClick={handleMarkAllRead}
          >
            Mark All Read
          </Button>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading notifications...</p> : null}
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No notifications found.
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => {
          const isUnread = item.read_at === null;
          return (
            <article
              key={item.id}
              className={`rounded-xl border p-4 ${
                isUnread ? "border-[#022437]/30 bg-[#022437]/[0.03]" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                  <p className="text-sm text-slate-600">{item.message}</p>
                  <p className="text-xs text-slate-400">{formatTimestamp(item.created_at)}</p>
                  {item.action_url ? (
                    <Link
                      href={item.action_url}
                      className="inline-flex text-xs font-medium text-[#022437] underline-offset-2 hover:underline"
                    >
                      Open related page
                    </Link>
                  ) : null}
                </div>
                {isUnread ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === item.id}
                    onClick={() => {
                      void handleMarkRead(item.id);
                    }}
                  >
                    Mark As Read
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">Read</span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!loading && total > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-xs text-slate-500">{`Showing ${offset + 1}-${Math.min(
            offset + PAGE_SIZE,
            total
          )} of ${total}`}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => {
                void loadPage(prevOffset);
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
                void loadPage(offset + PAGE_SIZE);
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
