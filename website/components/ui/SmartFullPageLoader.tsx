"use client";

import Image from "next/image";
import type { SmartLoadingTarget } from "@/components/ui/SmartLoadingProvider";

export type SmartFullPageLoaderProps = {
  label?: string;
  target?: SmartLoadingTarget;
};

export default function SmartFullPageLoader({
  label = "Loading OpenAIP",
  target = "overlay",
}: SmartFullPageLoaderProps) {
  return (
    <div
      className="flex min-h-[340px] w-full items-center justify-center px-4 py-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-loader-target={target}
    >
      <div className="flex flex-col items-center justify-center gap-3 text-center sm:gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20 lg:h-24 lg:w-24">
          <span
            className="absolute inset-0 animate-spin rounded-full border-[3px] border-[#144679]/12 border-t-[#144679] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <Image
            src="/brand/logo3.svg"
            alt="OpenAIP logo"
            width={64}
            height={64}
            className="relative z-10 h-11 w-11 sm:h-14 sm:w-14 lg:h-16 lg:w-16"
          />
        </div>
        <p className="max-w-[18rem] text-sm font-semibold tracking-tight text-[#0B3440] sm:text-base">
          {label}
        </p>
      </div>
    </div>
  );
}
