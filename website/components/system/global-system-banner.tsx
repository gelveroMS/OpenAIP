"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { SystemBannerPublished } from "@/lib/repos/system-administration/types";
import { subscribeSystemBannerChanged } from "@/components/system/system-banner-events";

type BannerPayload = {
  banner?: SystemBannerPublished | null;
};

const REFRESH_MS = 60_000;

const severityStyles: Record<SystemBannerPublished["severity"], string> = {
  Info: "border-blue-200 bg-blue-50 text-blue-900",
  Warning: "border-amber-200 bg-amber-50 text-amber-900",
  Critical: "border-rose-200 bg-rose-50 text-rose-900",
};

function SeverityIcon({ severity }: { severity: SystemBannerPublished["severity"] }) {
  if (severity === "Critical") return <ShieldAlert className="h-4 w-4 shrink-0" />;
  if (severity === "Warning") return <AlertTriangle className="h-4 w-4 shrink-0" />;
  return <Info className="h-4 w-4 shrink-0" />;
}

export default function GlobalSystemBanner() {
  const [banner, setBanner] = useState<SystemBannerPublished | null>(null);

  useEffect(() => {
    let active = true;
    const loadBanner = async () => {
      try {
        const response = await fetch("/api/system/banner", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as BannerPayload | null;
        if (!active) return;
        if (!response.ok || !payload) return;
        setBanner(payload.banner ?? null);
      } catch {
        if (!active) return;
        setBanner(null);
      }
    };

    void loadBanner();
    const unsubscribe = subscribeSystemBannerChanged(() => {
      if (!active) return;
      void loadBanner();
    });

    const timer = window.setInterval(() => {
      void loadBanner();
    }, REFRESH_MS);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  if (!banner) return null;

  return (
    <>
      <div className="h-12 w-full" aria-hidden />
      <div className={`fixed inset-x-0 top-0 z-[80] border-b ${severityStyles[banner.severity]}`}>
        <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-2 px-4 text-sm md:px-8">
          <SeverityIcon severity={banner.severity} />
          <div className="min-w-0 truncate">
            {banner.title ? <span className="mr-2 font-semibold">{banner.title}</span> : null}
            <span>{banner.message}</span>
          </div>
        </div>
      </div>
    </>
  );
}
