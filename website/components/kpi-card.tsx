"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";

export type KpiCardAccent = "none" | "blue" | "green" | "orange" | "yellow" | "slate";
export type KpiCardVariant = "status" | "compact" | "split";
export type KpiCardAccentMode = "border" | "value" | "chip";
export type KpiCardIconPlacement = "left" | "right";

type AccentClasses = {
  border: string;
  value: string;
  iconSoft: string;
  chip: string;
};

const ACCENT_CLASS_MAP: Record<Exclude<KpiCardAccent, "none">, AccentClasses> = {
  blue: {
    border: "border-blue-200",
    value: "text-blue-700",
    iconSoft: "bg-blue-50 text-blue-700",
    chip: "border-blue-200 bg-blue-50 text-blue-700",
  },
  green: {
    border: "border-emerald-200",
    value: "text-emerald-700",
    iconSoft: "bg-emerald-50 text-emerald-700",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  orange: {
    border: "border-orange-200",
    value: "text-orange-700",
    iconSoft: "bg-orange-50 text-orange-700",
    chip: "border-orange-200 bg-orange-50 text-orange-700",
  },
  yellow: {
    border: "border-amber-200",
    value: "text-amber-700",
    iconSoft: "bg-amber-50 text-amber-700",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
  },
  slate: {
    border: "border-slate-300",
    value: "text-slate-700",
    iconSoft: "bg-slate-100 text-slate-700",
    chip: "border-slate-300 bg-slate-100 text-slate-700",
  },
};

function normalizeAccent(accent: string | undefined): KpiCardAccent {
  if (!accent || accent === "none") {
    return "none";
  }

  if (accent in ACCENT_CLASS_MAP) {
    return accent as KpiCardAccent;
  }

  return "slate";
}

export type KpiCardProps = {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  iconPlacement?: KpiCardIconPlacement;
  variant?: KpiCardVariant;
  accent?: KpiCardAccent;
  accentMode?: KpiCardAccentMode;
  badge?: { text: string; accent?: string };
  className?: string;
  onClick?: () => void;
};

export function KpiCard({
  label,
  value,
  subtext,
  meta,
  icon,
  iconPlacement,
  variant = "status",
  accent = "none",
  accentMode = "border",
  badge,
  className,
  onClick,
}: KpiCardProps) {
  const resolvedAccent = normalizeAccent(accent);
  const resolvedBadgeAccent = normalizeAccent(badge?.accent);
  const resolvedIconPlacement = iconPlacement ?? (variant === "split" ? "right" : "left");
  const accentClasses = resolvedAccent === "none" ? ACCENT_CLASS_MAP.slate : ACCENT_CLASS_MAP[resolvedAccent];
  const badgeClasses = resolvedBadgeAccent === "none" ? ACCENT_CLASS_MAP.slate.chip : ACCENT_CLASS_MAP[resolvedBadgeAccent].chip;

  const borderClass =
    accentMode === "border" && resolvedAccent !== "none"
      ? accentClasses.border
      : "border-slate-200";
  const valueClass =
    accentMode === "value" && resolvedAccent !== "none"
      ? accentClasses.value
      : "text-slate-900";
  const iconContainerClass =
    resolvedAccent !== "none" ? accentClasses.iconSoft : "bg-slate-100 text-slate-600";

  const badgeNode = badge ? (
    <span className={cn("inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", badgeClasses)}>
      {badge.text}
    </span>
  ) : null;

  const iconNode = icon ? (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg",
        variant === "split" ? "h-10 w-10 rounded-xl" : "h-8 w-8",
        iconContainerClass
      )}
      aria-hidden
    >
      {icon}
    </span>
  ) : null;

  const statusLayout = (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("min-w-0", iconNode ? "flex items-center gap-2" : "block")}>
          {iconNode && resolvedIconPlacement === "left" ? iconNode : null}
          <p className="truncate text-xs text-slate-500">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          {badgeNode}
          {iconNode && resolvedIconPlacement === "right" ? iconNode : null}
        </div>
      </div>
      <div className={cn("break-words text-3xl font-semibold leading-tight", valueClass)}>{value}</div>
      {(subtext || meta) ? (
        <div className="mt-auto space-y-1 pt-3">
          {subtext ? <div className="text-xs text-slate-500">{subtext}</div> : null}
          {meta ? <div className="text-xs leading-relaxed text-slate-500">{meta}</div> : null}
        </div>
      ) : null}
    </div>
  );

  const compactLayout = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-slate-500">{label}</p>
        {badgeNode}
      </div>
      <div className={cn("break-words text-2xl font-semibold leading-tight", valueClass)}>{value}</div>
      {(subtext || meta) ? (
        <div className="mt-auto space-y-1 pt-2">
          {subtext ? <div className="text-xs text-slate-500">{subtext}</div> : null}
          {meta ? <div className="text-[11px] leading-relaxed text-slate-500">{meta}</div> : null}
        </div>
      ) : null}
    </div>
  );

  const splitLayout = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <p className="truncate text-xs text-slate-500">{label}</p>
        <div className={cn("break-words text-2xl font-semibold leading-tight", valueClass)}>{value}</div>
        <div className="mt-auto space-y-2 pt-2">
          {subtext ? <div className="text-xs text-slate-500">{subtext}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            {meta ? <div className="text-[11px] leading-relaxed text-slate-500">{meta}</div> : null}
            {badgeNode}
          </div>
        </div>
      </div>
      {iconNode && resolvedIconPlacement === "right" ? iconNode : null}
    </div>
  );

  const content = (
    <>
      {variant === "compact" ? compactLayout : null}
      {variant === "status" ? statusLayout : null}
      {variant === "split" ? splitLayout : null}
    </>
  );

  const cardClassName = cn(
    "rounded-2xl border bg-white text-slate-900 shadow-none",
    variant === "compact" ? "min-h-[96px] p-3" : "min-h-[112px] p-4",
    borderClass,
    onClick
      ? "cursor-pointer text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
      : null,
    className
  );

  if (onClick) {
    return (
      <button type="button" className={cardClassName} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}

export default KpiCard;
