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

export default function AipFiltersRow({
  query,
  onQueryChange,
  yearFilter,
  onYearChange,
  statusFilter,
  onStatusChange,
  lguFilter,
  onLguChange,
  yearOptions,
  statusOptions,
  lguOptions,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  yearFilter: string;
  onYearChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  lguFilter: string;
  onLguChange: (value: string) => void;
  yearOptions: number[];
  statusOptions: Array<{ value: string; label: string }>;
  lguOptions: string[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name or email"
            className="h-11 border-slate-200 bg-slate-50 pl-9 text-[13.5px]"
            aria-label="Search by name or email"
          />
        </div>

        <Select value={yearFilter} onValueChange={onYearChange}>
          <SelectTrigger className="h-11 w-full border-slate-200 bg-slate-50 text-[13.5px]">
            <SelectValue placeholder="All Years" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="h-11 w-full border-slate-200 bg-slate-50 text-[13.5px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={lguFilter} onValueChange={onLguChange}>
          <SelectTrigger className="h-11 w-full border-slate-200 bg-slate-50 text-[13.5px]">
            <SelectValue placeholder="All LGUs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All LGUs</SelectItem>
            {lguOptions.map((lgu) => (
              <SelectItem key={lgu} value={lgu}>
                {lgu}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
