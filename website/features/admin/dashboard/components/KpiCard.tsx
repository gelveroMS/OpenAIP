"use client";

import Link from "next/link";
import SharedKpiCard, { type KpiCardAccent } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

function toBadgeAccent(tagTone: "info" | "warning" | "danger"): KpiCardAccent {
  switch (tagTone) {
    case "warning":
      return "yellow";
    case "danger":
      return "orange";
    default:
      return "blue";
  }
}

export default function KpiCard({
  title,
  value,
  deltaLabel,
  icon: Icon,
  iconClassName,
  ctaLabel,
  ctaHref,
  onCtaClick,
  tagLabel,
  tagTone = "info",
}: {
  title: string;
  value: string | number;
  deltaLabel: string;
  icon: LucideIcon;
  iconClassName?: string;
  ctaLabel: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  tagLabel?: string;
  tagTone?: "info" | "warning" | "danger";
}) {
  const isNegative = deltaLabel.trim().startsWith("-");
  const TrendIcon = isNegative ? ArrowDownRight : ArrowUpRight;
  const showDelta = deltaLabel.trim().length > 0;
  const ctaButton = onCtaClick ? (
    <Button
      variant="outline"
      className="h-9 w-full justify-between rounded-[10px] border-slate-300 text-xs sm:text-[13px]"
      type="button"
      onClick={onCtaClick}
    >
      <span className="truncate">{ctaLabel}</span>
      <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  ) : (
    <Button
      variant="outline"
      className="h-9 w-full justify-between rounded-[10px] border-slate-300 text-xs sm:text-[13px]"
      asChild
    >
      <Link href={ctaHref ?? "#"}>
        <span className="truncate">{ctaLabel}</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Button>
  );

  return (
    <SharedKpiCard
      label={title}
      value={value}
      icon={<Icon className="h-4 w-4" />}
      iconContainerClassName={cn(
        "h-10 w-10 items-center justify-center rounded-[10px] bg-slate-50 text-slate-600",
        iconClassName
      )}
      badge={tagLabel ? { text: tagLabel, accent: toBadgeAccent(tagTone) } : undefined}
      subtext={
        showDelta ? (
          <span className="inline-flex items-center gap-1">
            <TrendIcon
              className={cn("h-3.5 w-3.5", isNegative ? "text-rose-500" : "text-emerald-500")}
            />
            <span>{deltaLabel}</span>
          </span>
        ) : undefined
      }
      meta={ctaButton}
      className="p-4 sm:p-5"
    />
  );
}
