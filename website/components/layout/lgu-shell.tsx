"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { LguVariant } from "@/types/navigation";
import LguSidebar from "@/components/layout/lgu-sidebar";
import LguTopbar from "@/components/layout/lgu-topbar";
import LguFooter from "@/components/layout/lgu-footer";
import SmartLoadingRegion from "@/components/ui/SmartLoadingRegion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { LguAccountProfile } from "@/features/account/types";

type Props = {
  variant: LguVariant;
  children: ReactNode;
  userName?: string;
  roleLabel?: string;
  scopeDisplayName?: string;
  accountProfile: LguAccountProfile;
};

export default function LguShell({
  variant,
  children,
  userName = "Juan Dela Cruz",
  roleLabel = variant === "barangay" ? "Barangay Official" : "City Official",
  scopeDisplayName,
  accountProfile,
}: Props) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      <div className="hidden shrink-0 lg:block">
        <LguSidebar variant={variant} scopeDisplayName={scopeDisplayName} mode="desktop" />
      </div>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[17rem] max-w-[85vw] gap-0 border-r-0 p-0">
          <SheetTitle className="sr-only">OpenAIP navigation</SheetTitle>
          <LguSidebar
            variant={variant}
            scopeDisplayName={scopeDisplayName}
            mode="mobile"
            onNavigate={() => setMobileSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-hidden">
        <LguTopbar
          name={userName}
          roleLabel={roleLabel}
          accountProfile={accountProfile}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
          <div className="mx-auto flex w-full max-w-[1400px] min-w-0 flex-1 flex-col">
            <SmartLoadingRegion id="lgu-main">{children}</SmartLoadingRegion>
          </div>
        </main>

        <LguFooter />
      </div>
    </div>
  );
}
