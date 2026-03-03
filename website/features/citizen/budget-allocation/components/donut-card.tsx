import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPeso } from "@/lib/formatting";
import type { BudgetCategoryKey } from "@/lib/domain/citizen-budget-allocation";

export type DonutSectorItem = {
  key: BudgetCategoryKey;
  label: string;
  amount: number;
  color: string;
};

type DonutCardProps = {
  fiscalYear: number;
  totalBudget: number;
  sectors: DonutSectorItem[];
};

type DonutRow = DonutSectorItem & {
  percentage: number;
};

export default function DonutCard({ fiscalYear, totalBudget, sectors }: DonutCardProps) {
  const donutRows: DonutRow[] = sectors.map((sector) => ({
    ...sector,
    percentage: totalBudget > 0 ? (sector.amount / totalBudget) * 100 : 0,
  }));
  const hasData = donutRows.some((row) => row.amount > 0);

  return (
    <Card className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg text-[#022437]">Annual Budget Allocation Overview</CardTitle>
          <Badge className="rounded-full bg-cyan-50 text-cyan-800 hover:bg-cyan-50">FY {fiscalYear}</Badge>
        </div>
        <p className="text-4xl font-semibold text-[#022437]" title={formatPeso(totalBudget)}>
          {formatPeso(totalBudget)}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="h-60 w-full">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutRows}
                  dataKey="amount"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="transparent"
                >
                  {donutRows.map((row) => (
                    <Cell key={row.key} fill={row.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | string | undefined) => {
                    const amount = typeof value === "number" ? value : Number(value);
                    return formatPeso(Number.isFinite(amount) ? amount : 0);
                  }}
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.75rem",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
              No chart data available.
            </div>
          )}
        </div>

        <ul className="space-y-2.5">
          {donutRows.map((row) => (
            <li key={row.key} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="text-slate-700">{row.label}</span>
              <span className="text-slate-500 tabular-nums">{row.percentage.toFixed(1)}%</span>
              <span className="text-right font-semibold text-[#022437] tabular-nums">{formatPeso(row.amount)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
