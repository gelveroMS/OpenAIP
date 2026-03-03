"use client";

import { DonutChart } from "@/components/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AipStatusDistributionVM } from "@/lib/repos/admin-dashboard/types";

const createSegments = (data: AipStatusDistributionVM[]) => {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return {
    total,
    segments: data,
  };
};

export default function AipStatusDonutCard({
  data,
  onStatusClick,
}: {
  data: AipStatusDistributionVM[];
  onStatusClick: (status: string) => void;
}) {
  const { total, segments } = createSegments(data);
  const clickableSlices = segments.filter((segment) => segment.count > 0);
  const chartData = clickableSlices.map((segment) => ({
    name: segment.label,
    value: segment.count,
    color: segment.color,
  }));

  return (
    <Card className="border-slate-200 py-0 shadow-none">
      <CardHeader className="space-y-1 pb-0">
        <CardTitle className="text-[18px]">AIPs by Status</CardTitle>
        <div className="text-[12px] text-slate-500">Distribution across the selected filters.</div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-col items-center gap-4">
          <div className="w-full max-w-[420px]">
            <DonutChart
              data={chartData}
              showTooltip={false}
              centerLabel={
                <div className="leading-tight">
                  <div className="text-[12px] text-slate-500">Total</div>
                  <div className="text-[28px] font-semibold text-slate-900">{total}</div>
                </div>
              }
              chartHeightClassName="h-72"
              onSliceClick={(_, index) => {
                const clicked = clickableSlices[index];
                if (clicked) {
                  onStatusClick(clicked.status);
                }
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[12px] text-slate-600">
            {segments.map((segment) => (
              <Button
                key={segment.status}
                variant="ghost"
                className="h-auto p-0 text-[12px] text-slate-600 hover:bg-transparent hover:text-slate-900"
                onClick={() => onStatusClick(segment.status)}
              >
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-2.5 w-2.5 items-center justify-center" aria-hidden>
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                      <circle cx="5" cy="5" r="5" fill={segment.color} />
                    </svg>
                  </span>
                  <span>{segment.label}:</span>
                  <span className="font-medium text-slate-700">{segment.count}</span>
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div className="rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-700">
          <b>Interactive Chart:</b> Click a status segment or legend item to open AIP Oversight filtered to that status.
        </div>
      </CardContent>
    </Card>
  );
}
