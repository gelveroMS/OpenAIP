export type BudgetAllocationRecord = {
  id: string;
  lguName: string;
  year: number;
  category: string;
  projectCount: number;
  budget: number;
  percentage: number;
};

export const BUDGET_ALLOCATION_DATA: BudgetAllocationRecord[] = [
  // City of Cabuyao 2026
  {
    id: "ba-city-2026-general",
    lguName: "City of Cabuyao",
    year: 2026,
    category: "General Services",
    projectCount: 12,
    budget: 15000000,
    percentage: 33,
  },
  {
    id: "ba-city-2026-social",
    lguName: "City of Cabuyao",
    year: 2026,
    category: "Social Services",
    projectCount: 18,
    budget: 18000000,
    percentage: 40,
  },
  {
    id: "ba-city-2026-economic",
    lguName: "City of Cabuyao",
    year: 2026,
    category: "Economic Services",
    projectCount: 8,
    budget: 9000000,
    percentage: 20,
  },
  {
    id: "ba-city-2026-other",
    lguName: "City of Cabuyao",
    year: 2026,
    category: "Other Services",
    projectCount: 7,
    budget: 3000000,
    percentage: 7,
  },

  // City of Cabuyao 2025
  {
    id: "ba-city-2025-general",
    lguName: "City of Cabuyao",
    year: 2025,
    category: "General Services",
    projectCount: 10,
    budget: 12000000,
    percentage: 32,
  },
  {
    id: "ba-city-2025-social",
    lguName: "City of Cabuyao",
    year: 2025,
    category: "Social Services",
    projectCount: 16,
    budget: 15000000,
    percentage: 40,
  },
  {
    id: "ba-city-2025-economic",
    lguName: "City of Cabuyao",
    year: 2025,
    category: "Economic Services",
    projectCount: 7,
    budget: 8000000,
    percentage: 21,
  },
  {
    id: "ba-city-2025-other",
    lguName: "City of Cabuyao",
    year: 2025,
    category: "Other Services",
    projectCount: 6,
    budget: 2500000,
    percentage: 7,
  },

  // Barangay Mamadid 2026
  {
    id: "ba-mamadid-2026-general",
    lguName: "Brgy. Mamadid",
    year: 2026,
    category: "General Services",
    projectCount: 4,
    budget: 2000000,
    percentage: 34,
  },
  {
    id: "ba-mamadid-2026-social",
    lguName: "Brgy. Mamadid",
    year: 2026,
    category: "Social Services",
    projectCount: 5,
    budget: 2300000,
    percentage: 40,
  },
  {
    id: "ba-mamadid-2026-economic",
    lguName: "Brgy. Mamadid",
    year: 2026,
    category: "Economic Services",
    projectCount: 2,
    budget: 1000000,
    percentage: 17,
  },
  {
    id: "ba-mamadid-2026-other",
    lguName: "Brgy. Mamadid",
    year: 2026,
    category: "Other Services",
    projectCount: 2,
    budget: 500000,
    percentage: 9,
  },

  // Barangay Mamadid 2025
  {
    id: "ba-mamadid-2025-general",
    lguName: "Brgy. Mamadid",
    year: 2025,
    category: "General Services",
    projectCount: 3,
    budget: 1500000,
    percentage: 36,
  },
  {
    id: "ba-mamadid-2025-social",
    lguName: "Brgy. Mamadid",
    year: 2025,
    category: "Social Services",
    projectCount: 4,
    budget: 1800000,
    percentage: 43,
  },
  {
    id: "ba-mamadid-2025-economic",
    lguName: "Brgy. Mamadid",
    year: 2025,
    category: "Economic Services",
    projectCount: 2,
    budget: 700000,
    percentage: 17,
  },
  {
    id: "ba-mamadid-2025-other",
    lguName: "Brgy. Mamadid",
    year: 2025,
    category: "Other Services",
    projectCount: 1,
    budget: 200000,
    percentage: 4,
  },

  // Barangay Poblacion 2026
  {
    id: "ba-poblacion-2026-general",
    lguName: "Brgy. Poblacion",
    year: 2026,
    category: "General Services",
    projectCount: 6,
    budget: 2800000,
    percentage: 33,
  },
  {
    id: "ba-poblacion-2026-social",
    lguName: "Brgy. Poblacion",
    year: 2026,
    category: "Social Services",
    projectCount: 8,
    budget: 3400000,
    percentage: 40,
  },
  {
    id: "ba-poblacion-2026-economic",
    lguName: "Brgy. Poblacion",
    year: 2026,
    category: "Economic Services",
    projectCount: 3,
    budget: 1700000,
    percentage: 20,
  },
  {
    id: "ba-poblacion-2026-other",
    lguName: "Brgy. Poblacion",
    year: 2026,
    category: "Other Services",
    projectCount: 3,
    budget: 700000,
    percentage: 7,
  },

  // Barangay Poblacion 2025
  {
    id: "ba-poblacion-2025-general",
    lguName: "Brgy. Poblacion",
    year: 2025,
    category: "General Services",
    projectCount: 5,
    budget: 2200000,
    percentage: 31,
  },
  {
    id: "ba-poblacion-2025-social",
    lguName: "Brgy. Poblacion",
    year: 2025,
    category: "Social Services",
    projectCount: 7,
    budget: 3000000,
    percentage: 42,
  },
  {
    id: "ba-poblacion-2025-economic",
    lguName: "Brgy. Poblacion",
    year: 2025,
    category: "Economic Services",
    projectCount: 3,
    budget: 1400000,
    percentage: 20,
  },
  {
    id: "ba-poblacion-2025-other",
    lguName: "Brgy. Poblacion",
    year: 2025,
    category: "Other Services",
    projectCount: 2,
    budget: 400000,
    percentage: 7,
  },
];

/**
 * Get budget allocation for a specific LGU and year
 */
export function getBudgetAllocationByLguAndYear(
  lguName: string,
  year: number
): BudgetAllocationRecord[] {
  return BUDGET_ALLOCATION_DATA.filter(
    (record) => record.lguName === lguName && record.year === year
  );
}

/**
 * Get summary totals for budget allocation by LGU and year
 */
export function getBudgetAllocationSummary(
  lguName: string,
  year: number
): {
  totalBudget: number;
  totalProjects: number;
  categories: BudgetAllocationRecord[];
} {
  const categories = getBudgetAllocationByLguAndYear(lguName, year);
  const totalBudget = categories.reduce((sum, cat) => sum + cat.budget, 0);
  const totalProjects = categories.reduce((sum, cat) => sum + cat.projectCount, 0);

  return {
    totalBudget,
    totalProjects,
    categories,
  };
}

/**
 * Get all available LGUs from budget allocation data
 */
export function getAllLgusFromBudgetAllocation(): string[] {
  return Array.from(new Set(BUDGET_ALLOCATION_DATA.map((record) => record.lguName)));
}

/**
 * Get all available years from budget allocation data
 */
export function getAllYearsFromBudgetAllocation(): number[] {
  return Array.from(new Set(BUDGET_ALLOCATION_DATA.map((record) => record.year))).sort(
    (a, b) => b - a
  );
}
