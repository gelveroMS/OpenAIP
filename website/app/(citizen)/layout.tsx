"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CitizenAuthModalHost } from "@/features/citizen/auth";
import CitizenFooter from "@/features/citizen/components/citizen-footer";
import CitizenTopNav from "@/features/citizen/components/citizen-top-nav";
import SmartLoadingRegion from "@/components/ui/SmartLoadingRegion";
import { cn } from "@/lib/ui/utils";

const CitizenLayout = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isLandingDashboard = normalizedPathname === "/";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#D3DBE0] to-[#FFFFFF]">
      <Suspense
        fallback={<div className="h-16 border-b border-slate-200 bg-[#D3DBE0]" aria-hidden />}
      >
        <CitizenTopNav />
      </Suspense>
      <main
        className={cn(
          "mx-auto flex w-full flex-1 min-h-0 flex-col",
          isLandingDashboard
            ? "m-0 max-w-none p-0"
            : "max-w-6xl px-4 py-6 md:px-8 md:py-8"
        )}
      >
        <SmartLoadingRegion id="citizen-main">{children}</SmartLoadingRegion>
      </main>
      <Suspense fallback={<div className="pointer-events-none fixed inset-0" aria-hidden />}>
        <CitizenAuthModalHost />
      </Suspense>
      <CitizenFooter />
    </div>
  );
};

export default CitizenLayout;
