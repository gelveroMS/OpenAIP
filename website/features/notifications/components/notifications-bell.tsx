"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import NotificationsRealtimeListener from "@/features/notifications/realtime-listener";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/ui/utils";

type Props = {
  href: string;
  className?: string;
};

type ToastState = {
  title: string;
  message: string;
} | null;

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

export default function NotificationsBell({ href, className }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);

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

  return (
    <>
      <Link
        href={href}
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
      </Link>

      <NotificationsRealtimeListener
        userId={userId}
        onEvent={(event) => {
          if (event.eventType === "INSERT") {
            setUnreadCount((current) => current + 1);
            setToast({
              title: event.row.title || "New notification",
              message: event.row.message || "You have a new update.",
            });
            return;
          }
          void refreshUnread();
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
