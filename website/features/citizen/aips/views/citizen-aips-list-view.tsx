"use client";

import { useEffect, useMemo, useState } from "react";
import AipListCard from "@/features/citizen/aips/components/aip-list-card";
import AipListFilters, {
  type AipScopeLevel,
} from "@/features/citizen/aips/components/aip-list-filters";
import CitizenExplainerCard from "@/features/citizen/components/citizen-explainer-card";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";
import type { AipListItem } from "@/features/citizen/aips/types";

type Props = {
  items: AipListItem[];
};

const ALL_YEARS = "all-years";
const ALL_CITIES = "all-cities";
const ALL_BARANGAYS = "all-barangays";
const UNKNOWN_CITY_ID = "unknown-city";
const SCOPE_LEVEL_OPTIONS: Array<{ value: AipScopeLevel; label: string }> = [
  { value: "both", label: "Both" },
  { value: "city", label: "City Only" },
  { value: "barangay", label: "Barangay Only" },
];

function sortItems(input: AipListItem[]): AipListItem[] {
  return [...input].sort((left, right) => {
    if (left.fiscalYear !== right.fiscalYear) return right.fiscalYear - left.fiscalYear;
    const leftAt = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightAt = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightAt - leftAt;
  });
}

function normalizeCityLabel(label: string | null | undefined): string {
  const trimmed = label?.trim() ?? "";
  if (!trimmed) return "City of Unknown";
  if (/\bcity\b/i.test(trimmed)) return trimmed;
  return `City of ${trimmed}`;
}

function getCityScope(item: AipListItem): { id: string; label: string } {
  const cityScopeId = item.cityScopeId?.trim() ?? "";
  const cityScopeLabel = item.cityScopeLabel?.trim() ?? "";

  if (cityScopeId) {
    return {
      id: cityScopeId,
      label: normalizeCityLabel(cityScopeLabel || item.lguLabel),
    };
  }

  if (item.scopeType === "city") {
    return {
      id: item.scopeId,
      label: normalizeCityLabel(item.lguLabel),
    };
  }

  return {
    id: UNKNOWN_CITY_ID,
    label: "City of Unknown",
  };
}

function getBarangayScope(item: AipListItem): { id: string; label: string; cityId: string } | null {
  if (item.scopeType !== "barangay") return null;

  const barangayId = (item.barangayScopeId?.trim() || item.scopeId.trim()) ?? "";
  if (!barangayId) return null;

  const cityScope = getCityScope(item);
  return {
    id: barangayId,
    label: item.barangayScopeLabel?.trim() || item.lguLabel,
    cityId: cityScope.id,
  };
}

export default function CitizenAipsListView({ items }: Props) {
  const sortedItems = useMemo(() => sortItems(items), [items]);
  const [selectedYear, setSelectedYear] = useState<string>(ALL_YEARS);
  const [selectedScopeLevel, setSelectedScopeLevel] = useState<AipScopeLevel>("both");
  const [selectedCity, setSelectedCity] = useState<string>(ALL_CITIES);
  const [selectedBarangay, setSelectedBarangay] = useState<string>(ALL_BARANGAYS);

  const years = useMemo<number[]>(() => {
    return Array.from(new Set(sortedItems.map((item) => item.fiscalYear))).sort((a, b) => b - a);
  }, [sortedItems]);

  const yearScopedItems = useMemo(() => {
    if (selectedYear === ALL_YEARS) return sortedItems;
    const year = Number(selectedYear);
    return sortedItems.filter((item) => item.fiscalYear === year);
  }, [selectedYear, sortedItems]);

  const levelScopedItems = useMemo(() => {
    if (selectedScopeLevel === "both") return yearScopedItems;
    return yearScopedItems.filter((item) => item.scopeType === selectedScopeLevel);
  }, [selectedScopeLevel, yearScopedItems]);

  const cityOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const item of levelScopedItems) {
      const cityScope = getCityScope(item);
      if (map.has(cityScope.id)) continue;
      map.set(cityScope.id, {
        value: cityScope.id,
        label: cityScope.label,
      });
    }

    return [
      { value: ALL_CITIES, label: "All Cities" },
      ...Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label)),
    ];
  }, [levelScopedItems]);

  const barangayOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; cityId: string }>();

    for (const item of levelScopedItems) {
      const barangayScope = getBarangayScope(item);
      if (!barangayScope) continue;

      if (selectedCity !== ALL_CITIES && barangayScope.cityId !== selectedCity) continue;
      if (map.has(barangayScope.id)) continue;

      map.set(barangayScope.id, {
        value: barangayScope.id,
        label: barangayScope.label,
        cityId: barangayScope.cityId,
      });
    }

    return [
      { value: ALL_BARANGAYS, label: "All Barangays" },
      ...Array.from(map.values())
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((option) => ({ value: option.value, label: option.label })),
    ];
  }, [levelScopedItems, selectedCity]);

  useEffect(() => {
    if (selectedCity === ALL_CITIES) return;
    if (cityOptions.some((option) => option.value === selectedCity)) return;
    setSelectedCity(ALL_CITIES);
  }, [cityOptions, selectedCity]);

  useEffect(() => {
    if (selectedScopeLevel === "city") {
      setSelectedBarangay(ALL_BARANGAYS);
    }
  }, [selectedScopeLevel]);

  useEffect(() => {
    if (selectedBarangay === ALL_BARANGAYS) return;
    if (selectedScopeLevel === "city") {
      setSelectedBarangay(ALL_BARANGAYS);
      return;
    }
    if (barangayOptions.some((option) => option.value === selectedBarangay)) return;
    setSelectedBarangay(ALL_BARANGAYS);
  }, [barangayOptions, selectedBarangay, selectedScopeLevel]);

  const filteredAips = useMemo(() => {
    return sortedItems.filter((item) => {
      if (selectedYear !== ALL_YEARS && item.fiscalYear !== Number(selectedYear)) {
        return false;
      }

      if (selectedScopeLevel !== "both" && item.scopeType !== selectedScopeLevel) {
        return false;
      }

      const cityScope = getCityScope(item);
      if (selectedCity !== ALL_CITIES && cityScope.id !== selectedCity) {
        return false;
      }

      if (selectedScopeLevel !== "city" && selectedBarangay !== ALL_BARANGAYS) {
        const barangayScope = getBarangayScope(item);
        if (!barangayScope) return false;
        return barangayScope.id === selectedBarangay;
      }

      return true;
    });
  }, [selectedBarangay, selectedCity, selectedScopeLevel, selectedYear, sortedItems]);

  const yearOptions = useMemo(
    () => [
      { value: ALL_YEARS, label: "All Years" },
      ...years.map((year) => ({ value: String(year), label: String(year) })),
    ],
    [years]
  );

  return (
    <section className="space-y-4 md:space-y-6">
      <CitizenPageHero
        title="Annual Investment Plans"
        subtitle="Explore how your city or barangay plans to use public funds for programs, projects, and community development throughout the year."
        imageSrc="/citizen-dashboard/hero2.webp"
      />

      <CitizenExplainerCard title="What is an Annual Investment Plan?">
        <>
          <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
            The AIP is your local government&apos;s official roadmap for the year. It lists planned programs,
            projects, and activities, together with their approved budgets.
          </p>
          <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
            This page allows citizens to review the full document, understand budget priorities, and see how public
            funds are intended to benefit the community.
          </p>
        </>
      </CitizenExplainerCard>

      <AipListFilters
        yearOptions={yearOptions}
        yearValue={selectedYear}
        onYearChange={setSelectedYear}
        scopeLevelOptions={SCOPE_LEVEL_OPTIONS}
        scopeLevelValue={selectedScopeLevel}
        onScopeLevelChange={setSelectedScopeLevel}
        cityOptions={cityOptions}
        cityValue={selectedCity}
        onCityChange={setSelectedCity}
        barangayOptions={barangayOptions}
        barangayValue={selectedBarangay}
        onBarangayChange={setSelectedBarangay}
      />

      <p className="text-xs text-slate-500 md:text-sm">
        Showing {filteredAips.length} result{filteredAips.length !== 1 ? "s" : ""}
      </p>

      <div className="space-y-3 md:space-y-4">
        {filteredAips.map((item) => (
          <AipListCard key={item.id} item={item} />
        ))}

        {filteredAips.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No AIPs matched the selected filters.
          </div>
        )}
      </div>
    </section>
  );
}
