"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatNotificationRelativeTime } from "@/features/notifications/components/notification-time";
import NotificationsRealtimeListener from "@/features/notifications/realtime-listener";
import { withCsrfHeader } from "@/lib/security/csrf";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/ui/utils";

type Props = {
  href: string;
  className?: string;
};

type NotificationPreviewItem = {
  id: string;
  title: string;
  message: string;
  action_url: string | null;
  created_at: string;
  read_at: string | null;
};

type ToastState = {
  title: string;
  message: string;
} | null;

type NotificationResponse = {
  items: NotificationPreviewItem[];
};

const PREVIEW_LIMIT = 5;

async function fetchUnreadCount(): Promise<number> {
  const response = await fetch("/api/notifications/unread-count", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const payload = (await response.json().catch(() => null)) as { unreadCount?: number } | null;
  if (!payload || typeof payload.unreadCount !== "number") return 0;
  return payload.unreadCount;
}

async function fetchUnreadPreview(): Promise<NotificationPreviewItem[]> {
  const response = await fetch(`/api/notifications?offset=0&limit=${PREVIEW_LIMIT}&status=unread`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as NotificationResponse | null;
  if (!payload || !Array.isArray(payload.items)) return [];
  return payload.items.slice(0, PREVIEW_LIMIT);
}

async function markOneRead(notificationId: string): Promise<void> {
  const response = await fetch(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    withCsrfHeader({
      method: "PATCH",
    })
  );
  if (!response.ok) {
    throw new Error("Failed to mark notification as read.");
  }
}

export default function NotificationsBell({ href, className }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [previewItems, setPreviewItems] = useState<NotificationPreviewItem[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let isActive = true;
    const client = supabaseBrowser();

    async function bootstrap() {
      const [{ data }, unread] = await Promise.all([
        client.auth.getUser(),
        fetchUnreadCount(),
      ]);
      if (!isActive) return;
      setUserId(data.user?.id ?? null);
      setUnreadCount(unread);
    }

    void bootstrap();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const refreshUnread = useCallback(async () => {
    const next = await fetchUnreadCount();
    setUnreadCount(next);
  }, []);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const nextItems = await fetchUnreadPreview();
      setPreviewItems(nextItems);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handlePreviewOpenChange = useCallback(
    (nextOpen: boolean) => {
      setPreviewOpen(nextOpen);
      if (nextOpen) {
        void loadPreview();
      }
    },
    [loadPreview]
  );

  const handlePreviewClick = useCallback(
    (item: NotificationPreviewItem) => {
      setPreviewItems((current) => current.filter((entry) => entry.id !== item.id));
      setUnreadCount((current) => Math.max(0, current - 1));
      setPreviewOpen(false);
      void markOneRead(item.id).catch(async () => {
        await refreshUnread();
      });
    },
    [refreshUnread]
  );

  return (
    <>
      <DropdownMenu modal={false} open={previewOpen} onOpenChange={handlePreviewOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open notifications"
            className={cn(
              "relative grid h-10 w-10 place-items-center rounded-full bg-[#0B3440] text-white transition-colors hover:bg-[#022437]",
              className
            )}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <Badge className="absolute -right-1 -top-1 h-5 min-w-5 rounded-full bg-red-600 px-1 text-[10px] leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            ) : null}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={10}
          className="z-[60] w-[320px] max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-base font-semibold text-slate-900">Notifications</p>
            <p className="mt-1 text-xs text-slate-500">{`${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`}</p>
          </div>

          <div className="max-h-[360px] overflow-y-auto px-4 py-2">
            {previewLoading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading notifications...</p>
            ) : null}

            {!previewLoading && previewItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No unread notifications.</p>
            ) : null}

            {!previewLoading
              ? previewItems.map((item, index) => (
                  <Link
                    key={item.id}
                    href={item.action_url ?? href}
                    className={cn(
                      "flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-slate-50",
                      index > 0 ? "border-t border-slate-100" : ""
                    )}
                    onClick={() => {
                      handlePreviewClick(item);
                    }}
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                      <Bell className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium leading-5 text-slate-800">
                        {item.message}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {formatNotificationRelativeTime(item.created_at)}
                      </span>
                    </span>
                    <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#022437]" />
                  </Link>
                ))
              : null}
          </div>

          <div className="border-t border-slate-100 p-3">
            <Link
              href={href}
              className="block rounded-xl bg-[#022437] px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-[#0B3440]"
            >
              View all notifications
            </Link>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <NotificationsRealtimeListener
        userId={userId}
        onEvent={(event) => {
          if (event.eventType === "INSERT") {
            setUnreadCount((current) => current + 1);
            setPreviewItems((current) =>
              [
                {
                  id: event.row.id,
                  title: event.row.title || "New notification",
                  message: event.row.message || "You have a new update.",
                  action_url: null,
                  created_at: new Date().toISOString(),
                  read_at: event.row.read_at,
                },
                ...current.filter((item) => item.id !== event.row.id),
              ].slice(0, PREVIEW_LIMIT)
            );
            setToast({
              title: event.row.title || "New notification",
              message: event.row.message || "You have a new update.",
            });
            return;
          }
          setPreviewItems((current) =>
            current.filter((item) => (event.row.read_at === null ? true : item.id !== event.row.id))
          );
          void refreshUnread();
          if (previewOpen) {
            void loadPreview();
          }
        }}
      />

      {toast ? (
        <div className="fixed right-4 top-20 z-[70] w-[320px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
          <p className="mt-1 text-xs text-slate-600">{toast.message}</p>
        </div>
      ) : null}
    </>
  );
}
