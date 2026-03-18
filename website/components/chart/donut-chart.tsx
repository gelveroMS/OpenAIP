"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/ui/utils";

export type DonutChartDatum = {
  name: string;
  value: number;
  color: string;
};

type DonutChartProps = {
  data: DonutChartDatum[];
  title?: string;
  subtitle?: string;
  centerLabel?: ReactNode;
  className?: string;
  mobileBreakpoint?: number;
  chartHeightClassName?: string;
  showTooltip?: boolean;
  onSliceClick?: (slice: DonutChartDatum, index: number) => void;
};

type ChartSize = {
  width: number;
  height: number;
};

type DonutChartSlice = DonutChartDatum & {
  percent: number;
};

type LabelRendererProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
  fill?: string;
};

type TooltipPayloadItem = {
  payload?: DonutChartSlice;
};

const MOBILE_BREAKPOINT_PX = 640;
const DEFAULT_CHART_HEIGHT_CLASS = "h-72";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number): string {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded}%`;
}

function wrapLabelText(text: string, maxCharsPerLine = 18, maxLines = 2): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word);
      currentLine = "";
    }

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  const remainingWords = words.slice(
    lines.join(" ").split(/\s+/).filter(Boolean).length
  );
  const finalLine = currentLine || remainingWords.join(" ");

  if (finalLine) {
    const clipped =
      finalLine.length > maxCharsPerLine
        ? `${finalLine.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}...`
        : finalLine;
    lines.push(clipped);
  }

  return lines.slice(0, maxLines);
}

export function DonutChart({
  data,
  title,
  subtitle,
  centerLabel,
  className,
  mobileBreakpoint = MOBILE_BREAKPOINT_PX,
  chartHeightClassName = DEFAULT_CHART_HEIGHT_CLASS,
  showTooltip = true,
  onSliceClick,
}: DonutChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const updateSize = (nextWidth: number, nextHeight: number) => {
      setSize((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    const measure = () => {
      const rect = node.getBoundingClientRect();
      updateSize(Math.round(rect.width), Math.round(rect.height));
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      updateSize(Math.round(width), Math.round(height));
    });

    resizeObserver.observe(node);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const cleanData = useMemo(() => data.filter((item) => item.value > 0), [data]);
  const total = useMemo(
    () => cleanData.reduce((sum, item) => sum + item.value, 0),
    [cleanData]
  );
  const hasData = cleanData.length > 0 && total > 0;

  const slices = useMemo<DonutChartSlice[]>(
    () =>
      hasData
        ? cleanData.map((item) => ({
            ...item,
            percent: (item.value / total) * 100,
          }))
        : [{ name: "No data", value: 1, color: "#94a3b8", percent: 100 }],
    [cleanData, hasData, total]
  );

  const isMobile = size.width === 0 ? true : size.width < mobileBreakpoint;
  const showOutsideLabels = !isMobile && hasData;

  const chartMargin = showOutsideLabels
    ? { top: 20, right: 52, bottom: 20, left: 52 }
    : { top: 12, right: 12, bottom: 12, left: 12 };

  const outerRadius = useMemo(() => {
    const fallback = 86;
    if (size.width <= 0 || size.height <= 0) {
      return fallback;
    }

    const drawableWidth = Math.max(0, size.width - chartMargin.left - chartMargin.right);
    const drawableHeight = Math.max(0, size.height - chartMargin.top - chartMargin.bottom);
    const minDimension = Math.min(drawableWidth, drawableHeight);

    if (minDimension <= 0) {
      return fallback;
    }

    return clamp(minDimension * 0.48, 42, 140);
  }, [
    chartMargin.bottom,
    chartMargin.left,
    chartMargin.right,
    chartMargin.top,
    size.height,
    size.width,
  ]);

  const innerRadius = Math.max(28, outerRadius * 0.72);
  const clampPadding = 12;

  const renderOutsideLabel = (label: LabelRendererProps) => {
    const { cx = 0, cy = 0, midAngle = 0, outerRadius: sliceOuterRadius = 0, name, fill } = label;
    const radians = Math.PI / 180;
    const sin = Math.sin(-midAngle * radians);
    const cos = Math.cos(-midAngle * radians);
    const isRightSide = cos >= 0;
    const strokeColor = fill ?? "#64748b";

    const startX = cx + (sliceOuterRadius + 2) * cos;
    const startY = cy + (sliceOuterRadius + 2) * sin;
    const edgeX = cx + (sliceOuterRadius + 14) * cos;
    const edgeY = cy + (sliceOuterRadius + 14) * sin;
    const tickEndX = edgeX + (isRightSide ? 12 : -12);

    const minX = clampPadding;
    const minY = clampPadding;
    const maxX = Math.max(minX, size.width - clampPadding);
    const maxY = Math.max(minY, size.height - clampPadding);

    const clampedEdgeX = clamp(edgeX, minX, maxX);
    const clampedEdgeY = clamp(edgeY, minY, maxY);
    const clampedTickEndX = clamp(tickEndX, minX, maxX);
    const textX = clamp(
      clampedTickEndX + (isRightSide ? 4 : -4),
      minX,
      maxX
    );
    const labelText = `${name ?? ""}`.trim();
    const labelLines = wrapLabelText(labelText);
    const lineHeight = 13;
    const firstLineY = clampedEdgeY - ((labelLines.length - 1) * lineHeight) / 2;

    return (
      <g>
        <line
          x1={startX}
          y1={startY}
          x2={clampedEdgeX}
          y2={clampedEdgeY}
          stroke={strokeColor}
          strokeWidth={1.25}
          strokeLinecap="round"
        />
        <line
          x1={clampedEdgeX}
          y1={clampedEdgeY}
          x2={clampedTickEndX}
          y2={clampedEdgeY}
          stroke={strokeColor}
          strokeWidth={1.25}
          strokeLinecap="round"
        />
        <text
          x={textX}
          y={firstLineY}
          fill={strokeColor}
          fontSize={11}
          textAnchor={isRightSide ? "start" : "end"}
        >
          {labelLines.map((line, index) => (
            <tspan key={`${labelText}-${index}`} x={textX} dy={index === 0 ? 0 : lineHeight}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  };

  const pieChart = (
    <PieChart margin={chartMargin}>
      <Pie
        data={slices}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius={outerRadius}
        innerRadius={innerRadius}
        stroke="#FFFFFF"
        strokeWidth={2}
        labelLine={false}
        label={showOutsideLabels ? renderOutsideLabel : false}
        isAnimationActive
        animationDuration={450}
      >
        {slices.map((slice, index) => (
          <Cell
            key={`${slice.name}-${slice.color}`}
            fill={slice.color}
            stroke="#FFFFFF"
            strokeWidth={2}
            onClick={
              onSliceClick
                ? () => onSliceClick({ name: slice.name, value: slice.value, color: slice.color }, index)
                : undefined
            }
            className={onSliceClick ? "cursor-pointer" : undefined}
          />
        ))}
      </Pie>

      {!isMobile && showTooltip ? (
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            const first = (payload as TooltipPayloadItem[] | undefined)?.[0]?.payload;
            if (!active || !first) {
              return null;
            }

            return (
              <div className="rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-sm">
                <div className="font-medium text-foreground">{first.name}</div>
                <div className="text-muted-foreground">
                  {first.value.toLocaleString()} ({formatPercent(first.percent)})
                </div>
              </div>
            );
          }}
        />
      ) : null}
    </PieChart>
  );

  return (
    <section className={cn("w-full max-w-full min-w-0", className)}>
      {title || subtitle ? (
        <header className="mb-4">
          {title ? <h3 className="text-sm font-semibold text-foreground">{title}</h3> : null}
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </header>
      ) : null}

      <div
        ref={containerRef}
        className={cn(
          "relative w-full",
          chartHeightClassName,
          showOutsideLabels ? "overflow-visible" : "overflow-hidden"
        )}
      >
        {size.width > 0 && size.height > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            {pieChart}
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PieChart width={240} height={240} margin={chartMargin}>
              {pieChart.props.children}
            </PieChart>
          </div>
        )}

        {centerLabel ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-[70%] text-center text-xs font-medium text-foreground">
              {centerLabel}
            </div>
          </div>
        ) : null}
      </div>

      {isMobile ? (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slices.map((slice) => (
            <li key={`legend-${slice.name}`} className="min-w-0 rounded-md bg-muted/30 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
                  aria-hidden
                >
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                    <circle cx="5" cy="5" r="5" fill={slice.color} />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{slice.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {slice.value.toLocaleString()} ({formatPercent(slice.percent)})
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default DonutChart;

