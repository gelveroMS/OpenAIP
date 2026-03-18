"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageMetricsVM } from "@/lib/repos/admin-dashboard/types";
import { DASHBOARD_CHART_STROKES, DASHBOARD_SEMANTIC_COLORS } from "@/lib/ui/tokens";

export default function ErrorRateBarChart({ metrics }: { metrics: UsageMetricsVM }) {
  const data = metrics.errorRateTrend;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartHeight = 180;
  const svgWidth = Math.max(data.length * 64, 520);
  const plotWidth = svgWidth - 40;
  const gridLines = 4;
  const step = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(28, step * 0.7);

  return (
    <Card className="border-slate-200 py-3 shadow-none">
      <CardHeader className="space-y-1 pb-0">
        <CardTitle className="text-base sm:text-[18px]">Error Rate Trend</CardTitle>
        <div className="text-[12px] text-slate-500">
          Daily error rate percentage showing system reliability and performance issues.
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="w-full overflow-hidden">
          <svg
            width="100%"
            height={220}
            viewBox={`0 0 ${svgWidth} 220`}
            className="text-slate-400"
          >
            <g transform="translate(20,18)">
              {Array.from({ length: gridLines + 1 }, (_, idx) => {
                const y = (chartHeight / gridLines) * idx;
                return (
                  <line
                    key={`grid-${idx}`}
                    x1={0}
                    y1={y}
                    x2={plotWidth}
                    y2={y}
                    stroke={DASHBOARD_CHART_STROKES.svgGrid}
                    strokeWidth={1}
                  />
                );
              })}
              {data.map((point, idx) => {
                const barHeight = (point.value / maxValue) * chartHeight;
                const x = idx * step + (step - barWidth) / 2;
                return (
                  <g key={point.label}>
                    <rect
                      x={x}
                      y={chartHeight - barHeight}
                      width={barWidth}
                      height={barHeight}
                      rx={4}
                      fill={DASHBOARD_SEMANTIC_COLORS.danger}
                    />
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 16}
                      textAnchor="middle"
                      className="text-[10px] fill-slate-400"
                    >
                      {point.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
