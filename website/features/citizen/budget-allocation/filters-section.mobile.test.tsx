import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FiltersSection from "./components/filters-section";

describe("FiltersSection mobile layout", () => {
  it("uses one-column full-width mobile layout with compact select trigger heights", () => {
    const { container } = render(
      <FiltersSection
        filters={{
          selectedYear: 2026,
          availableYears: [2026, 2025],
          selectedScopeType: "city",
          selectedScopeId: "11111111-1111-4111-8111-111111111111",
          selectedCityScopeId: "11111111-1111-4111-8111-111111111111",
          selectedBarangayScopeId: "",
          availableLGUs: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              label: "City of Cabuyao",
              scopeType: "city",
              cityScopeId: "11111111-1111-4111-8111-111111111111",
              cityScopeLabel: "City of Cabuyao",
            },
          ],
          availableCities: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              label: "City of Cabuyao",
            },
          ],
          availableBarangays: [],
          searchText: "",
        }}
        onYearChange={vi.fn()}
        onCityChange={vi.fn()}
        onBarangayChange={vi.fn()}
      />
    );

    expect(screen.getByText("Fiscal Year")).toBeInTheDocument();
    expect(screen.getByText("City")).toBeInTheDocument();
    expect(screen.getByText("Barangay")).toBeInTheDocument();

    const grid = container.querySelector("div.grid");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("w-full");
    expect(grid?.className).toContain("md:grid-cols-3");

    const triggers = container.querySelectorAll("[data-slot='select-trigger']");
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger.className).toContain("h-10");
      expect(trigger.className).toContain("md:h-12");
      expect(trigger.className).toContain("w-full");
    }
  });
});
