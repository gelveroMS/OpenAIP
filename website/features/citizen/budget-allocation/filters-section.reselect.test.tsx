import { fireEvent, render, screen } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import FiltersSection from "./components/filters-section";

type SelectContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
};

const SelectContext = createContext<SelectContextValue>({});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div data-testid="mock-select">{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    value,
    onPointerUp,
    onKeyDown,
    children,
  }: {
    value: string;
    onPointerUp?: () => void;
    onKeyDown?: (event: { key: string }) => void;
    children: ReactNode;
  }) => {
    const context = useContext(SelectContext);
    return (
      <button
        type="button"
        onPointerUp={() => {
          onPointerUp?.();
          if (context.value !== value) {
            context.onValueChange?.(value);
          }
        }}
        onKeyDown={(event) => onKeyDown?.({ key: event.key })}
      >
        {children}
      </button>
    );
  },
}));

describe("FiltersSection reselection behavior", () => {
  const baseFilters = {
    selectedYear: 2026,
    availableYears: [2026, 2025],
    selectedScopeType: "city" as const,
    selectedScopeId: "11111111-1111-4111-8111-111111111111",
    selectedCityScopeId: "11111111-1111-4111-8111-111111111111",
    selectedBarangayScopeId: "33333333-3333-4333-8333-333333333333",
    availableLGUs: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        label: "City of Cabuyao",
        scopeType: "city" as const,
        cityScopeId: "11111111-1111-4111-8111-111111111111",
        cityScopeLabel: "City of Cabuyao",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "City of Beta",
        scopeType: "city" as const,
        cityScopeId: "22222222-2222-4222-8222-222222222222",
        cityScopeLabel: "City of Beta",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        label: "Brgy. One",
        scopeType: "barangay" as const,
        cityScopeId: "11111111-1111-4111-8111-111111111111",
        cityScopeLabel: "City of Cabuyao",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        label: "Brgy. Two",
        scopeType: "barangay" as const,
        cityScopeId: "11111111-1111-4111-8111-111111111111",
        cityScopeLabel: "City of Cabuyao",
      },
    ],
    availableCities: [
      { id: "11111111-1111-4111-8111-111111111111", label: "City of Cabuyao" },
      { id: "22222222-2222-4222-8222-222222222222", label: "City of Beta" },
    ],
    availableBarangays: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        label: "Brgy. One",
        cityScopeId: "11111111-1111-4111-8111-111111111111",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        label: "Brgy. Two",
        cityScopeId: "11111111-1111-4111-8111-111111111111",
      },
    ],
    searchText: "",
  };

  it("triggers callbacks when currently selected options are clicked", () => {
    const onYearChange = vi.fn();
    const onCityChange = vi.fn();
    const onBarangayChange = vi.fn();

    render(
      <FiltersSection
        filters={baseFilters}
        onYearChange={onYearChange}
        onCityChange={onCityChange}
        onBarangayChange={onBarangayChange}
      />
    );

    fireEvent.pointerUp(screen.getByRole("button", { name: "2026" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "City of Cabuyao" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "Brgy. One" }));

    expect(onYearChange).toHaveBeenCalledTimes(1);
    expect(onYearChange).toHaveBeenCalledWith(2026);
    expect(onCityChange).toHaveBeenCalledTimes(1);
    expect(onCityChange).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(onBarangayChange).toHaveBeenCalledTimes(1);
    expect(onBarangayChange).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333"
    );
  });

  it("does not double-fire callbacks when selecting a different option", () => {
    const onYearChange = vi.fn();
    const onCityChange = vi.fn();
    const onBarangayChange = vi.fn();

    render(
      <FiltersSection
        filters={baseFilters}
        onYearChange={onYearChange}
        onCityChange={onCityChange}
        onBarangayChange={onBarangayChange}
      />
    );

    fireEvent.pointerUp(screen.getByRole("button", { name: "2025" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "City of Beta" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "Brgy. Two" }));

    expect(onYearChange).toHaveBeenCalledTimes(1);
    expect(onYearChange).toHaveBeenCalledWith(2025);
    expect(onCityChange).toHaveBeenCalledTimes(1);
    expect(onCityChange).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    expect(onBarangayChange).toHaveBeenCalledTimes(1);
    expect(onBarangayChange).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444"
    );
  });
});
