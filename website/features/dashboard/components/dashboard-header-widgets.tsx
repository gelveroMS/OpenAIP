"use client";

import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCallback, useRef } from "react";
import type { ProjectCategory } from "@/lib/contracts/databasev2/enums";

export function DashboardHeader({
  title,
  q = "",
  tableQ = "",
  tableCategory = "all",
  tableSector = "all",
  selectedFiscalYear,
  availableFiscalYears = [],
  kpiMode = "summary",
}: {
  title: string;
  q?: string;
  tableQ?: string;
  tableCategory?: ProjectCategory | "all";
  tableSector?: string | "all";
  selectedFiscalYear?: number;
  availableFiscalYears?: number[];
  kpiMode?: "summary" | "operational";
}) {
  const resolvedYear = selectedFiscalYear ?? new Date().getFullYear();
  const yearOptions = availableFiscalYears.length > 0 ? availableFiscalYears : [resolvedYear];
  const formRef = useRef<HTMLFormElement | null>(null);
  const tableQRef = useRef<HTMLInputElement | null>(null);
  const categoryRef = useRef<HTMLInputElement | null>(null);
  const sectorRef = useRef<HTMLInputElement | null>(null);

  const syncTopFiltersFromUrl = useCallback(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const tableQFromUrl = params.get("tableQ");
    const categoryFromUrl = params.get("category");
    const sectorFromUrl = params.get("sector");

    if (tableQRef.current) tableQRef.current.value = tableQFromUrl ?? tableQ;
    if (categoryRef.current) categoryRef.current.value = categoryFromUrl ?? tableCategory;
    if (sectorRef.current) sectorRef.current.value = sectorFromUrl ?? tableSector;
  }, [tableQ, tableCategory, tableSector]);

  const submitWithSyncedFilters = useCallback(() => {
    syncTopFiltersFromUrl();
    formRef.current?.requestSubmit();
  }, [syncTopFiltersFromUrl]);

  return (
    <div className="w-full space-y-4 sm:space-y-5">
      <h1 className="break-words text-xl font-bold leading-tight text-foreground sm:text-3xl lg:text-4xl xl:text-5xl">
        {title}
      </h1>
      <form
        ref={formRef}
        method="get"
        className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3"
      >
        <input type="hidden" name="kpi" value={kpiMode} />
        <input type="hidden" name="q" value={q} />
        <input ref={tableQRef} type="hidden" name="tableQ" defaultValue={tableQ} />
        <input ref={categoryRef} type="hidden" name="category" defaultValue={tableCategory} />
        <input ref={sectorRef} type="hidden" name="sector" defaultValue={tableSector} />
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
          <span className="text-sm text-muted-foreground sm:text-xs">Year:</span>
          <div className="relative">
            <select
              name="year"
              defaultValue={String(resolvedYear)}
              onChange={() => submitWithSyncedFilters()}
              className="h-9 w-full min-w-[120px] appearance-none rounded-lg border-0 bg-secondary px-3 pr-8 text-sm text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-10"
              aria-label="Select Year"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-70" aria-hidden />
          </div>
        </div>
      </form>
    </div>
  );
}

export function GlobalSearchWidget({
  value = "",
  onChange,
  onSubmit,
}: {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
      className="relative h-9 w-full rounded-lg bg-secondary sm:h-8 sm:max-w-[272px]"
      aria-label="Global Search"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="Global search..."
        className="h-full w-full rounded-lg bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Global search"
      />
    </form>
  );
}

export function YearDropdownWidget({
  label = "Year:",
  value,
  options,
  onChange,
}: {
  label?: string;
  value: number | string;
  options: Array<number | string>;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="relative h-9 w-full min-w-[115px] rounded-lg bg-secondary hover:bg-secondary/80 sm:h-8 sm:w-[115.2px]">
        <select
          value={String(value)}
          onChange={(event) => onChange?.(event.target.value)}
          className="h-full w-full appearance-none rounded-lg bg-transparent px-3 pr-8 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Select Year"
        >
          {options.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-70" aria-hidden />
      </div>
    </div>
  );
}

export function DateCard({ label, backgroundImageUrl }: { label: string; backgroundImageUrl?: string }) {
  const parsed = new Date(label);
  const hasDate = !Number.isNaN(parsed.getTime());
  const dayNumber = hasDate ? parsed.toLocaleDateString("en-PH", { day: "2-digit" }) : "--";
  const weekday = hasDate ? parsed.toLocaleDateString("en-PH", { weekday: "long" }).toUpperCase() : "TODAY";
  const monthYear = hasDate
    ? parsed.toLocaleDateString("en-PH", { month: "long", year: "numeric" }).toUpperCase()
    : label.toUpperCase();

  return (
    <Card
      className="relative h-[72px] w-full min-w-0 overflow-hidden rounded-xl border-0 py-0 sm:h-[79px]"
    >
      {backgroundImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundImageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/60 to-foreground/40" />
      <CardContent className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 text-primary-foreground">
          <div className="font-[var(--font-heading)] text-3xl font-semibold leading-none sm:text-5xl">{dayNumber}</div>
          <div className="min-w-0">
            <div className="truncate font-[var(--font-sans)] text-xs leading-relaxed sm:text-sm">{weekday}</div>
            <div className="truncate font-[var(--font-sans)] text-xs leading-relaxed sm:text-sm">{monthYear}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkingOnCard({ items }: { items: Array<{ id: string; label: string; href: string }> }) {
  return (
    <Card className="w-full min-w-0 rounded-xl border border-border bg-card py-0 text-card-foreground">
      <CardHeader className="px-4 pt-4 sm:px-6 sm:pt-5">
        <CardTitle className="text-base font-medium sm:text-lg">You&apos;re Working On</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 px-4 pb-4 sm:space-y-3 sm:px-6 sm:pb-5">
        {items.length === 0 ? (
          <div className="mt-6 text-center text-lg font-semibold sm:mt-10 sm:text-xl">All Caught Up</div>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-lg border border-border bg-card p-3 text-sm text-card-foreground hover:bg-accent"
            >
              <span className="line-clamp-2">{item.label}</span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
