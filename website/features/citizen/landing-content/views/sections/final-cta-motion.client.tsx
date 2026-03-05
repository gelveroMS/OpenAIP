"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { FinalCtaVM } from "@/lib/domain/landing-content";
import { cn } from "@/lib/ui/utils";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";

type FinalCtaMotionProps = {
  vm: FinalCtaVM;
};

export default function FinalCtaMotion({ vm }: FinalCtaMotionProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [hasStarted, setHasStarted] = useState(false);
  const [subtitleDone, setSubtitleDone] = useState(false);

  const [titleLead, titleTail] = useMemo(() => {
    const parts = vm.title.trim().split(/\s+/);
    if (parts.length <= 2) {
      return [vm.title, ""];
    }
    return [parts.slice(0, 2).join(" "), parts.slice(2).join(" ")];
  }, [vm.title]);

  useEffect(() => {
    if (!hasStarted) {
      return;
    }

    if (reducedMotion) {
      setSubtitleDone(true);
      return;
    }

    setSubtitleDone(false);

    const revealTimer = setTimeout(() => {
      setSubtitleDone(true);
    }, 1600);

    return () => {
      clearTimeout(revealTimer);
    };
  }, [hasStarted, reducedMotion]);

  return (
    <div className="flex min-h-screen snap-start flex-col supports-[height:100svh]:min-h-[100svh]">
      <motion.div
        className="flex flex-1 items-center justify-center px-6 md:px-10 lg:px-14"
        initial={false}
        whileInView="visible"
        onViewportEnter={() => setHasStarted(true)}
        viewport={VIEWPORT_ONCE}
      >
        <div className="mx-auto w-full max-w-4xl text-center">
          <h2 className="text-6xl font-bold tracking-tight text-[#F2ECE5] md:text-7xl">
            <motion.span
              className="inline"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
              animate={
                hasStarted
                  ? { opacity: 1, y: 0 }
                  : { opacity: 0, y: reducedMotion ? 0 : 14 }
              }
              transition={{
                duration: reducedMotion ? 0.24 : 0.58,
                ease: MOTION_TOKENS.enterEase,
              }}
            >
              {titleLead}
            </motion.span>
            {titleTail ? " " : null}
            {titleTail ? (
              <motion.span
                className="inline"
                initial={{ opacity: 0 }}
                animate={hasStarted ? { opacity: 1 } : { opacity: 0 }}
                transition={{
                  duration: reducedMotion ? 0.3 : 1.05,
                  delay: reducedMotion ? 0.06 : 0.46,
                  ease: MOTION_TOKENS.enterEase,
                }}
              >
                {titleTail}
              </motion.span>
            ) : null}
          </h2>
          <motion.p
            className="mt-4 text-xl text-[#F2ECE5]/85 md:text-2xl"
            initial={{ opacity: 0 }}
            animate={hasStarted ? { opacity: 1 } : { opacity: 0 }}
            transition={{
              duration: reducedMotion ? 0.22 : 0.4,
              delay: reducedMotion ? 0.08 : 1.2,
              ease: MOTION_TOKENS.enterEase,
            }}
          >
            {vm.subtitle}
          </motion.p>

          <motion.div
            className="mt-25 flex justify-center"
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.985 }}
            animate={
              subtitleDone
                ? { opacity: 1, scale: 1 }
                : { opacity: 0, scale: reducedMotion ? 1 : 0.985 }
            }
            transition={{
              duration: reducedMotion ? 0.22 : 0.52,
              ease: MOTION_TOKENS.enterEase,
            }}
          >
            {vm.ctaHref ? (
              <motion.div
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                transition={{
                  duration: reducedMotion ? 0.12 : 0.18,
                  ease: MOTION_TOKENS.hoverEase,
                }}
              >
                <Link
                  href={vm.ctaHref}
                  aria-label="View Full AIP"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-8 py-3 text-base font-semibold text-[#143240] shadow-[0_8px_22px_rgba(0,0,0,0.22)] transition hover:bg-white/95"
                >
                  {vm.ctaLabel}
                </Link>
              </motion.div>
            ) : (
              <motion.button
                type="button"
                disabled
                aria-disabled="true"
                aria-label="View Full AIP"
                className={cn(
                  "inline-flex items-center justify-center rounded-xl bg-white px-8 py-3 text-base font-semibold text-[#143240]",
                  "cursor-not-allowed opacity-50 shadow-[0_8px_22px_rgba(0,0,0,0.22)]"
                )}
              >
                {vm.ctaLabel}
              </motion.button>
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
