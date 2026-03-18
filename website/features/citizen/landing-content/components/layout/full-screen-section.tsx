import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";

type FullScreenSectionProps = {
  id: string;
  variant?: "light" | "dark";
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

export default function FullScreenSection({
  id,
  variant = "light",
  className,
  contentClassName,
  children,
}: FullScreenSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "snap-start flex min-h-0 items-start overflow-x-hidden md:min-h-screen md:items-center md:supports-[height:100svh]:min-h-[100svh]",
        variant === "dark" ? "bg-[#022437] text-slate-100" : "bg-[#EDF2F5] text-[#0C2C3A]",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto w-full min-w-0 max-w-7xl px-4 py-8 sm:px-5 sm:py-10 md:px-10 md:py-12 lg:px-14 lg:py-16",
          contentClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}
