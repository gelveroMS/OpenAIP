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

type InfrastructureProjectsSectionProps = {
  vm: ProjectHighlightVM;
};

type CarouselProjectItem = {
  kind: "project";
  id: string;
  project: ProjectHighlightVM["projects"][number];
};

type CarouselCtaItem = {
  kind: "cta";
  id: "__view_all_infrastructure__";
  title: string;
  href: string;
  actionLabel: string;
};

type CarouselItem = CarouselProjectItem | CarouselCtaItem;

function formatCompactPeso(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `\u20B1${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `\u20B1${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `\u20B1${(amount / 1_000).toFixed(1)}K`;
  }
  return `\u20B1${amount.toLocaleString("en-PH")}`;
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

export default function InfrastructureProjectsSection({ vm }: InfrastructureProjectsSectionProps) {
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
      id: "__view_all_infrastructure__",
      title: "View All Infrastructure Projects",
      href: "/projects/infrastructure",
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
        startEdgeScroll(1);
        return;
      }

      if (localX >= rect.width - edgeHoverWidth) {
        startEdgeScroll(-1);
        return;
      }

      stopEdgeScroll();
    },
    [edgeHoverWidth, hasMultipleItems, startEdgeScroll, stopEdgeScroll]
  );

  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);

  const goToPrevious = useCallback(() => {
    if (!hasMultipleItems) {
      return;
    }
    stopEdgeScroll();
    setActiveIndex((current) => Math.max(0, Math.min(current - 1, carouselItems.length - 1)));
  }, [carouselItems.length, hasMultipleItems, stopEdgeScroll]);

  const goToNext = useCallback(() => {
    if (!hasMultipleItems) {
      return;
    }
    stopEdgeScroll();
    setActiveIndex((current) => Math.max(0, Math.min(current + 1, carouselItems.length - 1)));
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
          actionClassName="bg-[#0E5D6F]"
        />
      );
    }

    return (
      <ProjectShowcaseCard
        project={item.project}
        budgetLabel={item.project.budgetLabel ?? formatCompactPeso(item.project.budget)}
        className="border-[#B7D7EA] bg-[#F4FBFF] shadow-[0_12px_30px_rgba(14,93,111,0.14)]"
        tagChipClassName="bg-[#0E5D6F]/90"
        budgetChipClassName="bg-[#E8F6FE] text-[#0E5D6F]"
        ctaClassName="border-[#2D6F8F] bg-[#EAF7FF] text-[#1F5D79] hover:bg-[#DDF1FE]"
        ctaHref={`/projects/infrastructure/${item.project.id}`}
      />
    );
  };

  const carouselVariants: Variants = {
    hidden: { opacity: 0, x: reducedMotion ? 0 : -10, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.28 : 0.7,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const headerVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.65,
        delay: reducedMotion ? 0.08 : 0.14,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const kpiContainerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0.1 : 0.2,
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

  return (
    <FullScreenSection
      id="infrastructure-projects"
      className="relative"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[url('/citizen-dashboard/infrastrucutre-bg.webp')] bg-cover bg-center opacity-50"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(270deg,rgba(219,234,254,0.95)_5%,rgba(219,234,254,0.85)_50%,rgba(219,234,254,0)_100%)]"
        aria-hidden="true"
      />
      <motion.div
        className="relative z-10 grid grid-cols-12 items-start gap-6 lg:gap-8 xl:gap-10"
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_ONCE}
      >
        <motion.div className="order-2 col-span-12 lg:order-1 lg:col-span-7 xl:col-span-7" variants={carouselVariants}>
          <div className="relative w-full lg:max-w-[920px]">
            <div className="relative overflow-hidden rounded-2xl" onMouseLeave={stopEdgeScroll}>
              <div
                data-testid="infrastructure-carousel-stage"
                className="relative h-[420px] sm:h-[460px] md:h-[540px]"
                onMouseMove={handleStageMouseMove}
                onWheel={() => {
                  stopEdgeScroll();
                  cooldownUntilRef.current = performance.now() + 250;
                }}
              >
                {previousItem ? (
                  <div
                    data-testid="infrastructure-carousel-previous"
                    className="absolute left-1/2 top-1/2 hidden w-[360px] will-change-transform transition-transform transition-opacity duration-300 ease-out md:block"
                    style={getStackStyle(1)}
                    onClick={() => setActiveIndex(effectiveActiveIndex - 1)}
                  >
                    {renderCarouselItem(previousItem, false)}
                  </div>
                ) : null}

                {nextItem ? (
                  <div
                    data-testid="infrastructure-carousel-next"
                    className="absolute left-1/2 top-1/2 hidden w-[360px] will-change-transform transition-transform transition-opacity duration-300 ease-out md:block"
                    style={getStackStyle(-1)}
                    onClick={() => setActiveIndex(effectiveActiveIndex + 1)}
                  >
                    {renderCarouselItem(nextItem, false)}
                  </div>
                ) : null}

                {activeItem ? (
                  <div
                    key={activeItem.id}
                    data-testid="infrastructure-carousel-active"
                    className="absolute left-1/2 top-1/2 z-[56] w-[calc(100vw-3rem)] max-w-[360px] md:w-[360px]"
                    style={{ transform: "translate(-50%, -50%)" }}
                  >
                    {renderCarouselItem(activeItem, true)}
                  </div>
                ) : null}

                <div
                  className="absolute inset-y-0 left-0 z-[55] w-10 sm:w-12 md:w-16 lg:w-20 pointer-events-auto touch-none"
                  onMouseEnter={() => startEdgeScroll(1)}
                  onMouseLeave={stopEdgeScroll}
                  onPointerDown={onEdgePointerDown(1)}
                  onPointerUp={onEdgePointerUp}
                  onPointerCancel={onEdgePointerUp}
                  onPointerLeave={onEdgePointerUp}
                  onLostPointerCapture={onEdgePointerUp}
                />

                <div
                  className="absolute inset-y-0 right-0 z-[55] w-10 sm:w-12 md:w-16 lg:w-20 pointer-events-auto touch-none"
                  onMouseEnter={() => startEdgeScroll(-1)}
                  onMouseLeave={stopEdgeScroll}
                  onPointerDown={onEdgePointerDown(-1)}
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
                aria-label="Previous project"
                disabled={!hasMultipleItems || effectiveActiveIndex <= 0}
                className="h-10 w-10 rounded-full border border-[#C5CCD3] bg-white/95 text-[#56616B] shadow-[0_8px_18px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                onClick={goToPrevious}
              >
                <ChevronLeft className="h-5 w-5 stroke-[2.6]" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Next project"
                disabled={!hasMultipleItems || effectiveActiveIndex >= carouselItems.length - 1}
                className="h-10 w-10 rounded-full border border-[#C5CCD3] bg-white/95 text-[#56616B] shadow-[0_8px_18px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                onClick={goToNext}
              >
                <ChevronRight className="h-5 w-5 stroke-[2.6]" />
              </Button>
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-[30px] right-[30px] z-[70] hidden items-center justify-between lg:flex">
              <motion.div
                whileHover={reducedMotion ? undefined : { x: -2, scale: 1.04 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.2, ease: "easeInOut" }}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Next project"
                  disabled={!hasMultipleItems || effectiveActiveIndex >= carouselItems.length - 1}
                  className="pointer-events-auto h-14 w-14 rounded-full border border-[#C5CCD3] bg-white/95 text-[#56616B] shadow-[0_10px_24px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                  onClick={goToNext}
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
                  aria-label="Previous project"
                  disabled={!hasMultipleItems || effectiveActiveIndex <= 0}
                  className="pointer-events-auto h-14 w-14 rounded-full border border-[#C5CCD3] bg-white/95 text-[#56616B] shadow-[0_10px_24px_rgba(15,23,42,0.14)] hover:bg-white disabled:opacity-30"
                  onClick={goToPrevious}
                >
                  <ChevronRight className="h-7 w-7 stroke-[2.8]" />
                </Button>
              </motion.div>
            </div>
          </div>
        </motion.div>

        <div className="order-1 col-span-12 space-y-5 md:space-y-8 lg:order-2 lg:col-span-5 xl:col-span-5">
          <motion.div className="space-y-4 md:space-y-6" variants={headerVariants}>
            <h2 className="max-w-[14ch] break-words text-[clamp(2rem,10vw,2.9rem)] font-extrabold leading-[0.95] tracking-tight text-[#111827] sm:text-[3.2rem] lg:max-w-none lg:break-normal lg:text-[3.45rem] xl:text-6xl">
              {vm.heading}
            </h2>
            <p className="max-w-[24ch] text-lg leading-[1.45] text-[#495A64] sm:text-xl md:text-2xl">{vm.description}</p>
          </motion.div>

          <motion.div className="grid grid-cols-2 gap-3.5 md:gap-4" variants={kpiContainerVariants}>
            <motion.div className="h-full" variants={kpiItemVariants}>
              <CardShell className="flex h-full min-h-[130px] py-0 md:min-h-[152px]">
                <div className="flex h-full flex-col justify-between space-y-2 px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6">
                  <p className="text-3xl font-bold leading-none text-[#0B4E7B]">{formatCompactPeso(primaryValue)}</p>
                  <p className="text-sm font-medium text-slate-500">{vm.primaryKpiLabel}</p>
                </div>
              </CardShell>
            </motion.div>
            <motion.div className="h-full" variants={kpiItemVariants}>
              <CardShell className="flex h-full min-h-[130px] py-0 md:min-h-[152px]">
                <div className="flex h-full flex-col justify-between space-y-2 px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6">
                  <p className="text-3xl font-bold leading-none text-[#0B4E7B]">
                    {formatCompactCount(vm.secondaryKpiValue)}
                  </p>
                  <p className="text-sm font-medium text-slate-500">{vm.secondaryKpiLabel}</p>
                </div>
              </CardShell>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </FullScreenSection>
  );
}
