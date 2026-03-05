"use client";

import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { motion, useInView, useReducedMotion, type Variants } from "framer-motion";
import {
  MOTION_TOKENS,
  VIEWPORT_ONCE,
  fadeUp,
} from "../../components/motion/motion-primitives";

type HeroMotionProps = {
  title: string;
  subtitle: string;
  cta: ReactNode;
};

function splitHeadlineLines(title: string): string[] {
  const lines = title
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : [title];
}

export default function HeroMotion({ title, subtitle, cta }: HeroMotionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const hasEntered = useInView(rootRef, VIEWPORT_ONCE);
  const titleLines = useMemo(() => splitHeadlineLines(title), [title]);

  const overlayVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: reducedMotion ? 0.2 : 0.7, ease: MOTION_TOKENS.enterEase },
    },
  };

  const headlineContainerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0 : 0.08,
        staggerChildren: reducedMotion ? 0 : 0.08,
      },
    },
  };

  const subtitleVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.2 : 0.65,
        delay: reducedMotion ? 0.06 : 0.14,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const ctaVariants: Variants = {
    hidden: { opacity: 0, scale: reducedMotion ? 1 : 0.98 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: reducedMotion ? 0.2 : 0.65,
        delay: reducedMotion ? 0.1 : 0.3,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.div
      ref={rootRef}
      className="absolute inset-0"
      initial="hidden"
      animate={hasEntered ? "visible" : "hidden"}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-[#001925]/38 via-[#001925]/26 to-[#001925]/44"
        variants={overlayVariants}
      />

      <div className="relative z-20 h-full px-10 sm:px-16 lg:px-24">
        <div className="grid h-full grid-cols-12 items-center">
          <div className="col-span-12 lg:col-span-7">
            <div className="pt-12 pb-6 sm:pt-12 sm:pb-8 lg:pt-16 lg:pb-12">
              <motion.h1
                className="max-w-[680px] text-[clamp(2.6rem,7vw,5.2rem)] font-semibold leading-[1] tracking-tight text-linen"
                variants={headlineContainerVariants}
              >
                {titleLines.map((line, index) => (
                  <motion.span key={`${line}-${index}`} className="block" variants={fadeUp(reducedMotion)}>
                    {line}
                  </motion.span>
                ))}
              </motion.h1>

              <motion.p
                className="mt-5 max-w-[640px] text-[12px] leading-7 text-white/80 md:text-[17px] md:leading-[29px]"
                variants={subtitleVariants}
              >
                {subtitle}
              </motion.p>

              <motion.div
                className="mt-20 inline-flex"
                variants={ctaVariants}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                transition={{ duration: MOTION_TOKENS.hoverDuration, ease: MOTION_TOKENS.hoverEase }}
              >
                {cta}
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <motion.div
        className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
        animate={
          hasEntered
            ? reducedMotion
              ? { opacity: 0.6 }
              : { opacity: 0.6, y: [0, 6, 0] }
            : { opacity: 0, y: 0 }
        }
        transition={
          reducedMotion
            ? { duration: 0.2, ease: MOTION_TOKENS.enterEase, delay: 0.14 }
            : {
                opacity: { duration: 0.5, ease: MOTION_TOKENS.enterEase, delay: 0.5 },
                y: { duration: 2.2, repeat: Infinity, ease: MOTION_TOKENS.hoverEase },
              }
        }
      >
        <div className="flex min-w-[92px] flex-col items-center rounded-sm bg-[#082241]/35 px-3 py-2 text-white/70 backdrop-blur-[2px]">
          <span className="text-sm leading-none">Scroll to explore</span>
          <svg viewBox="0 0 20 20" className="mt-1 h-4 w-4" fill="none" aria-hidden="true">
            <path d="M5 8.5L10 13.5L15 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      </motion.div>
    </motion.div>
  );
}
