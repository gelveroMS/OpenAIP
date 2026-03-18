"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Bot, MessageCircle } from "lucide-react";
import type { ChatPreviewVM } from "@/lib/domain/landing-content";
import { cn } from "@/lib/ui/utils";
import { MOTION_TOKENS } from "../../components/motion/motion-primitives";

type ChatPreviewCardProps = {
  vm: ChatPreviewVM;
  className?: string;
  isActive?: boolean;
};

type LegacyChatPreviewShape = Partial<{
  sampleQuestion: string;
  sampleAnswerLines: string[];
}>;

const FALLBACK_ASSISTANT_BULLETS = [
  "Total budget and sector allocations (General, Social, Economic, Other)",
  "Project details by category, including health and infrastructure",
  "Implementing agency, source of funds, and expected output per project",
];

export default function ChatPreviewCard({ vm, className, isActive = true }: ChatPreviewCardProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const legacyVm = vm as ChatPreviewVM & LegacyChatPreviewShape;
  const assistantBullets = useMemo(
    () =>
      Array.isArray(vm.assistantBullets)
        ? vm.assistantBullets
        : Array.isArray(legacyVm.sampleAnswerLines)
          ? legacyVm.sampleAnswerLines
          : [],
    [legacyVm.sampleAnswerLines, vm.assistantBullets]
  );
  const suggestedPrompts = useMemo(
    () => (Array.isArray(vm.suggestedPrompts) ? vm.suggestedPrompts : []),
    [vm.suggestedPrompts]
  );
  const userPrompt =
    typeof vm.userPrompt === "string" && vm.userPrompt.trim().length > 0
      ? vm.userPrompt
      : legacyVm.sampleQuestion ?? "";
  const assistantIntro =
    typeof vm.assistantIntro === "string" && vm.assistantIntro.trim().length > 0
      ? vm.assistantIntro
      : "From the published AIP file, I can answer questions such as:";
  const assistantScript = useMemo(() => {
    const shouldUseFallbackBullets = assistantBullets.length === 0 && assistantIntro.trim().length === 0;
    const effectiveBullets = shouldUseFallbackBullets ? FALLBACK_ASSISTANT_BULLETS : assistantBullets;
    const bulletText = effectiveBullets.join("\n");
    return bulletText ? `${assistantIntro}\n\n${bulletText}` : assistantIntro;
  }, [assistantBullets, assistantIntro]);
  const [typedUserPrompt, setTypedUserPrompt] = useState("");
  const [showAssistantBubble, setShowAssistantBubble] = useState(false);
  const [typedAssistantText, setTypedAssistantText] = useState("");
  const [activePromptIndex, setActivePromptIndex] = useState(-1);

  useEffect(() => {
    if (!isActive) {
      setTypedUserPrompt("");
      setShowAssistantBubble(false);
      setTypedAssistantText("");
      setActivePromptIndex(-1);
      return;
    }

    if (reducedMotion) {
      setTypedUserPrompt(userPrompt);
      setShowAssistantBubble(true);
      setTypedAssistantText(assistantScript);
      setActivePromptIndex(suggestedPrompts.length - 1);
      return;
    }

    setTypedUserPrompt("");
    setShowAssistantBubble(false);
    setTypedAssistantText("");
    setActivePromptIndex(-1);

    let userIdx = 0;
    let assistantIdx = 0;
    let userTimer: ReturnType<typeof setInterval> | null = null;
    let assistantTimer: ReturnType<typeof setInterval> | null = null;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    let promptTimer: ReturnType<typeof setInterval> | null = null;

    userTimer = setInterval(() => {
      userIdx += 1;
      setTypedUserPrompt(userPrompt.slice(0, userIdx));
      if (userIdx >= userPrompt.length && userTimer) {
        clearInterval(userTimer);
        pauseTimer = setTimeout(() => {
          setShowAssistantBubble(true);
          assistantTimer = setInterval(() => {
            assistantIdx += 1;
            setTypedAssistantText(assistantScript.slice(0, assistantIdx));
            if (assistantIdx >= assistantScript.length && assistantTimer) {
              clearInterval(assistantTimer);
              pauseTimer = setTimeout(() => {
                if (!suggestedPrompts.length) {
                  return;
                }
                let idx = -1;
                promptTimer = setInterval(() => {
                  idx += 1;
                  setActivePromptIndex(idx);
                  if (idx >= suggestedPrompts.length - 1 && promptTimer) {
                    clearInterval(promptTimer);
                  }
                }, 380);
              }, 350);
            }
          }, 45);
        }, 850);
      }
    }, 65);

    return () => {
      if (userTimer) clearInterval(userTimer);
      if (assistantTimer) clearInterval(assistantTimer);
      if (pauseTimer) clearTimeout(pauseTimer);
      if (promptTimer) clearInterval(promptTimer);
    };
  }, [assistantScript, isActive, reducedMotion, suggestedPrompts, userPrompt]);

  useEffect(() => {
    if (!isActive || reducedMotion) {
      return;
    }

    const failSafe = setTimeout(() => {
      setShowAssistantBubble(true);
    }, 2800);

    return () => clearTimeout(failSafe);
  }, [assistantScript, isActive, reducedMotion]);

  const userBubble: Variants = {
    hidden: { opacity: 0, x: reducedMotion ? 0 : 10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: reducedMotion ? 0.24 : 0.5,
        delay: reducedMotion ? 0.06 : 0.2,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const chipsContainer: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: reducedMotion ? 0.24 : 0.45,
        delay: reducedMotion ? 0.1 : 0.86,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  const chipItem: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.22 : 0.42, ease: MOTION_TOKENS.enterEase },
    },
  };

  const ctaBar: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reducedMotion ? 0.26 : 0.55,
        delay: reducedMotion ? 0.1 : 1.06,
        ease: MOTION_TOKENS.enterEase,
      },
    },
  };

  return (
    <motion.article
      className={cn(
        "overflow-hidden rounded-2xl border border-white/10 bg-[#e8edf1] shadow-[0_0_24px_rgba(34,211,238,0.12),0_16px_42px_rgba(1,21,33,0.35)]",
        className
      )}
      aria-label={`${vm.assistantName} preview`}
      initial="hidden"
      animate="visible"
    >
      <header className="bg-gradient-to-r from-[#0d5b71] via-[#0f8daa] to-[#0b7490] px-4 py-3 text-white sm:px-5 sm:py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold leading-none">{vm.assistantName}</p>
            <p className="text-xs text-white/80">{vm.assistantStatus}</p>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-6">
        <motion.div className="flex justify-end" variants={userBubble}>
          <p className="max-w-[92%] rounded-2xl bg-[#0b5a70] px-3 py-2 text-sm text-white sm:max-w-[88%] sm:px-4 sm:py-2.5">
            {typedUserPrompt}
          </p>
        </motion.div>

        <motion.div
          className="max-w-[92%] rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.07)] sm:max-w-[88%] sm:px-4 sm:py-3"
          initial={{ opacity: 0, x: reducedMotion ? 0 : -10 }}
          animate={{
            opacity: showAssistantBubble ? 1 : 0,
            x: reducedMotion ? 0 : showAssistantBubble ? 0 : -10,
          }}
          transition={{
            duration: reducedMotion ? 0.22 : 0.4,
            ease: MOTION_TOKENS.enterEase,
          }}
          aria-hidden={!showAssistantBubble}
        >
          <p className="whitespace-pre-line text-sm text-slate-700">
            {showAssistantBubble ? typedAssistantText : ""}
          </p>
        </motion.div>
      </div>

      <motion.div className="border-y border-slate-200 bg-[#f5f7fa] px-3 py-3 sm:px-5 sm:py-4" variants={chipsContainer}>
        <p className="mb-2 text-xs text-slate-500 sm:text-sm">Try asking:</p>
        <motion.div
          className="flex flex-wrap gap-2"
          variants={{
            hidden: { opacity: 1 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: reducedMotion ? 0 : 0.08,
                delayChildren: reducedMotion ? 0.02 : 0.08,
              },
            },
          }}
        >
          {suggestedPrompts.map((prompt, index) => (
            <motion.button
              key={prompt}
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs transition",
                activePromptIndex >= 0 && activePromptIndex === index
                  ? "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-300"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
              aria-label={`Suggested prompt: ${prompt}`}
              variants={chipItem}
              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
              transition={{ duration: reducedMotion ? 0.12 : 0.18, ease: MOTION_TOKENS.hoverEase }}
            >
              {prompt}
            </motion.button>
          ))}
        </motion.div>
      </motion.div>

      <motion.footer className="bg-gradient-to-r from-[#0a5166] via-[#0a6f88] to-[#0a8bac] px-4 py-4 sm:px-5 sm:py-5" variants={ctaBar}>
        {vm.ctaHref ? (
          <motion.div
            whileHover={reducedMotion ? undefined : { scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.18, ease: MOTION_TOKENS.hoverEase }}
            className="mx-auto w-fit"
          >
            <Link
              href={vm.ctaHref}
              aria-label={vm.ctaLabel}
              className="flex items-center gap-2 rounded-full px-3 py-1.5 text-2xl font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 sm:px-4 sm:text-3xl"
            >
              <MessageCircle className="h-6 w-6" aria-hidden="true" />
              <span>{vm.ctaLabel}</span>
            </Link>
          </motion.div>
        ) : (
          // TODO: Wire CTA click behavior when chat route is available.
          <button
            type="button"
            aria-label={vm.ctaLabel}
            className="mx-auto flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-2xl font-semibold text-white/90 sm:px-4 sm:text-3xl"
            disabled
          >
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
            <span>{vm.ctaLabel}</span>
          </button>
        )}
      </motion.footer>
    </motion.article>
  );
}
