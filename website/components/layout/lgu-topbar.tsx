"use client";

import { useState } from "react";
import { User } from "lucide-react";
import AccountModal from "@/features/account/AccountModal";
import NotificationsBell from "@/features/notifications/components/notifications-bell";
import type { LguAccountProfile } from "@/features/account/types";

type Props = {
  name: string;
  roleLabel: string;
  accountProfile: LguAccountProfile;
};

export default function LguTopbar({ name, roleLabel, accountProfile }: Props) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const notificationsHref =
    accountProfile.role === "city" ? "/city/notifications" : "/barangay/notifications";

  return (
    <header className="w-full bg-white">
      <div className="h-16 px-8 flex items-center justify-end gap-4">
        <NotificationsBell href={notificationsHref} />

        <div className="text-right leading-tight">
          <div className="text-sm font-semibold text-slate-900">{name}</div>
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

      <AccountModal
        open={accountModalOpen}
        onOpenChange={setAccountModalOpen}
        user={accountProfile}
      />
    </header>
  );
}
