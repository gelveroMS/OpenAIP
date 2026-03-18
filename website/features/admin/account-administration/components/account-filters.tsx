"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AccountRole,
  AccountStatus,
  LguOption,
} from "@/lib/repos/accounts/repo";
import type { LguFilter, RoleFilter, StatusFilter } from "../hooks/use-account-administration";

function roleLabel(role: AccountRole) {
  if (role === "admin") return "Admin";
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official") return "City Official";
  if (role === "municipal_official") return "Municipal Official";
  return "Citizen";
}

function statusLabel(status: AccountStatus) {
  if (status === "active") return "Active";
  return "Deactivated";
}

export default function AccountFilters({
  query,
  onQueryChange,
  roleFilter,
  onRoleChange,
  statusFilter,
  onStatusChange,
  lguFilter,
  onLguChange,
  roleOptions,
  lguOptions,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  roleFilter: RoleFilter;
  onRoleChange: (value: RoleFilter) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  lguFilter: LguFilter;
  onLguChange: (value: LguFilter) => void;
  roleOptions: AccountRole[];
  lguOptions: LguOption[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            data-testid="admin-account-search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name or email"
            className="h-10 border-slate-200 bg-slate-50 pl-9 sm:h-11"
            aria-label="Search by name or email"
          />
        </div>

        <Select value={roleFilter} onValueChange={(v) => onRoleChange(v as RoleFilter)}>
          <SelectTrigger className="h-10 w-full border-slate-200 bg-slate-50 sm:h-11">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roleOptions.map((role) => (
              <SelectItem key={role} value={role}>
                {roleLabel(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => onStatusChange(v as StatusFilter)}
        >
          <SelectTrigger className="h-10 w-full border-slate-200 bg-slate-50 sm:h-11">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(["active", "deactivated"] as const).map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={lguFilter} onValueChange={(v) => onLguChange(v as LguFilter)}>
          <SelectTrigger className="h-10 w-full border-slate-200 bg-slate-50 sm:h-11">
            <SelectValue placeholder="All LGUs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All LGUs</SelectItem>
            {lguOptions.map((lgu) => (
              <SelectItem key={lgu.key} value={lgu.key}>
                {lgu.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

