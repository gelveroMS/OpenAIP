"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccountAdminHeader({
  onCreateOfficial,
  showCreateOfficial,
}: {
  onCreateOfficial: () => void;
  showCreateOfficial: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-slate-900 sm:text-3xl">Account Administration</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage official and citizen accounts while enforcing role-based LGU
          scope binding and account lifecycle controls.
        </p>
      </div>

      {showCreateOfficial ? (
        <Button
          data-testid="admin-create-official-account-button"
          className="w-full bg-teal-700 hover:bg-teal-800 sm:w-auto"
          onClick={onCreateOfficial}
        >
          <Plus className="h-4 w-4" />
          Create Official Account
        </Button>
      ) : null}
    </div>
  );
}
