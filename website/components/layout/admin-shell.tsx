"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import AdminSidebar from "@/components/layout/admin-sidebar";
import AdminTopbar from "@/components/layout/admin-topbar";
import LguFooter from "@/components/layout/lgu-footer";
import SmartLoadingRegion from "@/components/ui/SmartLoadingRegion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

type Props = {
  children: ReactNode;
  profileName?: string;
  profileRole?: string;
  profileEmail?: string;
};

export default function AdminShell({
  children,
  profileName = "Admin User",
  profileRole = "System Administration",
  profileEmail = "admin@example.com",
}: Props) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-[#F3F5F7] lg:flex">
      <div className="hidden shrink-0 lg:block">
        <AdminSidebar mode="desktop" />
      </div>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[17rem] max-w-[85vw] gap-0 border-r-0 p-0">
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <AdminSidebar mode="mobile" onNavigate={() => setMobileSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-hidden">
        <AdminTopbar
          name={profileName}
          roleLabel={profileRole}
          accountProfile={{
            fullName: profileName,
            email: profileEmail,
            role: "admin",
          }}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
          <div className="mx-auto flex w-full max-w-[1400px] min-w-0 flex-1 flex-col">
            <SmartLoadingRegion id="admin-main">{children}</SmartLoadingRegion>
          </div>
        </main>

        <LguFooter />
      </div>
    </div>
  );
}
