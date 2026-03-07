"use client";

import { Building2 } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import type { LguOverviewVM } from "@/lib/domain/landing-content";
import { formatNumber, formatPeso } from "@/lib/formatting";
import LguMapPanel from "../../components/map/lgu-map-panel";
import SectionHeader from "../../components/atoms/section-header";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";

type LguBudgetOverviewMotionProps = {
  vm: LguOverviewVM;
  mapPanelHeightClass: string;
};

const NO_PREVIOUS_YEAR_DATA_LABEL = "No data from previous year";

export default function LguBudgetOverviewMotion({
  vm,
  mapPanelHeightClass,
}: LguBudgetOverviewMotionProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const getDeltaBadgeClassName = (label: string) =>
    label === NO_PREVIOUS_YEAR_DATA_LABEL
      ? "inline-flex px-0 py-0 text-[11px] font-medium text-slate-500"
      : "inline-flex rounded-md bg-[#10B981]/10 px-2 py-1 text-xs font-medium text-[#0D7B62]";

  const headerVariant: Variants = {
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

  const lguHeaderVariant: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 14 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.58,
        delay: reducedMotion ? 0.06 : 0.1,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const kpiContainerVariant: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0.1 : 0.18,
        staggerChildren: reducedMotion ? 0 : 0.08,
      },
    },
  };

  const kpiItemVariant: Variants = {
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

  const kpiPrimaryVariant: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 14, scale: reducedMotion ? 1 : 0.99 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: reducedMotion ? 0.24 : 0.62,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const mapPanelVariant: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.28 : 0.7,
        delay: reducedMotion ? 0.12 : 0.26,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.div
      className="relative mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200 bg-white/60 p-6 shadow-sm backdrop-blur-sm md:p-8"
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT_ONCE}
    >
      <motion.div variants={headerVariant}>
        <SectionHeader
          align="center"
          title="LGU Budget Overview"
          titleClassName="font-bold text-[#0B4E7B]"
          subtitle="Explore local government units and view their allocated budgets, project count, and AIP publication status."
        />
      </motion.div>

      <div className="mt-7 grid grid-cols-12 gap-6">
        <div className="col-span-12 space-y-4 lg:col-span-5">
          <motion.div className="flex items-start gap-3 p-3" variants={lguHeaderVariant}>
            <div className="mt-0.5 grid h-15 w-15 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0B4E7B] to-[#5EB3E4] text-white shadow-[0_10px_24px_rgba(11,78,123,0.2)]">
              <Building2 className="h-8 w-8" aria-hidden="true" />
            </div>
            <div>
              <p className="text-3xl font-bold leading-none text-[#0C4F78]">{vm.lguName}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-sm bg-[#0b4e7b] px-2.5 py-1 text-[11px] font-medium text-white">
                  {vm.scopeLabel}
                </span>
                <span className="rounded-sm border-slateblue px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {vm.fiscalYearLabel}
                </span>
              </div>
            </div>
          </motion.div>

          <motion.div className="space-y-3" variants={kpiContainerVariant}>
            <motion.div variants={kpiPrimaryVariant}>
              <Card className="rounded-2xl border-slate-200 bg-white py-0">
                <CardContent className="space-y-3 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total Budget</p>
                  <p className="text-4xl font-bold leading-none text-[#0C2C3A]">{formatPeso(vm.totalBudget)}</p>
                  {vm.budgetDeltaLabel ? (
                    <div className={getDeltaBadgeClassName(vm.budgetDeltaLabel)}>
                      {vm.budgetDeltaLabel}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>

            <div className="grid grid-cols-2 items-stretch gap-3">
              <motion.div className="h-full" variants={kpiItemVariant}>
                <Card className="h-full rounded-2xl border-slate-200 bg-white py-0">
                  <CardContent className="flex h-full min-h-[126px] flex-col p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total Projects</p>
                    <p className="mt-5 text-4xl font-semibold leading-none text-[#0C2C3A]">{formatNumber(vm.projectCount)}</p>
                    {vm.projectDeltaLabel ? (
                      <span className={`mt-4 ${getDeltaBadgeClassName(vm.projectDeltaLabel)}`}>
                        {vm.projectDeltaLabel}
                      </span>
                    ) : null}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div className="h-full" variants={kpiItemVariant}>
                <Card className="h-full rounded-2xl border-slate-200 bg-white py-0">
                  <CardContent className="flex h-full min-h-[126px] flex-col p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">AIP Status</p>
                    <div className="mt-5 inline-flex items-start gap-2 text-xl font-semibold leading-none text-[#0C2C3A]">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#0EA97B]" />
                      {vm.aipStatus}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <motion.div variants={kpiItemVariant}>
              <Card className="rounded-2xl border-slate-200 bg-white py-0">
                <CardContent className="p-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">OpenAIP Citizens</p>
                    <p className="mt-5 text-4xl font-semibold leading-none text-[#0C2C3A]">{formatNumber(vm.citizenCount)}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>

        <motion.div className="col-span-12 h-full lg:col-span-7" variants={mapPanelVariant}>
          <LguMapPanel map={vm.map} heightClass={mapPanelHeightClass} />
        </motion.div>
      </div>
    </motion.div>
  );
}
