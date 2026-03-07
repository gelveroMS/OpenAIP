import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import CitizenAipsListView from "./views/citizen-aips-list-view";
import type { AipListItem } from "./types";

vi.mock("@/features/citizen/components/citizen-page-hero", () => ({
  default: () => <div data-testid="hero" />,
}));

vi.mock("@/features/citizen/components/citizen-explainer-card", () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="explainer">{children}</div>
  ),
}));

vi.mock("@/features/citizen/aips/components/aip-list-card", () => ({
  default: ({ item }: { item: AipListItem }) => <div>{item.title}</div>,
}));

vi.mock("@/features/citizen/aips/components/aip-list-filters", () => ({
  default: ({
    yearOptions,
    cityOptions,
    barangayOptions,
    yearValue,
    cityValue,
    barangayValue,
    onYearChange,
    onCityChange,
    onBarangayChange,
  }: {
    yearOptions: Array<{ value: string; label: string }>;
    cityOptions: Array<{ value: string; label: string }>;
    barangayOptions: Array<{ value: string; label: string }>;
    yearValue: string;
    cityValue: string;
    barangayValue: string;
    onYearChange: (value: string) => void;
    onCityChange: (value: string) => void;
    onBarangayChange: (value: string) => void;
  }) => {
    const yearAll = yearOptions.find((option) => option.label === "All Years")?.value ?? "";
    const year2026 = yearOptions.find((option) => option.label === "2026")?.value ?? "";
    const cityAll = cityOptions.find((option) => option.label === "All Cities")?.value ?? "";
    const cityA = cityOptions.find((option) => option.label.includes("City A"))?.value ?? "";
    const cityB = cityOptions.find((option) => option.label.includes("City B"))?.value ?? "";
    const cityC = cityOptions.find((option) => option.label.includes("City C"))?.value ?? "";
    const barangayAll =
      barangayOptions.find((option) => option.label === "All Barangays")?.value ?? "";
    const barangayAlpha =
      barangayOptions.find((option) => option.label.includes("Brgy. Alpha"))?.value ?? "";

    return (
      <div data-testid="filters">
        <button onClick={() => onYearChange(yearAll)}>year-all</button>
        <button onClick={() => onYearChange(year2026)}>year-2026</button>
        <button onClick={() => onCityChange(cityAll)}>city-all</button>
        <button onClick={() => onCityChange(cityA)}>city-a</button>
        <button onClick={() => onCityChange(cityB)}>city-b</button>
        <button onClick={() => onCityChange(cityC)}>city-c</button>
        <button onClick={() => onBarangayChange(barangayAll)}>barangay-all</button>
        <button onClick={() => onBarangayChange(barangayAlpha)}>barangay-alpha</button>
        <div data-testid="selected-year">{yearValue}</div>
        <div data-testid="selected-city">{cityValue}</div>
        <div data-testid="selected-barangay">{barangayValue}</div>
        <div data-testid="city-options">{cityOptions.map((option) => option.label).join("|")}</div>
        <div data-testid="barangay-options">{barangayOptions.map((option) => option.label).join("|")}</div>
      </div>
    );
  },
}));

const ITEMS: AipListItem[] = [
  {
    id: "aip-a-2026",
    scopeType: "city",
    scopeId: "city-a",
    lguLabel: "City A",
    cityScopeId: "city-a",
    cityScopeLabel: "City A",
    barangayScopeId: null,
    barangayScopeLabel: null,
    title: "AIP City A 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-10",
    budgetTotal: 1000000,
    projectsCount: 1,
    description: "City A 2026",
  },
  {
    id: "aip-a-2025",
    scopeType: "city",
    scopeId: "city-a",
    lguLabel: "City A",
    cityScopeId: "city-a",
    cityScopeLabel: "City A",
    barangayScopeId: null,
    barangayScopeLabel: null,
    title: "AIP City A 2025",
    fiscalYear: 2025,
    publishedAt: "2025-01-10",
    budgetTotal: 900000,
    projectsCount: 1,
    description: "City A 2025",
  },
  {
    id: "aip-alpha-2026",
    scopeType: "barangay",
    scopeId: "brgy-alpha",
    lguLabel: "Brgy. Alpha",
    cityScopeId: "city-a",
    cityScopeLabel: "City A",
    barangayScopeId: "brgy-alpha",
    barangayScopeLabel: "Brgy. Alpha",
    title: "AIP Brgy Alpha 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-12",
    budgetTotal: 800000,
    projectsCount: 1,
    description: "Brgy Alpha 2026",
  },
  {
    id: "aip-alpha-2025",
    scopeType: "barangay",
    scopeId: "brgy-alpha",
    lguLabel: "Brgy. Alpha",
    cityScopeId: "city-a",
    cityScopeLabel: "City A",
    barangayScopeId: "brgy-alpha",
    barangayScopeLabel: "Brgy. Alpha",
    title: "AIP Brgy Alpha 2025",
    fiscalYear: 2025,
    publishedAt: "2025-01-12",
    budgetTotal: 780000,
    projectsCount: 1,
    description: "Brgy Alpha 2025",
  },
  {
    id: "aip-b-2026",
    scopeType: "city",
    scopeId: "city-b",
    lguLabel: "City B",
    cityScopeId: "city-b",
    cityScopeLabel: "City B",
    barangayScopeId: null,
    barangayScopeLabel: null,
    title: "AIP City B 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-09",
    budgetTotal: 1200000,
    projectsCount: 1,
    description: "City B 2026",
  },
  {
    id: "aip-beta-2026",
    scopeType: "barangay",
    scopeId: "brgy-beta",
    lguLabel: "Brgy. Beta",
    cityScopeId: "city-b",
    cityScopeLabel: "City B",
    barangayScopeId: "brgy-beta",
    barangayScopeLabel: "Brgy. Beta",
    title: "AIP Brgy Beta 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-11",
    budgetTotal: 760000,
    projectsCount: 1,
    description: "Brgy Beta 2026",
  },
  {
    id: "aip-c-2025",
    scopeType: "city",
    scopeId: "city-c",
    lguLabel: "City C",
    cityScopeId: "city-c",
    cityScopeLabel: "City C",
    barangayScopeId: null,
    barangayScopeLabel: null,
    title: "AIP City C 2025",
    fiscalYear: 2025,
    publishedAt: "2025-01-08",
    budgetTotal: 910000,
    projectsCount: 1,
    description: "City C 2025",
  },
  {
    id: "aip-gamma-2025",
    scopeType: "barangay",
    scopeId: "brgy-gamma",
    lguLabel: "Brgy. Gamma",
    cityScopeId: "city-c",
    cityScopeLabel: "City C",
    barangayScopeId: "brgy-gamma",
    barangayScopeLabel: "Brgy. Gamma",
    title: "AIP Brgy Gamma 2025",
    fiscalYear: 2025,
    publishedAt: "2025-01-09",
    budgetTotal: 560000,
    projectsCount: 1,
    description: "Brgy Gamma 2025",
  },
];

describe("CitizenAipsListView", () => {
  it("applies all-years default and hierarchical city/barangay filtering", () => {
    render(<CitizenAipsListView items={ITEMS} />);

    expect(screen.getByText(/Showing 8 results/)).toBeInTheDocument();
    expect(screen.getByText("AIP City A 2026")).toBeInTheDocument();
    expect(screen.getByText("AIP City B 2026")).toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Beta 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByText("city-a"));
    expect(screen.getByText(/Showing 4 results/)).toBeInTheDocument();
    expect(screen.getByText("AIP City A 2026")).toBeInTheDocument();
    expect(screen.queryByText("AIP City B 2026")).not.toBeInTheDocument();
    expect(screen.getByTestId("barangay-options").textContent).not.toContain("Brgy. Beta");

    fireEvent.click(screen.getByText("barangay-alpha"));
    expect(screen.getByText(/Showing 2 results/)).toBeInTheDocument();
    expect(screen.queryByText("AIP City A 2026")).not.toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Alpha 2026")).toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Alpha 2025")).toBeInTheDocument();

    fireEvent.click(screen.getByText("year-2026"));
    expect(screen.getByText(/Showing 1 result/)).toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Alpha 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByText("city-b"));
    expect(screen.getByText(/Showing 2 results/)).toBeInTheDocument();
    expect(screen.getByText("AIP City B 2026")).toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Beta 2026")).toBeInTheDocument();
    expect(screen.getByTestId("selected-barangay").textContent).toBe("all-barangays");
  });

  it("hides city/barangay options that have no published AIP for the selected year", () => {
    render(<CitizenAipsListView items={ITEMS} />);

    fireEvent.click(screen.getByText("city-c"));
    expect(screen.getByText(/Showing 2 results/)).toBeInTheDocument();
    expect(screen.getByText("AIP City C 2025")).toBeInTheDocument();
    expect(screen.getByText("AIP Brgy Gamma 2025")).toBeInTheDocument();

    fireEvent.click(screen.getByText("year-2026"));
    expect(screen.getByTestId("selected-city").textContent).toBe("all-cities");
    expect(screen.getByTestId("city-options").textContent).not.toContain("City C");
    expect(screen.getByTestId("barangay-options").textContent).not.toContain("Brgy. Gamma");
  });
});
