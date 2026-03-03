"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";
import { DASHBOARD_TAG_TONE_STYLES } from "@/lib/ui/tokens";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

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
  return (
    <Card className="border-slate-200 py-0 shadow-none">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-[10px] bg-slate-50", iconClassName)}>
            <Icon className="h-4 w-4 text-slate-600" />
          </div>
          {tagLabel && (
            <Badge className={cn("border text-[11px]", DASHBOARD_TAG_TONE_STYLES[tagTone])}>{tagLabel}</Badge>
          )}
        </div>
        <div>
          <div className="text-[35px] leading-9 font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-[13px] text-slate-600">{title}</div>
        </div>
        {showDelta && (
          <div className="flex items-center gap-1 text-[12px] text-slate-500">
            <TrendIcon
              className={cn("h-3.5 w-3.5", isNegative ? "text-rose-500" : "text-emerald-500")}
            />
            <span>{deltaLabel}</span>
          </div>
        )}
        {onCtaClick ? (
          <Button
            variant="outline"
            className="h-8.5 w-full justify-between rounded-[10px] border-slate-300 text-[13px]"
            type="button"
            onClick={onCtaClick}
          >
            <span>{ctaLabel}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-8.5 w-full justify-between rounded-[10px] border-slate-300 text-[13px]"
            asChild
          >
            <Link href={ctaHref ?? "#"}>
              <span>{ctaLabel}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
