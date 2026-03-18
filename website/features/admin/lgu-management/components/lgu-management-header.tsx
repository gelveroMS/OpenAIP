"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LguManagementHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-slate-900 sm:text-3xl">LGU Management</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Maintain authoritative LGU master data and confirm fixed, system-locked budget category configuration used across the platform.
        </p>
      </div>

      <Button data-testid="admin-add-lgu-button" className="w-full bg-teal-700 hover:bg-teal-800 sm:w-auto" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        Add LGU
      </Button>
    </div>
  );
}
