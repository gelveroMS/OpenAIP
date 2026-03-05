"use client";

import { useMemo, useState } from "react";
import AipListCard from "@/features/citizen/aips/components/aip-list-card";
import CitizenExplainerCard from "@/features/citizen/components/citizen-explainer-card";
import CitizenFiltersBar from "@/features/citizen/components/citizen-filters-bar";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";
import type { AipFilterLguOption, AipListItem } from "@/features/citizen/aips/types";

type Props = {
  items: AipListItem[];
};

function toLguKey(option: { scopeType: string; scopeId: string }): string {
  return `${option.scopeType}:${option.scopeId}`;
}

function sortItems(input: AipListItem[]): AipListItem[] {
  return [...input].sort((left, right) => {
    if (left.fiscalYear !== right.fiscalYear) return right.fiscalYear - left.fiscalYear;
    const leftAt = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightAt = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightAt - leftAt;
  });
}

export default function CitizenAipsListView({ items }: Props) {
  const sortedItems = useMemo(() => sortItems(items), [items]);

  const lguOptions = useMemo<AipFilterLguOption[]>(() => {
    const map = new Map<string, AipFilterLguOption>();
    for (const item of sortedItems) {
      const key = toLguKey(item);
      if (map.has(key)) continue;
      map.set(key, {
        key,
        scopeType: item.scopeType,
        scopeId: item.scopeId,
        label: item.lguLabel,
      });
    }
    return Array.from(map.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [sortedItems]);

  const years = useMemo(() => {
    return Array.from(new Set(sortedItems.map((item) => item.fiscalYear))).sort((a, b) => b - a);
  }, [sortedItems]);

  const lgusByYear = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const item of sortedItems) {
      const key = toLguKey(item);
      const list = map.get(item.fiscalYear) ?? [];
      if (!list.includes(key)) list.push(key);
      map.set(item.fiscalYear, list);
    }
    return map;
  }, [sortedItems]);

  const yearsByLgu = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of sortedItems) {
      const key = toLguKey(item);
      const list = map.get(key) ?? [];
      if (!list.includes(item.fiscalYear)) list.push(item.fiscalYear);
      map.set(key, list.sort((a, b) => b - a));
    }
    return map;
  }, [sortedItems]);

  const defaultYear = years[0] ?? null;
  const defaultLguKey = defaultYear !== null ? (lgusByYear.get(defaultYear)?.[0] ?? null) : null;

  const [selectedYear, setSelectedYear] = useState<number | null>(defaultYear);
  const [selectedLguKey, setSelectedLguKey] = useState<string | null>(defaultLguKey);
  const [searchQuery, setSearchQuery] = useState("");

  const activeYear = selectedYear ?? defaultYear;
  const activeLguKey = selectedLguKey ?? defaultLguKey;

  const filteredAips = useMemo(() => {
    if (activeYear === null || !activeLguKey) return [];
    const loweredQuery = searchQuery.trim().toLowerCase();
    return sortedItems.filter((item) => {
      const yearMatch = item.fiscalYear === activeYear;
      const lguMatch = toLguKey(item) === activeLguKey;
      const searchMatch =
        !loweredQuery ||
        item.title.toLowerCase().includes(loweredQuery) ||
        item.description.toLowerCase().includes(loweredQuery) ||
        item.lguLabel.toLowerCase().includes(loweredQuery);

      return yearMatch && lguMatch && searchMatch;
    });
  }, [activeLguKey, activeYear, searchQuery, sortedItems]);

  const yearOptionsForLgu = useMemo(() => {
    if (!activeLguKey) return years;
    return yearsByLgu.get(activeLguKey) ?? years;
  }, [activeLguKey, years, yearsByLgu]);

  const lguOptionsForYear = useMemo(() => {
    if (activeYear === null) return lguOptions;
    const keys = new Set(lgusByYear.get(activeYear) ?? []);
    return lguOptions.filter((option) => keys.has(option.key));
  }, [activeYear, lguOptions, lgusByYear]);

  const yearSelectOptions = yearOptionsForLgu.map((year) => ({
    value: String(year),
    label: String(year),
  }));

  const lguSelectOptions = lguOptionsForYear.map((option) => ({
    value: option.key,
    label: option.label,
  }));

  const handleYearChange = (value: string) => {
    const nextYear = Number(value);
    if (!Number.isInteger(nextYear)) return;
    const validLguKeys = lgusByYear.get(nextYear) ?? [];
    const nextLgu =
      activeLguKey && validLguKeys.includes(activeLguKey) ? activeLguKey : validLguKeys[0] ?? null;
    setSelectedYear(nextYear);
    setSelectedLguKey(nextLgu);
  };

  const handleLguChange = (value: string) => {
    const validYears = yearsByLgu.get(value) ?? [];
    const nextYear =
      activeYear !== null && validYears.includes(activeYear) ? activeYear : validYears[0] ?? null;
    setSelectedLguKey(value);
    setSelectedYear(nextYear);
  };

  return (
    <section className="space-y-6">
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

      <CitizenFiltersBar
        yearOptions={yearSelectOptions}
        yearValue={activeYear !== null ? String(activeYear) : ""}
        onYearChange={handleYearChange}
        lguOptions={lguSelectOptions}
        lguValue={activeLguKey ?? ""}
        onLguChange={handleLguChange}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search AIPs..."
      />

      <p className="text-sm text-slate-500">
        Showing {filteredAips.length} result{filteredAips.length !== 1 ? "s" : ""}
      </p>

      <div className="space-y-4">
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
