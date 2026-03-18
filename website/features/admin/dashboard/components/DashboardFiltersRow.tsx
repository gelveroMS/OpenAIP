"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCcw } from "lucide-react";
import type { AdminDashboardFilters, LguOptionVM } from "@/lib/repos/admin-dashboard/types";
import type { AipStatus } from "@/lib/contracts/databasev2/enums";

const statusOptions: { value: AipStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending Review" },
  { value: "under_review", label: "Under Review" },
  { value: "for_revision", label: "For Revision" },
  { value: "published", label: "Approved" },
];

type LguOptionValue =
  | "all"
  | "scope:city"
  | "scope:municipality"
  | "scope:barangay"
  | `lgu:${string}`;

export default function DashboardFiltersRow({
  filters,
  lguOptions,
  onChange,
  onReset,
}: {
  filters: AdminDashboardFilters;
  lguOptions: LguOptionVM[];
  onChange: (next: AdminDashboardFilters) => void;
  onReset: () => void;
}) {
  const lguValue: LguOptionValue = filters.lguId
    ? (`lgu:${filters.lguId}` as const)
    : filters.lguScope === "all"
    ? "all"
    : (`scope:${filters.lguScope}` as const);

  const handleLguChange = (value: string) => {
    if (value === "all") {
      onChange({ ...filters, lguScope: "all", lguId: null });
      return;
    }
    if (value.startsWith("scope:")) {
      const scope = value.replace("scope:", "") as AdminDashboardFilters["lguScope"];
      onChange({ ...filters, lguScope: scope, lguId: null });
      return;
    }
    if (value.startsWith("lgu:")) {
      const lguId = value.replace("lgu:", "");
      const option = lguOptions.find((opt) => opt.id === lguId);
      onChange({
        ...filters,
        lguScope: option?.scope ?? "all",
        lguId,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid w-full items-end gap-3 sm:grid-cols-2 xl:grid-cols-[185px_185px_180px_180px_max-content]">
        <div className="space-y-1">
          <div className="text-[12px] text-slate-600">Date From</div>
          <Input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(event) => onChange({ ...filters, dateFrom: event.target.value })}
            className="h-10 border-slate-300 bg-white"
          />
        </div>
        <div className="space-y-1">
          <div className="text-[12px] text-slate-600">Date To</div>
          <Input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(event) => onChange({ ...filters, dateTo: event.target.value })}
            className="h-10 border-slate-300 bg-white"
          />
        </div>
        <div className="space-y-1">
          <div className="text-[12px] text-slate-600">LGU Scope</div>
          <Select value={lguValue} onValueChange={handleLguChange}>
            <SelectTrigger className="h-10 w-full border-slate-300 bg-white">
              <SelectValue placeholder="All LGUs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All LGUs</SelectItem>
              <SelectItem value="scope:city">City LGUs</SelectItem>
              <SelectItem value="scope:municipality">Municipalities</SelectItem>
              <SelectItem value="scope:barangay">Barangays</SelectItem>
              {lguOptions.map((option) => (
                <SelectItem key={option.id} value={`lgu:${option.id}`}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-[12px] text-slate-600">AIP Status</div>
          <Select
            value={filters.aipStatus}
            onValueChange={(value) =>
              onChange({ ...filters, aipStatus: value as AdminDashboardFilters["aipStatus"] })
            }
          >
            <SelectTrigger className="h-10 w-full border-slate-300 bg-white">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-10 w-full gap-2 border-slate-300 bg-white xl:w-auto" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Reset Filters
          </Button>
        </div>
      </div>
      <div className="text-[12px] text-slate-500 xl:text-right">
        Filters persist in the URL, carry into dashboard drill-down pages, and reuse date range in Usage Controls chatbot metrics.
      </div>
    </div>
  );
}
