import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BudgetAllocationFiltersVM } from "@/lib/domain/citizen-budget-allocation";

type FiltersSectionProps = {
  filters: BudgetAllocationFiltersVM;
  onYearChange: (year: number) => void;
  onCityChange: (scopeId: string) => void;
  onBarangayChange: (scopeId: string) => void;
};

export default function FiltersSection({
  filters,
  onYearChange,
  onCityChange,
  onBarangayChange,
}: FiltersSectionProps) {
  const hasCities = filters.availableCities.length > 0;
  const hasBarangays = filters.availableBarangays.length > 0;
  const selectedYearValue = String(filters.selectedYear);
  const isReselectKey = (key: string) => key === "Enter" || key === " ";

  return (
    <section className="mx-auto max-w-6xl px-3 pb-4 pt-0 sm:px-4 md:px-6 md:pb-6">
      <div className="grid w-full gap-3 sm:gap-4 md:grid-cols-3 md:gap-6">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 md:text-lg">Fiscal Year</Label>
          <Select
            value={String(filters.selectedYear)}
            onValueChange={(value) => onYearChange(Number(value))}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-gray-300 bg-white text-sm focus-visible:ring-cyan-500/40 md:h-12 md:rounded-2xl md:text-base">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {filters.availableYears.map((year: number) => (
                <SelectItem
                  key={year}
                  value={String(year)}
                  onPointerUp={() => {
                    if (String(year) === selectedYearValue) {
                      onYearChange(filters.selectedYear);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (String(year) === selectedYearValue && isReselectKey(event.key)) {
                      onYearChange(filters.selectedYear);
                    }
                  }}
                >
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 md:text-lg">City</Label>
          <Select
            value={hasCities ? filters.selectedCityScopeId : undefined}
            onValueChange={onCityChange}
            disabled={!hasCities}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-gray-300 bg-white text-sm focus-visible:ring-cyan-500/40 md:h-12 md:rounded-2xl md:text-base">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {filters.availableCities.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  onPointerUp={() => {
                    if (option.id === filters.selectedCityScopeId) {
                      onCityChange(filters.selectedCityScopeId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (option.id === filters.selectedCityScopeId && isReselectKey(event.key)) {
                      onCityChange(filters.selectedCityScopeId);
                    }
                  }}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 md:text-lg">Barangay</Label>
          <Select
            value={hasBarangays ? filters.selectedBarangayScopeId : undefined}
            onValueChange={onBarangayChange}
            disabled={!hasBarangays}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-gray-300 bg-white text-sm focus-visible:ring-cyan-500/40 md:h-12 md:rounded-2xl md:text-base">
              <SelectValue placeholder="Select barangay" />
            </SelectTrigger>
            <SelectContent>
              {filters.availableBarangays.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  onPointerUp={() => {
                    if (option.id === filters.selectedBarangayScopeId) {
                      onBarangayChange(filters.selectedBarangayScopeId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      option.id === filters.selectedBarangayScopeId &&
                      isReselectKey(event.key)
                    ) {
                      onBarangayChange(filters.selectedBarangayScopeId);
                    }
                  }}
                >
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
