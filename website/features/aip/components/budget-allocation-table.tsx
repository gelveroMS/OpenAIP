"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPeso } from "@/lib/formatting";
import type { AipProjectRow } from "../types";
import { SECTOR_TABS } from "../utils";

export type BudgetAllocationRow = {
  category: string;
  projectCount: number;
  budget: number;
  percentage: number;
};

function orderSectors(sectors: string[]) {
  function isSectorTab(value: string): value is (typeof SECTOR_TABS)[number] {
    return (SECTOR_TABS as readonly string[]).includes(value);
  }

  const ordered = SECTOR_TABS.filter((s) => sectors.includes(s));
  const rest = sectors.filter((s) => !isSectorTab(s));
  return [...ordered, ...rest];
}

export function buildBudgetAllocation(rows: AipProjectRow[]): {
  rows: BudgetAllocationRow[];
  totalBudget: number;
  totalProjects: number;
  coveredPercentage: number;
} {
  return buildBudgetAllocationWithOptions(rows);
}

export function buildBudgetAllocationWithOptions(
  rows: AipProjectRow[],
  options?: { displayTotalBudget?: number | null }
): {
  rows: BudgetAllocationRow[];
  totalBudget: number;
  totalProjects: number;
  coveredPercentage: number;
} {
  const map = new Map<string, { count: number; budget: number }>();

  for (const row of rows) {
    const key = row.sector ?? "Unknown";
    const current = map.get(key) ?? { count: 0, budget: 0 };
    current.count += 1;
    current.budget += row.amount ?? 0;
    map.set(key, current);
  }

  const categories = orderSectors(Array.from(map.keys()));
  const projectTotalBudget = categories.reduce((sum, key) => sum + (map.get(key)?.budget ?? 0), 0);
  const totalProjects = categories.reduce((sum, key) => sum + (map.get(key)?.count ?? 0), 0);
  const displayTotalBudget = options?.displayTotalBudget;
  const hasDisplayTotalBudget =
    typeof displayTotalBudget === "number" && Number.isFinite(displayTotalBudget);
  let denominator = projectTotalBudget;
  if (hasDisplayTotalBudget) {
    denominator =
      displayTotalBudget <= 0
        ? displayTotalBudget
        : Math.max(displayTotalBudget, projectTotalBudget);
  }

  if (denominator <= 0) {
    return {
      rows: categories.map((key) => ({
        category: key === "Unknown" ? "Unassigned" : key,
        projectCount: map.get(key)?.count ?? 0,
        budget: map.get(key)?.budget ?? 0,
        percentage: 0,
      })),
      totalBudget: denominator,
      totalProjects,
      coveredPercentage: 0,
    };
  }

  return {
    rows: categories.map((key) => ({
      category: key === "Unknown" ? "Unassigned" : key,
      projectCount: map.get(key)?.count ?? 0,
      budget: map.get(key)?.budget ?? 0,
      percentage: Number((((map.get(key)?.budget ?? 0) / denominator) * 100).toFixed(1)),
    })),
    totalBudget: denominator,
    totalProjects,
    coveredPercentage: Number(((projectTotalBudget / denominator) * 100).toFixed(1)),
  };
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const normalized = Number(value.toFixed(1));
  return `${normalized % 1 === 0 ? normalized.toFixed(0) : normalized.toFixed(1)}%`;
}

export function BudgetAllocationTable({
  rows,
  totalBudget,
  totalProjects,
  coveredPercentage,
}: {
  rows: BudgetAllocationRow[];
  totalBudget: number;
  totalProjects: number;
  coveredPercentage: number;
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="px-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Budget Allocation Table</h3>
          <p className="mt-2 text-xs text-slate-500">Breakdown by project category</p>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="text-xs text-slate-600 font-semibold">Category</TableHead>
                <TableHead className="text-xs text-slate-600 font-semibold text-right">No. of Projects</TableHead>
                <TableHead className="text-xs text-slate-600 font-semibold text-right">Budget (₱)</TableHead>
                <TableHead className="text-xs text-slate-600 font-semibold text-right">Percentage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="text-xs text-slate-700">{row.category}</TableCell>
                  <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                    {row.projectCount}
                  </TableCell>
                  <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                    {formatPeso(row.budget)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                    {formatPercentage(row.percentage)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell className="text-xs text-slate-700">Total</TableCell>
                <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                  {totalProjects}
                </TableCell>
                <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                  {formatPeso(totalBudget)}
                </TableCell>
                <TableCell className="text-xs text-slate-700 text-right tabular-nums">
                  {formatPercentage(coveredPercentage)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
