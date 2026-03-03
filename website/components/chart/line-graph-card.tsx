"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/ui/utils";

type LineSeriesConfig = {
  key: string;
  label?: string;
  color?: string;
};

type LineGraphCardProps = {
  data: Record<string, unknown>[];
  xKey: string;
  series: LineSeriesConfig[];
  heightClass?: string;
  className?: string;
  yDomain?: [number, number] | ["auto", "auto"];
  showTooltip?: boolean;
  showLegend?: boolean;
  grid?: { vertical?: boolean; horizontal?: boolean };
  tickFontSize?: number;
  dotSize?: number;
  strokeWidth?: number;
};

type ChartDimensions = {
  width: number;
  height: number;
};

type LineGraphTooltipEntry = {
  color?: string;
  name?: string;
  value?: number | string;
};

type LineGraphTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: LineGraphTooltipEntry[];
};

const DEFAULT_HEIGHT_CLASS = "h-56";
const DEFAULT_COLORS = ["#25647e", "#3b82f6", "#10b981", "#f59e0b", "#6a7282", "#ef4444"];

function LineGraphTooltipContent({ active, label, payload }: LineGraphTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_4px_14px_rgba(15,23,42,0.08)]">
      {label !== undefined ? (
        <div className="mb-1 font-semibold text-slate-900">{String(label)}</div>
      ) : null}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={`${entry.name ?? "series"}-${index}`} className="flex items-center gap-2 text-slate-600">
            <span className="inline-flex h-2.5 w-2.5 items-center justify-center" aria-hidden>
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                <circle cx="5" cy="5" r="5" fill={entry.color ?? "#64748b"} />
              </svg>
            </span>
            <span className="font-medium text-slate-700">{entry.name ?? "Value"}</span>
            <span>{String(entry.value ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineGraphCard({
  data,
  xKey,
  series,
  heightClass = DEFAULT_HEIGHT_CLASS,
  className,
  yDomain = ["auto", "auto"],
  showTooltip = true,
  showLegend = false,
  grid = { vertical: true, horizontal: true },
  tickFontSize = 12,
  dotSize = 4,
  strokeWidth = 2,
}: LineGraphCardProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState<ChartDimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const node = chartRef.current;
    if (!node) {
      return;
    }

    const setNextSize = (nextWidth: number, nextHeight: number) => {
      setDimensions((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setNextSize(Math.round(rect.width), Math.round(rect.height));
    };

    measure();
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      setNextSize(Math.round(width), Math.round(height));
    });

    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  const resolvedSeries = useMemo(
    () =>
      series.map((entry, index) => ({
        ...entry,
        label: entry.label ?? entry.key,
        color: entry.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length],
      })),
    [series]
  );

  const effectiveTickFontSize = useMemo(() => {
    const width = dimensions.width;
    if (width > 0 && width < 340) {
      return Math.max(10, tickFontSize - 2);
    }
    if (width > 0 && width < 440) {
      return Math.max(11, tickFontSize - 1);
    }
    return tickFontSize;
  }, [dimensions.width, tickFontSize]);

  const yAxisWidth = dimensions.width > 0 && dimensions.width < 420 ? 36 : 44;

  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="w-full max-w-full overflow-hidden">
        <div ref={chartRef} className={cn("w-full", heightClass)}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid
                stroke="#e2e8f0"
                strokeDasharray="4 4"
                vertical={grid.vertical ?? true}
                horizontal={grid.horizontal ?? true}
              />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: effectiveTickFontSize, fill: "#64748b" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={yDomain}
                tickLine={false}
                axisLine={false}
                width={yAxisWidth}
                tick={{ fontSize: effectiveTickFontSize, fill: "#64748b" }}
              />

              {showTooltip ? (
                <Tooltip
                  cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                  content={<LineGraphTooltipContent />}
                />
              ) : null}

              {resolvedSeries.map((entry) => (
                <Line
                  key={entry.key}
                  type="monotone"
                  dataKey={entry.key}
                  name={entry.label}
                  stroke={entry.color}
                  strokeWidth={strokeWidth}
                  dot={{
                    r: dotSize,
                    fill: "#ffffff",
                    stroke: entry.color,
                    strokeWidth: 2,
                  }}
                  activeDot={{
                    r: dotSize + 1,
                    fill: "#ffffff",
                    stroke: entry.color,
                    strokeWidth: 2,
                  }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {showLegend ? (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {resolvedSeries.map((entry) => (
            <li key={`legend-${entry.key}`} className="flex items-center gap-2 text-xs text-slate-600">
              <span
                className="inline-flex h-2.5 w-2.5 items-center justify-center"
                aria-hidden
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                  <circle cx="5" cy="5" r="5" fill={entry.color} />
                </svg>
              </span>
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type { LineSeriesConfig, LineGraphCardProps };
