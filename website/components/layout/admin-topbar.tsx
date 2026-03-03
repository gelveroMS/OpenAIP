"use client";

import { useState } from "react";
import { User } from "lucide-react";
import AdminAccountModal from "@/features/account/AdminAccountModal";
import NotificationsBell from "@/features/notifications/components/notifications-bell";
import type { AdminAccountProfile } from "@/features/account/types";

type Props = {
  name: string;
  roleLabel: string;
  accountProfile: AdminAccountProfile;
};

export default function AdminTopbar({ name, roleLabel, accountProfile }: Props) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  return (
    <header className="h-17 border-b border-slate-200 bg-white px-6 flex items-center justify-end">
      <div className="flex items-center gap-3">
        <NotificationsBell href="/admin/notifications" />
        <div className="text-right leading-tight">
          <div className="text-sm font-medium text-slate-900">{name}</div>
          <div className="text-xs text-slate-500">{roleLabel}</div>
        </div>
        <button
          type="button"
          className="h-10 w-10 rounded-full bg-[#0B3440] grid place-items-center"
          aria-label="Open account"
          aria-haspopup="dialog"
          aria-expanded={accountModalOpen}
          onClick={() => setAccountModalOpen(true)}
        >
          <User className="h-5 w-5 text-white" />
        </button>
      </div>

      <AdminAccountModal
        open={accountModalOpen}
        onOpenChange={setAccountModalOpen}
        user={accountProfile}
      />
    </header>
  );
}
