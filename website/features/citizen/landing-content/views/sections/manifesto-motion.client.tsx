"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { MOTION_TOKENS, VIEWPORT_ONCE } from "../../components/motion/motion-primitives";

type ManifestoMotionProps = {
  eyebrow: string;
  lines: string[];
  emphasis: string;
  supportingLine: string;
};

export default function ManifestoMotion({
  eyebrow,
  lines,
  emphasis,
  supportingLine,
}: ManifestoMotionProps) {
  const reducedMotion = useReducedMotion() ?? false;

  const containerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: { opacity: 1 },
  };

  const itemFadeIn: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: reducedMotion ? 0.24 : 0.45,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const linesContainer: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: reducedMotion ? 0.08 : 0.28,
        staggerChildren: reducedMotion ? 0 : 0.2,
      },
    },
  };

  const itemFadeUp: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 14 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.26 : 0.7,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const itemScaleIn: Variants = {
    hidden: { opacity: 0, scale: reducedMotion ? 1 : 0.99 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: reducedMotion ? 0.24 : 0.95,
        delay: reducedMotion ? 0.14 : 1.52,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const supportFadeIn: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: reducedMotion ? 0.22 : 0.35,
        delay: reducedMotion ? 0.2 : 1.68,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.div
      className="mx-auto w-full min-w-0 max-w-[22rem] px-2 text-center sm:max-w-none sm:px-0"
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT_ONCE}
      variants={containerVariants}
    >
      <motion.p
        className="text-center text-xs font-semibold leading-5 tracking-[0.5px] text-steelblue sm:text-sm md:text-xl md:leading-[24px]"
        variants={itemFadeIn}
      >
        {eyebrow}
      </motion.p>

      <motion.div className="mt-3 space-y-1 md:mt-6 md:space-y-2" variants={linesContainer}>
        {lines.map((line, index) => (
          <motion.p
            key={`${line}-${index}`}
            className="break-words text-center text-[clamp(1.95rem,12.5vw,3.2rem)] font-bold leading-[0.96] text-darkslategray sm:text-[clamp(2.25rem,13vw,3.7rem)] md:text-6xl md:leading-[60px]"
            variants={itemFadeUp}
          >
            {line}
          </motion.p>
        ))}
      </motion.div>

      <motion.p
        className="mx-auto mt-3 max-w-[10ch] text-center text-[clamp(2.45rem,14vw,3.7rem)] font-bold leading-[0.94] text-[#0B4E7B] sm:text-[clamp(2.8rem,14.5vw,4.4rem)] md:mt-6 md:max-w-none md:text-8xl"
        style={{
          textShadow:
            "0 0 8px rgba(255,255,255,0.8), 0 0 18px rgba(186,230,253,0.7), 0 0 30px rgba(125,211,252,0.45)",
        }}
        variants={itemScaleIn}
      >
        {emphasis}
      </motion.p>

      <motion.p className="mx-auto mt-2 max-w-[20ch] text-center text-sm leading-6 text-gray sm:text-base md:mt-4 md:max-w-none md:text-xl md:leading-7" variants={supportFadeIn}>
        {supportingLine}
      </motion.p>
    </motion.div>
  );
}
