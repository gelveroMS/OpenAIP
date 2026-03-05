"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/ui/utils";

export type DonutChartSegment = {
  key: string;
  label: string;
  percent: number;
  colorClass: string;
  colorHex: string;
};

type DonutChartCitizenDashboardProps = {
  total: number;
  unitLabel?: string;
  segments: DonutChartSegment[];
  size?: number;
  thickness?: number;
  minSizeClass?: string;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  animate?: boolean;
};

function formatCompactTotal(total: number, unitLabel?: string): string {
  if (total >= 1_000_000_000) {
    return `${(total / 1_000_000_000).toFixed(1)}B`;
  }

  if (total >= 1_000_000 || unitLabel) {
    return `${(total / 1_000_000).toFixed(1)}M`;
  }

  return total.toFixed(1);
}

export default function DonutChartCitizenDashboard({
  total,
  unitLabel,
  segments,
  size = 260,
  thickness = 22,
  minSizeClass = "min-w-[260px] min-h-[260px]",
  activeKey,
  onHover,
  animate = false,
}: DonutChartCitizenDashboardProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const viewBoxSize = 100;
  const center = viewBoxSize / 2;
  const normalizedThickness = Math.max(6, Math.min(14, (thickness / size) * viewBoxSize));
  const radius = (viewBoxSize - normalizedThickness) / 2;
  const ringOuterRadius = radius + normalizedThickness / 2;

  const processedSegments = useMemo(
    () =>
      segments.reduce<
        {
          offset: number;
          currentAngleDeg: number;
          items: Array<
            DonutChartSegment & {
              startPercent: number;
              labelX: number;
              labelY: number;
              linePath: string;
              isRight: boolean;
            }
          >;
        }
      >(
        (acc, segment) => {
          const startPercent = acc.offset;
          const sweepDeg = (segment.percent / 100) * 360;
          const midAngleDeg = acc.currentAngleDeg + sweepDeg / 2;
          const theta = (midAngleDeg * Math.PI) / 180;
          const isRight = Math.cos(theta) >= 0;

          const ax = center + ringOuterRadius * Math.cos(theta);
          const ay = center + ringOuterRadius * Math.sin(theta);
          const ex = center + (ringOuterRadius + 4.5) * Math.cos(theta);
          const ey = center + (ringOuterRadius + 4.5) * Math.sin(theta);
          const hx = ex + (isRight ? 9.5 : -9.5);
          const hy = ey;
          const linePath = `M ${ax} ${ay} L ${ex} ${ey} L ${hx} ${hy}`;

          return {
            offset: acc.offset + segment.percent,
            currentAngleDeg: acc.currentAngleDeg + sweepDeg,
            items: [
              ...acc.items,
              {
                ...segment,
                startPercent,
                labelX: hx,
                labelY: hy,
                linePath,
                isRight,
              },
            ],
          };
        },
        { offset: 0, currentAngleDeg: -90, items: [] }
      ).items,
    [center, ringOuterRadius, segments]
  );
  const ringRenderSegments = useMemo(() => {
    if (!activeKey) {
      return processedSegments;
    }

    const activeSegment = processedSegments.find((segment) => segment.key === activeKey);
    if (!activeSegment) {
      return processedSegments;
    }

    return [...processedSegments.filter((segment) => segment.key !== activeKey), activeSegment];
  }, [activeKey, processedSegments]);
  const shouldAnimateEntrance = !reducedMotion;
  const drawStarted = shouldAnimateEntrance ? animate : true;
  const drawDuration = reducedMotion ? 0.2 : 0.9;
  const labelFadeDelay = reducedMotion ? 0 : 0.92;
  const labelFadeDuration = reducedMotion ? 0.24 : 0.45;
  const totalFadeDelay = reducedMotion ? 0 : 0.74;
  const totalFadeDuration = reducedMotion ? 0.24 : 0.42;

  return (
    <div className={cn("relative aspect-square h-full w-full", minSizeClass)}>
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        className="relative z-10 h-full w-full overflow-visible"
      >
        <g>
          {ringRenderSegments.map((segment) => {
            const hasActive = Boolean(activeKey);
            const isActive = hasActive ? activeKey === segment.key : true;
            const segmentStrokeWidth = hasActive && isActive ? normalizedThickness + 2.2 : normalizedThickness;
            const segmentRadius = radius;
            const segmentCircumference = 2 * Math.PI * segmentRadius;
            const dash = (segment.percent / 100) * segmentCircumference;
            const gap = Math.max(0, segmentCircumference - dash);
            const dashArray = `${dash} ${gap}`;
            const dashOffset = segmentCircumference / 4 - (segment.startPercent / 100) * segmentCircumference;
            const drawStartOffset = dashOffset + dash;
            const segmentIndex = processedSegments.findIndex((item) => item.key === segment.key);
            return (
              <motion.circle
                key={segment.key}
                r={segmentRadius}
                cx={center}
                cy={center}
                fill="transparent"
                stroke={segment.colorHex}
                strokeWidth={segmentStrokeWidth}
                strokeDasharray={dashArray}
                animate={{
                  strokeDashoffset: drawStarted ? dashOffset : drawStartOffset,
                }}
                transition={{
                  duration: drawStarted ? drawDuration : 0,
                  ease: "easeOut",
                  delay: drawStarted ? segmentIndex * 0.06 : 0,
                }}
                strokeLinecap="butt"
                className={cn(
                  "cursor-pointer transition-[opacity,stroke-width] duration-200",
                  isActive ? "opacity-100" : "opacity-35"
                )}
                onMouseEnter={() => onHover(segment.key)}
                onMouseLeave={() => onHover(null)}
              />
            );
          })}
        </g>
        <motion.g
          animate={{ opacity: drawStarted ? 1 : 0 }}
          transition={{
            duration: drawStarted ? labelFadeDuration : 0,
            delay: drawStarted ? labelFadeDelay : 0,
            ease: "easeOut",
          }}
        >
          {processedSegments.map((segment) => {
            const isActive = activeKey ? activeKey === segment.key : true;
            return (
              <path
                key={`${segment.key}-leader`}
                d={segment.linePath}
                fill="none"
                stroke="rgba(255,255,255,0.38)"
                strokeWidth={0.35}
                strokeLinecap="round"
                className={cn("transition-opacity", isActive ? "opacity-100" : "opacity-40")}
              />
            );
          })}
        </motion.g>
      </svg>

      <motion.div
        className="pointer-events-none absolute inset-0 grid place-items-center text-center"
        animate={{ opacity: drawStarted ? 1 : 0 }}
        transition={{
          duration: drawStarted ? totalFadeDuration : 0,
          delay: drawStarted ? totalFadeDelay : 0,
          ease: "easeOut",
        }}
      >
        <p className="text-xs uppercase tracking-[0.24em] text-white/50">Total</p>
        <p className="text-4xl font-semibold text-white">{formatCompactTotal(total, unitLabel)}</p>
        {unitLabel ? <p className="text-xs uppercase text-white/50">{unitLabel}</p> : null}
      </motion.div>

      <motion.div
        className="absolute inset-0"
        animate={{ opacity: drawStarted ? 1 : 0 }}
        transition={{
          duration: drawStarted ? labelFadeDuration : 0,
          delay: drawStarted ? labelFadeDelay : 0,
          ease: "easeOut",
        }}
      >
        {processedSegments.map((segment, index) => {
          const yNudge = index % 2 === 0 ? -2 : 2;
          const isActive = activeKey ? activeKey === segment.key : true;
          return (
            <div
              key={`${segment.key}-label`}
              className={cn(
                "absolute flex items-center gap-2 text-xs text-white/75 transition-opacity",
                segment.isRight ? "flex-row" : "flex-row-reverse",
                isActive ? "opacity-100" : "opacity-45"
              )}
              style={{
                left: `${(segment.labelX / viewBoxSize) * 100}%`,
                top: `${(segment.labelY / viewBoxSize) * 100}%`,
                translate: segment.isRight
                  ? `8px calc(-50% + ${yNudge}px)`
                  : `calc(-100% - 8px) calc(-50% + ${yNudge}px)`,
              }}
              onMouseEnter={() => onHover(segment.key)}
              onMouseLeave={() => onHover(null)}
            >
              <span className={cn("h-2 w-2 rounded-full", segment.colorClass.split(" ")[0])} />
              <span
                className={cn(
                  "whitespace-normal break-words leading-tight",
                  segment.key === "economic" ? "max-w-[84px]" : "max-w-[140px]"
                )}
              >
                {segment.label}
              </span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
