"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { emitNotificationRead } from "@/lib/notifications/read-events";
import { withCsrfHeader } from "@/lib/security/csrf";

async function markOneRead(notificationId: string): Promise<boolean> {
  const response = await fetch(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    withCsrfHeader({
      method: "PATCH",
    })
  );
  return response.ok;
}

export default function NotificationReadTracker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inFlightRef = useRef<string | null>(null);
  const processedRef = useRef(new Set<string>());

  useEffect(() => {
    const notificationId = searchParams.get("notificationId")?.trim() ?? "";
    if (!notificationId) return;
    if (processedRef.current.has(notificationId)) return;
    if (inFlightRef.current === notificationId) return;

    let cancelled = false;
    inFlightRef.current = notificationId;

    async function run() {
      const ok = await markOneRead(notificationId);
      if (!ok || cancelled) {
        inFlightRef.current = null;
        return;
      }

      emitNotificationRead(notificationId);
      processedRef.current.add(notificationId);
      inFlightRef.current = null;

      const params = new URLSearchParams(searchParams.toString());
      params.delete("notificationId");
      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(nextUrl, { scroll: false });
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, searchParams]);

  return null;
}
