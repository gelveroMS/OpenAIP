"use client";

import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload, REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

type NotificationRealtimePayload = {
  id: string;
  recipient_user_id: string;
  recipient_role: string | null;
  scope_type: string | null;
  event_type: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
  read_at: string | null;
  title: string;
  message: string;
};

export type NotificationRealtimeEvent = {
  eventType: "INSERT" | "UPDATE";
  row: NotificationRealtimePayload;
};

type Props = {
  userId: string | null;
  onEvent?: (event: NotificationRealtimeEvent) => void;
  onStatusChange?: (status: REALTIME_SUBSCRIBE_STATES) => void;
};

function asNotificationPayload(value: unknown): NotificationRealtimePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  const recipientUserId = typeof row.recipient_user_id === "string" ? row.recipient_user_id : null;
  if (!id || !recipientUserId) return null;
  return {
    id,
    recipient_user_id: recipientUserId,
    recipient_role: typeof row.recipient_role === "string" ? row.recipient_role : null,
    scope_type: typeof row.scope_type === "string" ? row.scope_type : null,
    event_type: typeof row.event_type === "string" ? row.event_type : null,
    action_url: typeof row.action_url === "string" ? row.action_url : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    title: typeof row.title === "string" ? row.title : "",
    message: typeof row.message === "string" ? row.message : "",
  };
}

export default function NotificationsRealtimeListener({ userId, onEvent, onStatusChange }: Props) {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatusChange);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onStatusRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!userId) return;

    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = asNotificationPayload(payload.new);
          if (!row) return;
          onEventRef.current?.({ eventType: "INSERT", row });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = asNotificationPayload(payload.new);
          if (!row) return;
          onEventRef.current?.({ eventType: "UPDATE", row });
        }
      )
      .subscribe((status) => {
        onStatusRef.current?.(status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
