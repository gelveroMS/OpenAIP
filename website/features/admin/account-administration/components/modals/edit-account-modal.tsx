"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountRecord, AccountRole, LguOption } from "@/lib/repos/accounts/repo";

const ROLE_OPTIONS: AccountRole[] = [
  "admin",
  "barangay_official",
  "city_official",
  "municipal_official",
  "citizen",
];

function roleLabel(role: AccountRole) {
  if (role === "admin") return "Admin";
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official") return "City Official";
  if (role === "municipal_official") return "Municipal Official";
  return "Citizen";
}

function scopeTypeForRole(role: AccountRole) {
  if (role === "admin") return "none";
  if (role === "city_official") return "city";
  if (role === "municipal_official") return "municipality";
  return "barangay";
}

type AccountEditableLguOption = {
  key: string;
  label: string;
  disabled: boolean;
};

function toEditLguOptions({
  role,
  selectedLguKey,
  lguOptions,
}: {
  role: AccountRole;
  selectedLguKey: string | "none";
  lguOptions: LguOption[];
}): AccountEditableLguOption[] {
  const requiredScope = scopeTypeForRole(role);
  if (requiredScope === "none") return [];

  const activeOptions = lguOptions.filter(
    (option) => option.scopeType === requiredScope && option.isActive
  );
  const selectedDeactivatedOption =
    selectedLguKey === "none"
      ? null
      : lguOptions.find(
          (option) =>
            option.key === selectedLguKey &&
            option.scopeType === requiredScope &&
            !option.isActive
        ) ?? null;

  const rows = selectedDeactivatedOption
    ? [...activeOptions, selectedDeactivatedOption]
    : activeOptions;

  return rows.map((option) => ({
    key: option.key,
    label: option.isActive ? option.label : `${option.label} (Deactivated)`,
    disabled: !option.isActive,
  }));
}

export default function EditAccountModal({
  open,
  onOpenChange,
  account,
  lguOptions,
  toLguKey,
  onSave,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountRecord | null;
  lguOptions: LguOption[];
  toLguKey: (scopeType: AccountRecord["lguScopeType"], scopeId: string | null) => string;
  onSave: (input: { fullName: string; role: AccountRole; lguKey: string | "none" }) => Promise<void>;
  loading: boolean;
}) {
  const [fullName, setFullName] = useState(account?.fullName ?? "");
  const [role, setRole] = useState<AccountRole>(account?.role ?? "citizen");
  const [lguKey, setLguKey] = useState<string | "none">(
    account ? toLguKey(account.lguScopeType, account.lguScopeId) : "none"
  );
  const [error, setError] = useState<string | null>(null);

  const filteredLgus = useMemo(
    () =>
      toEditLguOptions({
        role,
        selectedLguKey: lguKey,
        lguOptions,
      }),
    [lguKey, lguOptions, role]
  );

  async function handleSave() {
    if (!account) return;
    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }

    const requiredScope = scopeTypeForRole(role);
    if (requiredScope !== "none" && (!lguKey || lguKey === "none")) {
      setError("LGU assignment is required for the selected role.");
      return;
    }

    setError(null);
    await onSave({
      fullName: fullName.trim(),
      role,
      lguKey: requiredScope === "none" ? "none" : lguKey,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>

        {!account ? (
          <div className="text-sm text-slate-500">No account selected.</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={account.email} disabled className="h-11 bg-slate-50" />
            </div>

            <div className="space-y-2">
              <Label>
                Full Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Role <span className="text-rose-600">*</span>
              </Label>
              <Select
                value={role}
                onValueChange={(value) => {
                  const nextRole = value as AccountRole;
                  setRole(nextRole);
                  if (scopeTypeForRole(nextRole) === "none") {
                    setLguKey("none");
                  } else {
                    setLguKey("");
                  }
                }}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {roleLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {scopeTypeForRole(role) !== "none" ? (
              <div className="space-y-2">
                <Label>
                  LGU Assignment <span className="text-rose-600">*</span>
                </Label>
                <Select value={lguKey} onValueChange={(value) => setLguKey(value)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select an LGU" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredLgus.map((option) => (
                      <SelectItem
                        key={option.key}
                        value={option.key}
                        disabled={option.disabled}
                        className={option.disabled ? "text-slate-400" : undefined}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="text-xs text-slate-500 rounded-md border border-slate-200 p-3 bg-slate-50">
                Admin role is system-wide and does not have an LGU assignment.
              </div>
            )}

            {error ? <div className="text-sm text-rose-600">{error}</div> : null}

            <div className="pt-2 flex items-center gap-3">
              <Button
                className="flex-1 bg-teal-700 hover:bg-teal-800"
                onClick={handleSave}
                disabled={loading}
              >
                Save Changes
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
