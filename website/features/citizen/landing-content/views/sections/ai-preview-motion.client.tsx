"use client";

import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ChatPreviewVM } from "@/lib/domain/landing-content";
import ChatPreviewCard from "./chat-preview-card";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";

type AiPreviewMotionProps = {
  vm: ChatPreviewVM;
};

export default function AiPreviewMotion({ vm }: AiPreviewMotionProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [hasEnteredView, setHasEnteredView] = useState(false);

  const headerContainer: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0 : 0.04,
        staggerChildren: reducedMotion ? 0.04 : 0.1,
      },
    },
  };

  const pillVariant: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: reducedMotion ? 0.22 : 0.45, ease: MOTION_TOKENS.enterEase },
    },
  };

  const titleVariant: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.24 : 0.68, ease: MOTION_TOKENS.enterEase },
    },
  };

  const subtitleVariant: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.24 : 0.62, ease: MOTION_TOKENS.enterEase },
    },
  };

  const cardVariant: Variants = {
    hidden: { opacity: 0, scale: reducedMotion ? 1 : 0.99 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: reducedMotion ? 0.3 : 0.7,
        delay: reducedMotion ? 0.08 : 0.16,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.div
      className="mx-auto flex w-full max-w-5xl min-w-0 flex-col items-center gap-6 md:gap-10"
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT_ONCE}
      onViewportEnter={() => setHasEnteredView(true)}
    >
      <motion.header className="space-y-3 text-center md:space-y-4" variants={headerContainer}>
        <motion.p
          className="mx-auto inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90 md:px-4 md:text-xs"
          variants={pillVariant}
        >
          {vm.pillLabel}
        </motion.p>
        <motion.h2 className="break-words text-[clamp(2rem,10vw,3.3rem)] font-bold tracking-tight text-white sm:text-6xl" variants={titleVariant}>
          {vm.title}
        </motion.h2>
        <motion.p className="mx-auto max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base md:text-xl" variants={subtitleVariant}>
          {vm.subtitle}
        </motion.p>
      </motion.header>

      <motion.div className="w-full max-w-4xl" variants={cardVariant}>
        <ChatPreviewCard vm={vm} isActive={hasEnteredView} />
      </motion.div>
    </motion.div>
  );
}
