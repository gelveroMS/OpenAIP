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
  const totalBudget = categories.reduce((sum, key) => sum + (map.get(key)?.budget ?? 0), 0);
  const totalProjects = categories.reduce((sum, key) => sum + (map.get(key)?.count ?? 0), 0);

  if (totalBudget <= 0) {
    return {
      rows: categories.map((key) => ({
        category: key === "Unknown" ? "Unassigned" : key,
        projectCount: map.get(key)?.count ?? 0,
        budget: map.get(key)?.budget ?? 0,
        percentage: 0,
      })),
      totalBudget,
      totalProjects,
    };
  }

  const raw = categories.map((key) => {
    const budget = map.get(key)?.budget ?? 0;
    const pct = (budget / totalBudget) * 100;
    return { key, budget, pct, base: Math.floor(pct), remainder: pct - Math.floor(pct) };
  });

  let remaining = 100 - raw.reduce((sum, item) => sum + item.base, 0);
  if (remaining < 0) remaining = 0;

  const withExtras = [...raw].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return b.budget - a.budget;
  });

  const increments = new Map<string, number>();
  for (let i = 0; i < withExtras.length; i += 1) {
    if (remaining <= 0) break;
    const key = withExtras[i].key;
    increments.set(key, (increments.get(key) ?? 0) + 1);
    remaining -= 1;
  }

  return {
    rows: raw.map((item) => ({
      category: item.key === "Unknown" ? "Unassigned" : item.key,
      projectCount: map.get(item.key)?.count ?? 0,
      budget: map.get(item.key)?.budget ?? 0,
      percentage: item.base + (increments.get(item.key) ?? 0),
    })),
    totalBudget,
    totalProjects,
  };
}

export function BudgetAllocationTable({
  rows,
  totalBudget,
  totalProjects,
}: {
  rows: BudgetAllocationRow[];
  totalBudget: number;
  totalProjects: number;
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
                    {row.percentage}%
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
                  {totalBudget > 0 ? 100 : 0}%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
