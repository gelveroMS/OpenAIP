import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AipDetailsSection from "./components/aip-details-section";

describe("AipDetailsSection mobile layout", () => {
  it("renders compact four-column mobile tabs and table in contained overflow region", () => {
    render(
      <AipDetailsSection
        vm={{
          title: "City Budget Details",
          subtitle: "Details for FY 2026",
          activeTab: "general",
          tabs: [
            { key: "general", label: "General Sector" },
            { key: "social", label: "Social Sector" },
            { key: "economic", label: "Economic Sector" },
            { key: "other", label: "Other Sector" },
          ],
          rows: [
            {
              categoryKey: "general",
              aipRefCode: "1000-02-01-001",
              programDescription: "Road rehabilitation and facility support",
              totalAmount: 5_000_000,
            },
          ],
          searchText: "",
        }}
        onTabChange={vi.fn()}
        onSearchChange={vi.fn()}
        viewAllHref="/aips"
        page={1}
        totalPages={2}
        onPageChange={vi.fn()}
      />
    );

    const tabList = screen.getByRole("tablist");
    expect(tabList.className).toContain("grid-cols-4");
    expect(tabList.className).toContain("w-full");
    expect(tabList.className).toContain("md:!flex");
    expect(tabList.className).toContain("min-w-max");

    const table = screen.getByRole("table");
    expect(table.className).toContain("min-w-[640px]");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });
});
