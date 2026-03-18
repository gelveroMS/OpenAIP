import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BudgetAllocationFiltersVM, BudgetAllocationLguOptionVM } from "@/lib/domain/citizen-budget-allocation";

const optionValue = (option: BudgetAllocationLguOptionVM) => `${option.scopeType}:${option.id}`;

type FiltersSectionProps = {
  filters: BudgetAllocationFiltersVM;
  onYearChange: (year: number) => void;
  onLguChange: (scopeType: "city" | "barangay", scopeId: string) => void;
};

export default function FiltersSection({ filters, onYearChange, onLguChange }: FiltersSectionProps) {
  return (
    <section className="mx-auto max-w-6xl px-3 pb-4 pt-0 sm:px-4 md:px-6 md:pb-6">
      <div className="grid w-full gap-3 sm:gap-4 md:grid-cols-2 md:gap-6">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 md:text-lg">Fiscal Year</Label>
          <Select value={String(filters.selectedYear)} onValueChange={(value) => onYearChange(Number(value))}>
            <SelectTrigger className="h-10 w-full rounded-xl border-gray-300 bg-white text-sm focus-visible:ring-cyan-500/40 md:h-12 md:w-36 md:rounded-2xl md:text-base">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {filters.availableYears.map((year: number) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 md:text-lg">LGU</Label>
          <Select
            value={`${filters.selectedScopeType}:${filters.selectedScopeId}`}
            onValueChange={(value) => {
              const [scopeType, scopeId] = value.split(":");
              onLguChange(scopeType === "barangay" ? "barangay" : "city", scopeId ?? "");
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-gray-300 bg-white text-sm focus-visible:ring-cyan-500/40 md:h-12 md:rounded-2xl md:text-base">
              <SelectValue placeholder="Select LGU" />
            </SelectTrigger>
            <SelectContent>
              {filters.availableLGUs.map((option: BudgetAllocationLguOptionVM) => (
                <SelectItem key={optionValue(option)} value={optionValue(option)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
