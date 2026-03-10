"use client";

import Link from "next/link";
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
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatNotificationRelativeTime } from "@/features/notifications/components/notification-time";
import NotificationsRealtimeListener from "@/features/notifications/realtime-listener";
import { buildNotificationDestinationHref } from "@/lib/notifications/open-link";
import { onNotificationRead } from "@/lib/notifications/read-events";
import { buildDisplay, type NotificationIconKey } from "@/lib/notifications/templates";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/ui/utils";

type Props = {
  href: string;
  className?: string;
};

type NotificationPreviewItem = {
  id: string;
  event_type: string | null;
  scope_type: string | null;
  recipient_role: string | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
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

export default function NotificationsBell({ href, className }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [previewItems, setPreviewItems] = useState<NotificationPreviewItem[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  useEffect(() => {
    let isActive = true;
    const client = supabaseBrowser();

    async function bootstrap() {
      try {
        const [sessionResult, unread] = await Promise.all([
          client.auth.getSession(),
          fetchUnreadCount(),
        ]);
        if (!isActive) return;
        const sessionUserId = sessionResult.data.session?.user?.id ?? null;
        if (sessionUserId) {
          setUserId(sessionUserId);
        } else {
          const userResult = await client.auth.getUser();
          if (!isActive) return;
          setUserId(userResult.data.user?.id ?? null);
        }
        setUnreadCount(unread);
      } catch {
        if (!isActive) return;
        setUserId(null);
      }
    }

    void bootstrap();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!isActive) return;
      if (event === "SIGNED_OUT") {
        setUserId(null);
        setUnreadCount(0);
        setPreviewItems([]);
        return;
      }
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED"
      ) {
        setUserId(session?.user?.id ?? null);
        void refreshUnread();
      }
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handlePreviewOpenChange = useCallback(
    (nextOpen: boolean) => {
      setPreviewOpen(nextOpen);
      if (nextOpen) {
        void loadPreview();
      }
    },
    [loadPreview]
  );

  const handlePreviewClick = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  useEffect(() => {
    const unsubscribe = onNotificationRead((notificationId) => {
      setPreviewItems((current) => current.filter((item) => item.id !== notificationId));
      setUnreadCount((current) => Math.max(0, current - 1));
      void refreshUnread();
      if (previewOpen) {
        void loadPreview();
      }
    });

    return unsubscribe;
  }, [loadPreview, previewOpen, refreshUnread]);

  return (
    <>
      <DropdownMenu modal={false} open={previewOpen} onOpenChange={handlePreviewOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open notifications"
            className={cn(
              "relative grid h-10 w-10 place-items-center rounded-full bg-[#0B3440] text-white transition-colors hover:bg-[#0A2C36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3440]/20",
              className
            )}
          >
            <Bell className="h-5 w-5 stroke-[2.2]" />
            {unreadCount > 0 ? (
              <Badge className="absolute -right-1 -top-1 h-6 min-w-6 rounded-full border-2 border-white bg-[#EF4444] px-1.5 text-[10px] font-semibold leading-none text-white">
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
            <p className="mt-1 text-xs text-slate-500">{`${unreadCount} unread updates`}</p>
          </div>

          <div className="max-h-[360px] overflow-y-auto px-4 py-2">
            {previewLoading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading notifications...</p>
            ) : null}

            {!previewLoading && previewItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No unread notifications.</p>
            ) : null}

            {!previewLoading
              ? previewItems.map((item, index) => {
                  const display = buildDisplay(item, "dropdown");
                  const ItemIcon = getIcon(display.iconKey);
                  const destinationHref = buildNotificationDestinationHref({
                    next: display.actionUrl ?? href,
                    notificationId: item.id,
                  });

                  return (
                    <Link
                      key={item.id}
                      href={destinationHref}
                      className={cn(
                        "flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-slate-50",
                        index > 0 ? "border-t border-slate-100" : ""
                      )}
                      onClick={() => {
                        handlePreviewClick();
                      }}
                    >
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                        <ItemIcon className="h-4 w-4" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-semibold leading-5 text-slate-800">
                          {display.title}
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-xs text-slate-500">
                          {display.context}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {formatNotificationRelativeTime(item.created_at)}
                        </span>
                        {display.pill ? (
                          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                            {display.pill}
                          </span>
                        ) : null}
                      </span>

                      {item.read_at === null ? (
                        <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#022437]" />
                      ) : null}
                    </Link>
                  );
                })
              : null}
          </div>

          <div className="border-t border-slate-100 p-3">
            <Link
              href={href}
              className="block rounded-xl bg-[#022437] px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-[#0B3440]"
              onClick={() => {
                setPreviewOpen(false);
              }}
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
            if (event.row.read_at === null) {
              setUnreadCount((current) => current + 1);
            }
            const display = buildDisplay(
              {
                event_type: event.row.event_type,
                scope_type: event.row.scope_type,
                recipient_role: event.row.recipient_role,
                title: event.row.title,
                message: event.row.message,
                metadata: event.row.metadata,
                action_url: event.row.action_url,
              },
              "dropdown"
            );
            setPreviewItems((current) =>
              [
                {
                  id: event.row.id,
                  event_type: event.row.event_type,
                  scope_type: event.row.scope_type,
                  recipient_role: event.row.recipient_role,
                  title: event.row.title || "New notification",
                  message: event.row.message || "You have a new update.",
                  metadata: event.row.metadata,
                  action_url: event.row.action_url,
                  created_at: event.row.created_at ?? new Date().toISOString(),
                  read_at: event.row.read_at,
                },
                ...current.filter((item) => item.id !== event.row.id),
              ].slice(0, PREVIEW_LIMIT)
            );
            setToast({
              title: display.title || "New notification",
              message: display.context || display.excerpt || "You have a new update.",
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
        onStatusChange={(status) => {
          if (status !== "SUBSCRIBED") return;
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
