import {
  FEEDBACK_CATEGORY_SUMMARY_META,
  type FeedbackCategorySummaryItem,
} from "@/lib/constants/feedback-category-summary";
import { cn } from "@/lib/ui/utils";

type FeedbackCategorySummaryChartProps = {
  items: FeedbackCategorySummaryItem[];
  title?: string;
  footerLabel?: string;
  tone?: "dark" | "light";
  className?: string;
};

const SCALE_LABELS = [0, 20, 40, 60, 80, 100] as const;

export function FeedbackCategorySummaryChart({
  items,
  title = "Feedback Category Summary",
  footerLabel,
  tone = "light",
  className,
}: FeedbackCategorySummaryChartProps) {
  const isDark = tone === "dark";
  const titleClassName = isDark ? "text-white" : "text-slate-900";
  const scaleClassName = isDark ? "text-white/60" : "text-muted-foreground";
  const labelClassName = isDark ? "text-white/90" : "text-foreground";
  const trackClassName = isDark
    ? "border-white/10 bg-white/5"
    : "border-border bg-muted/40";
  const valueClassName = isDark ? "text-white/70" : "text-muted-foreground";
  const footerClassName = isDark
    ? "border-white/10 text-white/70"
    : "border-border text-muted-foreground";

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-3">
        <h3 className={cn("text-center text-xl font-semibold sm:text-3xl", titleClassName)}>
          {title}
        </h3>

        <div className="flex items-center justify-between text-[10px] font-medium sm:hidden">
          <span className={scaleClassName}>0</span>
          <span className={scaleClassName}>100</span>
        </div>
        <div className="hidden items-center gap-3 pl-28 sm:flex">
          {SCALE_LABELS.map((label) => (
            <span
              key={label}
              className={cn("min-w-0 flex-1 text-center text-[11px] font-medium sm:text-xs", scaleClassName)}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="space-y-4">
          {items.map((item) => {
            const color = FEEDBACK_CATEGORY_SUMMARY_META[item.key].color;
            const clampedPercentage = Math.max(0, Math.min(100, item.percentage));
            const valueOffset = Math.max(2, Math.min(clampedPercentage + 2, 88));
            const currentValueClassName = clampedPercentage >= 86 ? "text-white" : valueClassName;

            return (
              <div key={item.key} className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
                <div className={cn("text-xs font-medium sm:text-sm", labelClassName)}>{item.label}</div>
                <div className="relative">
                  <div
                    className={cn("relative h-9 overflow-hidden rounded-xl border sm:h-10", trackClassName)}
                    aria-hidden="true"
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-xl"
                      style={{
                        width: `${clampedPercentage}%`,
                        backgroundColor: color,
                      }}
                    />
                    <div className="absolute inset-0">
                      {SCALE_LABELS.slice(1, -1).map((label) => (
                        <div
                          key={`${item.key}-${label}`}
                          className={cn(
                            "absolute inset-y-0 border-l",
                            isDark ? "border-white/10" : "border-border/70"
                          )}
                          style={{ left: `${label}%` }}
                        />
                      ))}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs font-medium tabular-nums sm:text-sm",
                      currentValueClassName
                    )}
                    style={{ left: `${valueOffset}%` }}
                  >
                    {item.percentage.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {footerLabel ? (
        <div className={cn("flex items-center justify-center gap-2 border-t pt-4 text-xs", footerClassName)}>
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: FEEDBACK_CATEGORY_SUMMARY_META.question.color }}
            aria-hidden="true"
          />
          <span>{footerLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export type { FeedbackCategorySummaryChartProps, FeedbackCategorySummaryItem };
