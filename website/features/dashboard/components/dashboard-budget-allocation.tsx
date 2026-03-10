import Link from "next/link";
import { DonutChart } from "@/components/chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

const DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function BudgetBreakdownSection({
  totalBudget,
  items,
  detailsHref,
}: {
  totalBudget: string;
  items: Array<{ sectorCode: string; label: string; amount: number; percentage: number }>;
  detailsHref?: string;
}) {
  const dotClassByIndex = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
  const chartData = items.map((item, index) => ({
    name: item.label,
    value: item.amount > 0 ? item.amount : Math.max(item.percentage, 0),
    color: DONUT_COLORS[index % DONUT_COLORS.length],
  }));

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl pt-5">
      <CardHeader className="grid-rows-[auto] items-center gap-0 border-b border-border px-5">
        <CardTitle className="flex items-center gap-2 leading-none text-lg font-medium text-foreground">
          <DollarSign className="h-4 w-4 text-[#1A677D]" />
          Budget Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5 pt-3">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          <DonutChart
            data={chartData}
            centerLabel="Budget Allocation"
            chartHeightClassName="h-72"
            className="mx-auto lg:mx-0"
          />
          <div className="space-y-5 pt-1">
            <div className="border-b border-border pb-4">
              <div className="text-sm text-muted-foreground">Total Budget</div>
              <div className="whitespace-nowrap tabular-nums truncate text-4xl font-semibold leading-none text-[#1A677D]">{totalBudget}</div>
            </div>
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`summary-${item.sectorCode}`} className="grid grid-cols-[1fr_56px_120px] items-center gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${dotClassByIndex[index % dotClassByIndex.length]}`} />
                    <span className="text-sm text-foreground">{item.label}</span>
                  </div>
                  <span className="text-right text-sm text-muted-foreground">{item.percentage.toFixed(0)}%</span>
                  <span className="whitespace-nowrap truncate text-right text-sm font-semibold text-foreground">{item.amount.toLocaleString("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </div>
            <div className="text-xs italic text-muted-foreground">Categories derived from project classification.</div>
          </div>
        </div>
        <div className="border-t border-border pt-4 flex flex-wrap gap-3">
          {detailsHref ? (
            <Button asChild className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Link href={detailsHref}>View AIP Details</Link>
            </Button>
          ) : (
            <Button
              type="button"
              disabled
              className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              View AIP Details
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
