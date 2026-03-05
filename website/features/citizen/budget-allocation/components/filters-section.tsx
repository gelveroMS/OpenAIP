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
    <section className="mx-auto flex max-w-6xl justify-end px-6 pb-6 pt-0">
      <div className="grid w-fit gap-6 md:grid-cols-2">
        <div className="space-y-2 justify-self-end">
          <Label className="text-lg font-medium text-slate-700">Fiscal Year</Label>
          <Select value={String(filters.selectedYear)} onValueChange={(value) => onYearChange(Number(value))}>
            <SelectTrigger className="h-12 w-36 rounded-2xl border-gray-300 bg-white text-base focus-visible:ring-cyan-500/40">
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

        <div className="space-y-2 justify-self-end">
          <Label className="text-lg font-medium text-slate-700">LGU</Label>
          <Select
            value={`${filters.selectedScopeType}:${filters.selectedScopeId}`}
            onValueChange={(value) => {
              const [scopeType, scopeId] = value.split(":");
              onLguChange(scopeType === "barangay" ? "barangay" : "city", scopeId ?? "");
            }}
          >
            <SelectTrigger className="h-12 rounded-2xl border-gray-300 bg-white text-base focus-visible:ring-cyan-500/40">
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
