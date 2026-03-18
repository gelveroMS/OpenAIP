"use client";

import { useState } from "react";
import { Menu, User } from "lucide-react";
import AdminAccountModal from "@/features/account/AdminAccountModal";
import NotificationsBell from "@/features/notifications/components/notifications-bell";
import type { AdminAccountProfile } from "@/features/account/types";

type Props = {
  name: string;
  roleLabel: string;
  accountProfile: AdminAccountProfile;
  onOpenSidebar?: () => void;
};

export default function AdminTopbar({ name, roleLabel, accountProfile, onOpenSidebar }: Props) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  return (
    <header className="w-full border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-4 lg:h-16 lg:px-6">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 lg:hidden"
          aria-label="Open navigation menu"
          onClick={onOpenSidebar}
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden max-w-[12rem] text-right leading-tight sm:block">
            <div className="truncate text-sm font-medium text-slate-900">{name}</div>
            <div className="truncate text-xs text-slate-500">{roleLabel}</div>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full bg-[#0B3440] sm:h-10 sm:w-10"
            aria-label="Open account"
            aria-haspopup="dialog"
            aria-expanded={accountModalOpen}
            onClick={() => setAccountModalOpen(true)}
          >
            <User className="h-4 w-4 text-white sm:h-5 sm:w-5" />
          </button>
          <NotificationsBell href="/admin/notifications" className="h-9 w-9 sm:h-10 sm:w-10" />
        </div>
      </div>

      <AdminAccountModal
        open={accountModalOpen}
        onOpenChange={setAccountModalOpen}
        user={accountProfile}
      />
    </header>
  );
}

