"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { CitizenAuthVariant } from "@/features/citizen/auth/types";
import { cn } from "@/lib/ui/utils";

type CitizenAuthBrandPanelProps = {
  variant: CitizenAuthVariant;
  onToggleAuth: () => void;
  disableToggle?: boolean;
};

const COPY = {
  signup_cta: {
    title: "Not yet registered?",
    description: "Register to submit feedback on LGU programs and projects.",
    buttonLabel: "Sign Up",
    support: "Already serving your community through transparency.",
  },
  login_cta: {
    title: "Already have an account?",
    description: "Sign in to submit official feedback and monitor LGU projects.",
    buttonLabel: "Log In",
    support: "Access your account and continue your participation.",
  },
} as const;

const BACKGROUND_BY_VARIANT: Record<
  CitizenAuthVariant,
  { src: string; positionClass: string }
> = {
  signup_cta: {
    src: "/login/Login.webp",
    positionClass: "object-right",
  },
  login_cta: {
    src: "/login/sign-up.webp",
    positionClass: "object-left",
  },
};

export default function CitizenAuthBrandPanel({
  variant,
  onToggleAuth,
  disableToggle = false,
}: CitizenAuthBrandPanelProps) {
  const copy = COPY[variant];
  const background = BACKGROUND_BY_VARIANT[variant];

  return (
    <aside className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden bg-[#022437] px-8 py-10 text-white md:px-10">
      <Image
        src={background.src}
        alt=""
        fill
        className={cn("object-cover", background.positionClass)}
        sizes="(min-width: 768px) 50vw, 100vw"
        priority
      />
      <div className="absolute inset-0 bg-[#001925]/42" aria-hidden />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center justify-center gap-6 text-center">
        <h3 className="text-4xl font-bold leading-tight text-white">{copy.title}</h3>
        <p className="text-base leading-relaxed text-slate-100/90">{copy.description}</p>
        <Button
          type="button"
          onClick={onToggleAuth}
          disabled={disableToggle}
          className="h-12 w-full rounded-xl border border-cyan-400 bg-transparent text-base font-semibold text-cyan-300 hover:bg-cyan-500/10 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
        >
          {copy.buttonLabel}
        </Button>
        <p className="text-sm text-slate-200/85">{copy.support}</p>

        <div className="mt-2 flex items-center gap-3">
          <Image
            src="/login/with-bg-logo.png"
            alt="OpenAIP icon"
            width={28}
            height={28}
            className="h-7 w-7 rounded-full"
          />
          <div className="text-left">
            <p className="text-4xl font-semibold leading-none">OpenAIP</p>
            <p className="text-sm text-slate-200/85">Transparency Portal</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
