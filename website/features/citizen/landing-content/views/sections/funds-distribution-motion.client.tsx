"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion, type Variants } from "framer-motion";
import type { SectorDistributionVM } from "@/lib/domain/landing-content";
import DonutChartCitizenDashboard, {
  type DonutChartSegment,
} from "../../components/chart/donut-chart-citizen-dashboard";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";
import { cn } from "@/lib/ui/utils";

type FundsDistributionMotionProps = {
  vm: SectorDistributionVM;
};

type FundsDonutSegment = DonutChartSegment & {
  amount: number;
  activeCardClass: string;
};

const COLOR_MAP: Record<
  string,
  { colorClass: string; colorHex: string; activeCardClass: string }
> = {
  general: {
    colorClass: "bg-violet-400 text-violet-300",
    colorHex: "#A78BFA",
    activeCardClass: "border-violet-300/50 bg-violet-400/12 shadow-[0_0_0_1px_rgba(167,139,250,0.18),0_12px_28px_rgba(167,139,250,0.16)]",
  },
  social: {
    colorClass: "bg-rose-400 text-rose-300",
    colorHex: "#FB7185",
    activeCardClass: "border-rose-300/50 bg-rose-400/12 shadow-[0_0_0_1px_rgba(251,113,133,0.16),0_12px_28px_rgba(251,113,133,0.14)]",
  },
  economic: {
    colorClass: "bg-cyan-400 text-cyan-300",
    colorHex: "#22D3EE",
    activeCardClass: "border-cyan-300/50 bg-cyan-400/12 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_12px_28px_rgba(34,211,238,0.14)]",
  },
  other: {
    colorClass: "bg-amber-400 text-amber-300",
    colorHex: "#F59E0B",
    activeCardClass: "border-amber-300/50 bg-amber-400/12 shadow-[0_0_0_1px_rgba(245,158,11,0.16),0_12px_28px_rgba(245,158,11,0.14)]",
  },
};

function formatCompactPeso(value: number): string {
  if (value >= 1_000_000_000) {
    return `\u20b1${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `\u20b1${(value / 1_000_000).toFixed(1)}M`;
  }
  return `\u20b1${value.toLocaleString("en-PH")}`;
}

export default function FundsDistributionMotion({ vm }: FundsDistributionMotionProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [startDraw, setStartDraw] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(rootRef, VIEWPORT_ONCE);

  const segments: FundsDonutSegment[] = useMemo(
    () =>
      vm.sectors.map((sector) => ({
        ...sector,
        colorClass: COLOR_MAP[sector.key]?.colorClass ?? "bg-slate-400 text-slate-300",
        colorHex: COLOR_MAP[sector.key]?.colorHex ?? "#94A3B8",
        activeCardClass:
          COLOR_MAP[sector.key]?.activeCardClass ??
          "border-slate-300/40 bg-slate-400/10 shadow-[0_0_0_1px_rgba(148,163,184,0.12),0_12px_28px_rgba(148,163,184,0.12)]",
      })),
    [vm.sectors]
  );

  useEffect(() => {
    if (!isInView || startDraw) {
      return;
    }

    if (reducedMotion) {
      setStartDraw(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setStartDraw(true);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [isInView, reducedMotion, startDraw]);

  const headerVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.6,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const pillsContainerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0.06 : 0.1,
        staggerChildren: reducedMotion ? 0 : 0.08,
      },
    },
  };

  const pillItemVariants: Variants = {
    hidden: { opacity: 0, x: reducedMotion ? 0 : -12, y: 0 },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.55,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const donutContainerVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.28 : 0.7,
        delay: reducedMotion ? 0.1 : 0.24,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.div
      ref={rootRef}
      data-testid="funds-distribution-root"
      className="mx-auto grid w-full max-w-6xl min-w-0 grid-cols-12 items-start gap-6 md:gap-10"
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      <div className="col-span-12 space-y-4 md:space-y-5 lg:col-span-5">
        <motion.div className="space-y-2.5 pb-4 md:space-y-3 md:pb-10" variants={headerVariants}>
          <h2 className="break-words text-[clamp(2.05rem,10vw,3.1rem)] font-semibold leading-[0.95] text-[#F2ECE5] md:text-6xl">
            How Funds Are Distributed
          </h2>
          <p className="text-xs leading-6 text-white/70 md:text-sm">
            A clear view of allocations across General, Social, Economic, and Other sectors.
          </p>
        </motion.div>

        <motion.div className="space-y-2.5 md:space-y-3" variants={pillsContainerVariants}>
          {segments.map((sector) => {
            const isActive = activeKey === sector.key;
            const isDimmed = activeKey ? activeKey !== sector.key : false;
            return (
              <motion.div
                key={sector.key}
                variants={pillItemVariants}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2.5 transition-all duration-200 md:gap-4 md:px-4 md:py-3",
                  isActive
                    ? cn("translate-x-1 opacity-100", sector.activeCardClass)
                    : cn("translate-x-0", isDimmed ? "opacity-50" : "opacity-100 hover:bg-white/8")
                )}
                onMouseEnter={() => setActiveKey(sector.key)}
                onMouseLeave={() => setActiveKey(null)}
              >
                <div className="flex items-center gap-3">
                  <span className={cn("h-3 w-3 rounded-full", sector.colorClass.split(" ")[0])} />
                  <span className="text-xs text-white md:text-sm">{sector.label}</span>
                </div>
                <span className="text-xs font-semibold text-white md:text-sm">{formatCompactPeso(sector.amount)}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      <motion.div className="col-span-12 lg:col-span-7" variants={donutContainerVariants}>
        <div
          data-testid="funds-distribution-donut-shell"
          className="mx-auto flex w-full max-w-3xl min-h-[320px] items-center justify-center rounded-2xl border border-white/10 bg-[#14141C] p-4 shadow-[0_18px_45px_rgba(8,16,24,0.35)] sm:min-h-[380px] sm:p-6 md:min-h-[460px] md:p-10 lg:p-12"
        >
          <div className="aspect-square w-full max-w-[240px] md:hidden">
            <DonutChartCitizenDashboard
              total={vm.total}
              unitLabel={vm.unitLabel}
              segments={segments}
              size={240}
              thickness={20}
              minSizeClass="min-w-[220px] min-h-[220px]"
              activeKey={activeKey}
              onHover={setActiveKey}
              animate={startDraw}
              hideOuterLabels
            />
          </div>
          <div className="hidden aspect-square w-full max-w-[340px] md:block">
            <DonutChartCitizenDashboard
              total={vm.total}
              unitLabel={vm.unitLabel}
              segments={segments}
              size={320}
              thickness={24}
              activeKey={activeKey}
              onHover={setActiveKey}
              animate={startDraw}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
