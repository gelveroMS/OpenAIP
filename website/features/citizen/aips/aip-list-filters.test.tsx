import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AipListFilters from "./components/aip-list-filters";

describe("AipListFilters mobile layout", () => {
  it("keeps a one-column mobile layout with compact trigger heights", () => {
    const { container } = render(
      <AipListFilters
        yearOptions={[
          { value: "all", label: "All Years" },
          { value: "2026", label: "2026" },
        ]}
        yearValue="all"
        onYearChange={() => {}}
        cityOptions={[
          { value: "all", label: "All Cities" },
          { value: "city-1", label: "City of Cabuyao" },
        ]}
        cityValue="all"
        onCityChange={() => {}}
        barangayOptions={[
          { value: "all", label: "All Barangays" },
          { value: "brgy-1", label: "Mamatid" },
        ]}
        barangayValue="all"
        onBarangayChange={() => {}}
      />
    );

    expect(screen.getByText("Filters")).toBeInTheDocument();
    const grid = container.querySelector("div.grid");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("md:grid-cols-3");

    const triggers = container.querySelectorAll("[data-slot='select-trigger']");
    expect(triggers.length).toBe(3);
    for (const trigger of triggers) {
      expect(trigger.className).toContain("h-10");
      expect(trigger.className).toContain("md:h-11");
    }
  });
});
