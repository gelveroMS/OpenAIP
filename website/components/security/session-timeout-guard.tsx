"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SessionActivityPayload = {
  ok?: boolean;
  timeoutMs?: number;
  warningMs?: number;
  lastActivityAtMs?: number;
  error?: { message?: string };
};

type SessionConfig = {
  timeoutMs: number;
  warningMs: number;
};

const HEARTBEAT_THROTTLE_MS = 30_000;
const PROTECTED_PATH_PREFIXES = ["/admin", "/city", "/barangay", "/municipality", "/account"];

function isProtectedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function formatRemaining(minutesMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(minutesMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionTimeoutGuard() {
  const pathname = usePathname();
  const isProtectedRoute = isProtectedPath(pathname);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [warningOpen, setWarningOpen] = useState(false);
  const lastActivityRef = useRef<number | null>(null);
  const lastHeartbeatRef = useRef(0);
  const loggingOutRef = useRef(false);

  const signOutNow = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    try {
      await fetch("/auth/sign-out", { method: "POST" });
    } catch {
      // Best effort sign-out.
    } finally {
      window.location.reload();
    }
  }, []);

  const heartbeat = useCallback(async () => {
    try {
      const response = await fetch("/auth/session/activity", {
        method: "POST",
        cache: "no-store",
      });
      if (response.status === 401) {
        setConfig(null);
        setWarningOpen(false);
        lastActivityRef.current = null;
        return;
      }

      const payload = (await response.json().catch(() => null)) as SessionActivityPayload | null;
      if (!response.ok || payload?.ok === false) return;
      if (
        !payload ||
        !Number.isFinite(payload.timeoutMs) ||
        !Number.isFinite(payload.warningMs) ||
        !Number.isFinite(payload.lastActivityAtMs)
      ) {
        return;
      }

      setConfig({
        timeoutMs: payload.timeoutMs as number,
        warningMs: payload.warningMs as number,
      });
      lastActivityRef.current = payload.lastActivityAtMs as number;
      lastHeartbeatRef.current = Date.now();
      setWarningOpen(false);
    } catch {
      // Ignore network errors; guard resumes on next successful heartbeat.
    }
  }, []);

  useEffect(() => {
    if (!isProtectedRoute) {
      setConfig(null);
      setWarningOpen(false);
      setRemainingMs(0);
      lastActivityRef.current = null;
      return;
    }
    // Keep session heartbeat inactive on public routes to avoid noisy /auth/session/activity traffic.
    void heartbeat();
  }, [heartbeat, isProtectedRoute]);

  useEffect(() => {
    if (!isProtectedRoute || !config) return;

    const onActivity = () => {
      lastActivityRef.current = Date.now();
      const now = Date.now();
      if (now - lastHeartbeatRef.current < HEARTBEAT_THROTTLE_MS) return;
      void heartbeat();
    };

    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, [config, heartbeat, isProtectedRoute]);

  useEffect(() => {
    if (!isProtectedRoute || !config) return;

    const tick = () => {
      const lastActivity = lastActivityRef.current;
      if (!lastActivity) return;

      const elapsed = Date.now() - lastActivity;
      const remaining = Math.max(0, config.timeoutMs - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0) {
        void signOutNow();
        return;
      }

      if (remaining <= config.warningMs) {
        setWarningOpen(true);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [config, isProtectedRoute, signOutNow]);

  if (!config) return null;

  return (
    <Dialog open={warningOpen} onOpenChange={setWarningOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Session Expiring Soon</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-slate-600">
          <p>Your session is about to expire due to inactivity.</p>
          <p className="font-medium text-slate-900">
            Time remaining: <span className="tabular-nums">{formatRemaining(remainingMs)}</span>
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void signOutNow()}>
              Log out
            </Button>
            <Button
              className="bg-[#0E5D6F] text-white hover:bg-[#0E5D6F]/90"
              onClick={() => void heartbeat()}
            >
              Stay signed in
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
