"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SelectOption = {
  value: string;
  label: string;
};

type AipListFiltersProps = {
  yearOptions: SelectOption[];
  yearValue: string;
  onYearChange: (value: string) => void;
  cityOptions: SelectOption[];
  cityValue: string;
  onCityChange: (value: string) => void;
  barangayOptions: SelectOption[];
  barangayValue: string;
  onBarangayChange: (value: string) => void;
};

export default function AipListFilters({
  yearOptions,
  yearValue,
  onYearChange,
  cityOptions,
  cityValue,
  onCityChange,
  barangayOptions,
  barangayValue,
  onBarangayChange,
}: AipListFiltersProps) {
  return (
    <Card className="w-full border-slate-200">
      <CardContent className="space-y-2 px-3 py-3 sm:px-4 md:px-6 md:py-5">
        <h3 className="text-sm font-medium text-slate-700">Filters</h3>

        <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Fiscal Year</label>
            <Select value={yearValue} onValueChange={onYearChange}>
              <SelectTrigger className="h-10 w-full bg-white text-sm md:h-11">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">City</label>
            <Select value={cityValue} onValueChange={onCityChange}>
              <SelectTrigger className="h-10 w-full bg-white text-sm md:h-11">
                <SelectValue placeholder="Select city" />
              </SelectTrigger>
              <SelectContent>
                {cityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Barangay</label>
            <Select value={barangayValue} onValueChange={onBarangayChange}>
              <SelectTrigger className="h-10 w-full bg-white text-sm md:h-11">
                <SelectValue placeholder="Select barangay" />
              </SelectTrigger>
              <SelectContent>
                {barangayOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
