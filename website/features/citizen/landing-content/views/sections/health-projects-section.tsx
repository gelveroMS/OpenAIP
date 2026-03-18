"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectHighlightVM } from "@/lib/domain/landing-content";
import CardShell from "../../components/atoms/card-shell";
import FullScreenSection from "../../components/layout/full-screen-section";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";
import ProjectShowcaseCard from "./project-showcase-card";
import ViewAllProjectsCard from "./view-all-projects-card";

type HealthProjectsSectionProps = {
  vm: ProjectHighlightVM;
};

type CarouselProjectItem = {
  kind: "project";
  id: string;
  project: ProjectHighlightVM["projects"][number];
};

type CarouselCtaItem = {
  kind: "cta";
  id: "__view_all_health__";
  title: string;
  href: string;
  actionLabel: string;
};

type CarouselItem = CarouselProjectItem | CarouselCtaItem;

function formatCompactPeso(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `\u20b1${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `\u20b1${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `\u20b1${(amount / 1_000).toFixed(1)}K`;
  }
  return `\u20b1${amount.toLocaleString("en-PH")}`;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString("en-PH");
}

function getStackStyle(delta: number) {
  const abs = Math.abs(delta);
  const x = abs === 0 ? 0 : 184;
  const scale = abs === 0 ? 1 : 0.78;
  const opacity = abs === 0 ? 1 : 0.62;
  const zIndex = abs === 0 ? 50 : 40;
  const signedX = delta < 0 ? -x : x;

  return {
    zIndex,
    opacity,
    transform: `translate(-50%, -50%) translateX(${signedX}px) scale(${scale})`,
  } as const;
}

export default function HealthProjectsSection({ vm }: HealthProjectsSectionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const autoDirRef = useRef<-1 | 0 | 1>(0);
  const rafIdRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const virtualIndexRef = useRef(0);
  const edgeStepRef = useRef<(ts: number) => void>(() => {});
  const reducedMotion = useReducedMotion() ?? false;

  const safeProjects = vm.projects ?? [];
  const carouselItems: CarouselItem[] = [
    ...safeProjects.map((project) => ({
      kind: "project" as const,
      id: project.id,
      project,
    })),
    {
      kind: "cta",
      id: "__view_all_health__",
      title: "View All Health Projects",
      href: "/projects/health",
      actionLabel: "View All Projects",
    },
  ];
  const hasMultipleItems = carouselItems.length > 1;
  const edgeHoverWidth = 80;
  const effectiveActiveIndex =
    carouselItems.length === 0 ? 0 : Math.max(0, Math.min(activeIndex, carouselItems.length - 1));

  useEffect(() => {
    virtualIndexRef.current = effectiveActiveIndex;
  }, [effectiveActiveIndex]);

  const stopEdgeScroll = useCallback(() => {
    autoDirRef.current = 0;
    lastTsRef.current = 0;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    edgeStepRef.current = (ts: number) => {
      if (!hasMultipleItems) {
        stopEdgeScroll();
        return;
      }

      const dir = autoDirRef.current;
      if (dir === 0 || ts < cooldownUntilRef.current) {
        stopEdgeScroll();
        return;
      }

      const last = lastTsRef.current || ts;
      const dt = ts - last;
      lastTsRef.current = ts;

      const speed = 0.55;
      const pxPerCard = 300;
      const deltaIndex = (dir * dt * speed) / pxPerCard;

      const maxIndex = carouselItems.length - 1;
      const nextFloat = Math.max(0, Math.min(maxIndex, virtualIndexRef.current + deltaIndex));
      virtualIndexRef.current = nextFloat;

      const nextIndex = Math.round(nextFloat);
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));

      if ((dir < 0 && nextFloat <= 0) || (dir > 0 && nextFloat >= maxIndex)) {
        stopEdgeScroll();
        return;
      }

      rafIdRef.current = requestAnimationFrame((frameTs) => edgeStepRef.current(frameTs));
    };
  }, [carouselItems.length, hasMultipleItems, stopEdgeScroll]);

  const startEdgeScroll = useCallback(
    (dir: -1 | 1) => {
      if (!hasMultipleItems) {
        return;
      }

      autoDirRef.current = dir;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame((ts) => edgeStepRef.current(ts));
      }
    },
    [hasMultipleItems]
  );

  const onEdgePointerDown = useCallback(
    (dir: -1 | 1) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "touch") {
        return;
      }

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startEdgeScroll(dir);
    },
    [startEdgeScroll]
  );

  const onEdgePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "touch") {
        return;
      }
      stopEdgeScroll();
    },
    [stopEdgeScroll]
  );

  const handleStageMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!hasMultipleItems) {
        stopEdgeScroll();
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;

      if (localX <= edgeHoverWidth) {
        startEdgeScroll(-1);
        return;
      }

      if (localX >= rect.width - edgeHoverWidth) {
        startEdgeScroll(1);
        return;
      }

      stopEdgeScroll();
    },
    [edgeHoverWidth, hasMultipleItems, startEdgeScroll, stopEdgeScroll]
  );

  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);

  const goToNext = useCallback(() => {
    if (!hasMultipleItems) {
      return;
    }
    stopEdgeScroll();
    setActiveIndex((current) => Math.max(0, Math.min(current + 1, carouselItems.length - 1)));
  }, [carouselItems.length, hasMultipleItems, stopEdgeScroll]);

  const goToPrevious = useCallback(() => {
    if (!hasMultipleItems) {
      return;
    }
    stopEdgeScroll();
    setActiveIndex((current) => Math.max(0, Math.min(current - 1, carouselItems.length - 1)));
  }, [carouselItems.length, hasMultipleItems, stopEdgeScroll]);

  const primaryValue = vm.primaryKpiValue ?? vm.totalBudget ?? 0;
  const activeItem = carouselItems[effectiveActiveIndex];
  const previousItem = effectiveActiveIndex > 0 ? carouselItems[effectiveActiveIndex - 1] : null;
  const nextItem =
    effectiveActiveIndex < carouselItems.length - 1 ? carouselItems[effectiveActiveIndex + 1] : null;

  const renderCarouselItem = (item: CarouselItem, interactive: boolean) => {
    if (item.kind === "cta") {
      return (
        <ViewAllProjectsCard
          title={item.title}
          href={item.href}
          actionLabel={item.actionLabel}
          interactive={interactive}
          actionClassName="bg-[#EC4899]"
        />
      );
    }

    return (
      <ProjectShowcaseCard
        project={item.project}
        budgetLabel={item.project.budgetLabel ?? formatCompactPeso(item.project.budget)}
        ctaHref={`/projects/health/${item.project.id}`}
      />
    );
  };

  const headerVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.65,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const kpiContainerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0.08 : 0.12,
        staggerChildren: reducedMotion ? 0 : 0.1,
      },
    },
  };

  const kpiItemVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 14 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.6,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const carouselVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.28 : 0.7,
        delay: reducedMotion ? 0.1 : 0.26,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <FullScreenSection
      id="health-projects"
      className="relative bg-[#EFF4F7]"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[url('/citizen-dashboard/health-bg.webp')] bg-cover bg-center opacity-50"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.95)_5%,rgba(255,255,255,0.85)_50%,rgba(255,255,255,0)_100%)]"
        aria-hidden="true"
      />
      <motion.div
        className="relative z-10 grid grid-cols-12 items-start gap-6 md:gap-8 lg:gap-16"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_ONCE}
      >
        <div className="order-1 col-span-12 space-y-5 md:space-y-8 lg:order-1 lg:col-span-5 lg:pt-10 xl:col-span-4">
          <motion.div className="space-y-4 md:space-y-6" variants={headerVariants}>
            <h2 className="max-w-[12ch] break-words text-[clamp(2rem,10vw,2.9rem)] font-extrabold leading-[0.95] tracking-tight text-[#052434] sm:text-5xl">
              {vm.heading}
            </h2>
            <p className="max-w-[24ch] text-lg leading-[1.45] text-[#4F7D92] sm:text-xl md:text-2xl">
              {vm.description}
            </p>
          </motion.div>

          <motion.div className="grid grid-cols-2 gap-3.5 md:gap-5" variants={kpiContainerVariants}>
            <motion.div className="h-full" variants={kpiItemVariants}>
              <CardShell className="flex h-full min-h-[130px] w-full min-w-0 py-0 md:min-h-[152px]">
                <div className="flex h-full flex-col justify-between space-y-2 px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6">
                  <p className="text-3xl font-bold leading-none text-[#EC4899]">
                    {formatCompactPeso(primaryValue)}
                  </p>
                  <p className="text-sm font-medium text-slate-500">{vm.primaryKpiLabel}</p>
                </div>
              </CardShell>
            </motion.div>

            <motion.div className="h-full" variants={kpiItemVariants}>
              <CardShell className="flex h-full min-h-[130px] w-full min-w-0 py-0 md:min-h-[152px]">
                <div className="flex h-full flex-col justify-between space-y-2 px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6">
                  <p className="text-3xl font-bold leading-none text-[#EC4899]">
                    {formatCompactCount(vm.secondaryKpiValue)}
                  </p>
                  <p className="text-sm font-medium text-slate-500">{vm.secondaryKpiLabel}</p>
                </div>
              </CardShell>
            </motion.div>
          </motion.div>
        </div>

        <motion.div className="order-2 col-span-12 lg:order-2 lg:col-span-7 xl:col-span-8" variants={carouselVariants}>
          <div className="relative w-full lg:max-w-[920px]">
            <div className="relative overflow-hidden rounded-2xl" onMouseLeave={stopEdgeScroll}>
              <div
                data-testid="health-carousel-stage"
                className="relative h-[420px] sm:h-[460px] md:h-[540px]"
                onMouseMove={handleStageMouseMove}
                onWheel={() => {
                  stopEdgeScroll();
                  cooldownUntilRef.current = performance.now() + 250;
                }}
              >
                {previousItem ? (
                  <div
                    data-testid="health-carousel-previous"
                    className="absolute left-1/2 top-1/2 hidden w-[360px] md:block"
                    style={getStackStyle(-1)}
                    onClick={() => setActiveIndex(effectiveActiveIndex - 1)}
                  >
                    {renderCarouselItem(previousItem, false)}
                  </div>
                ) : null}

                {nextItem ? (
                  <div
                    data-testid="health-carousel-next"
                    className="absolute left-1/2 top-1/2 hidden w-[360px] md:block"
                    style={getStackStyle(1)}
                    onClick={() => setActiveIndex(effectiveActiveIndex + 1)}
                  >
                    {renderCarouselItem(nextItem, false)}
                  </div>
                ) : null}

                {activeItem ? (
                  <div
                    key={activeItem.id}
                    data-testid="health-carousel-active"
                    className="absolute left-1/2 top-1/2 z-[56] w-[calc(100vw-3rem)] max-w-[360px] md:w-[360px]"
                    style={{ transform: "translate(-50%, -50%)" }}
                  >
                    {renderCarouselItem(activeItem, true)}
                  </div>
                ) : null}

                <div
                  className="absolute inset-y-0 left-0 z-[55] w-10 sm:w-12 md:w-16 lg:w-20 pointer-events-auto touch-none"
                  onMouseEnter={() => startEdgeScroll(-1)}
                  onMouseLeave={stopEdgeScroll}
                  onPointerDown={onEdgePointerDown(-1)}
                  onPointerUp={onEdgePointerUp}
                  onPointerCancel={onEdgePointerUp}
                  onPointerLeave={onEdgePointerUp}
                  onLostPointerCapture={onEdgePointerUp}
                />

                <div
                  className="absolute inset-y-0 right-0 z-[55] w-10 sm:w-12 md:w-16 lg:w-20 pointer-events-auto touch-none"
                  onMouseEnter={() => startEdgeScroll(1)}
                  onMouseLeave={stopEdgeScroll}
                  onPointerDown={onEdgePointerDown(1)}
                  onPointerUp={onEdgePointerUp}
                  onPointerCancel={onEdgePointerUp}
                  onPointerLeave={onEdgePointerUp}
                  onLostPointerCapture={onEdgePointerUp}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2.5 md:hidden">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Go to previous health project"
                disabled={!hasMultipleItems || effectiveActiveIndex <= 0}
                className="h-10 w-10 rounded-full border border-white/70 bg-white/95 text-[#56616B] shadow-[0_8px_18px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                onClick={goToPrevious}
              >
                <ChevronLeft className="h-5 w-5 stroke-[2.6]" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Advance to next health project"
                disabled={!hasMultipleItems || effectiveActiveIndex >= carouselItems.length - 1}
                className="h-10 w-10 rounded-full border border-white/70 bg-white/95 text-[#56616B] shadow-[0_8px_18px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                onClick={goToNext}
              >
                <ChevronRight className="h-5 w-5 stroke-[2.6]" />
              </Button>
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-[70] hidden items-center justify-between px-2 lg:flex">
              <motion.div
                whileHover={reducedMotion ? undefined : { x: -2, scale: 1.04 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.2, ease: "easeInOut" }}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Go to previous health project"
                  disabled={!hasMultipleItems || effectiveActiveIndex <= 0}
                  className="pointer-events-auto h-14 w-14 rounded-full border border-white/70 bg-white/95 text-[#56616B] shadow-[0_10px_24px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                  onClick={goToPrevious}
                >
                  <ChevronLeft className="h-7 w-7 stroke-[2.8]" />
                </Button>
              </motion.div>

              <motion.div
                whileHover={reducedMotion ? undefined : { x: 2, scale: 1.04 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.2, ease: "easeInOut" }}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Advance to next health project"
                  disabled={!hasMultipleItems || effectiveActiveIndex >= carouselItems.length - 1}
                  className="pointer-events-auto h-14 w-14 rounded-full border border-white/70 bg-white/95 text-[#56616B] shadow-[0_10px_24px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                  onClick={goToNext}
                >
                  <ChevronRight className="h-7 w-7 stroke-[2.8]" />
                </Button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </FullScreenSection>
  );
}
