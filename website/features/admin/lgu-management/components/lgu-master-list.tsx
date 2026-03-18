"use client";

import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LguRecord } from "@/lib/repos/lgu/repo";
import type { StatusFilter, TypeFilter } from "../hooks/use-lgu-management";
import LguTable from "./lgu-table";

export default function LguMasterList({
  query,
  onQueryChange,
  typeFilter,
  onTypeChange,
  statusFilter,
  onStatusChange,
  rows,
  onEdit,
  onDeactivate,
  onActivate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: TypeFilter;
  onTypeChange: (value: TypeFilter) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  rows: LguRecord[];
  onEdit: (id: string) => void;
  onDeactivate: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-base text-slate-900">LGU Master List</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              data-testid="admin-lgu-search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search by LGU name or code"
              className="h-10 border-slate-200 bg-slate-50 pl-9 sm:h-11"
              aria-label="Search by LGU name or code"
            />
          </div>

          <Select
            value={typeFilter}
            onValueChange={(v) => onTypeChange(v as TypeFilter)}
          >
            <SelectTrigger className="h-10 w-full border-slate-200 bg-slate-50 sm:h-11">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="region">Region</SelectItem>
              <SelectItem value="province">Province</SelectItem>
              <SelectItem value="city">City</SelectItem>
              <SelectItem value="municipality">Municipality</SelectItem>
              <SelectItem value="barangay">Barangay</SelectItem>
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
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deactivated">Deactivated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <LguTable
          rows={rows}
          onEdit={onEdit}
          onDeactivate={onDeactivate}
          onActivate={onActivate}
        />
      </CardContent>
    </Card>
  );
}

