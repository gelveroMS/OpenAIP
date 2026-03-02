'use client';

import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CitizenFiltersBarProps = {
  yearOptions: Array<string | { value: string; label: string }>;
  yearValue: string;
  onYearChange: (value: string) => void;
  lguOptions: Array<string | { value: string; label: string }>;
  lguValue: string;
  onLguChange: (value: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  yearLabel?: string;
  lguLabel?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
};

export default function CitizenFiltersBar({
  yearOptions,
  yearValue,
  onYearChange,
  lguOptions,
  lguValue,
  onLguChange,
  searchValue,
  onSearchChange,
  yearLabel = "Fiscal Year",
  lguLabel = "LGU",
  searchLabel = "Search",
  searchPlaceholder = "Search...",
}: CitizenFiltersBarProps) {
  const normalizedYearOptions = yearOptions.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
  const normalizedLguOptions = lguOptions.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );

  return (
    <Card className="w-full border-slate-200">
      <CardContent className="space-y-2 px-4 md:px-6">
        <h3 className="text-sm font-medium text-slate-700">Filters</h3>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">{yearLabel}</label>
            <Select value={yearValue} onValueChange={onYearChange}>
              <SelectTrigger className="h-11 w-full bg-white">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {normalizedYearOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label === "all" ? "All Years" : option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">{lguLabel}</label>
            <Select value={lguValue} onValueChange={onLguChange}>
              <SelectTrigger className="h-11 w-full bg-white">
                <SelectValue placeholder="Select LGU" />
              </SelectTrigger>
              <SelectContent>
                {normalizedLguOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">{searchLabel}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-white pl-9"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
