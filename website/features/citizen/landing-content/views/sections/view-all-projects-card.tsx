import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";

type ViewAllProjectsCardProps = {
  title: string;
  href: string;
  actionLabel: string;
  className?: string;
  titleClassName?: string;
  actionClassName?: string;
  interactive?: boolean;
};

export default function ViewAllProjectsCard({
  title,
  href,
  actionLabel,
  className,
  titleClassName,
  actionClassName,
  interactive = true,
}: ViewAllProjectsCardProps) {
  const cardClassName = cn(
    "h-auto min-h-[390px] w-full max-w-[360px] rounded-2xl border border-dashed border-slate-300 bg-white/95 p-5 shadow-sm transition-transform duration-200 md:h-[454px] md:p-7",
    interactive && "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67E8F9]",
    className
  );

  const content = (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center md:gap-6">
      <p className={cn("max-w-[14ch] break-words text-[1.55rem] font-bold leading-tight text-[#0C2C3A] md:text-[1.7rem]", titleClassName)}>{title}</p>
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full bg-[#EC4899] px-4 py-2 text-sm font-semibold text-white md:px-5",
          actionClassName
        )}
      >
        {actionLabel}
        <ArrowRight className="h-4 w-4" />
      </span>
    </div>
  );

  if (!interactive) {
    return <article className={cardClassName}>{content}</article>;
  }

  return (
    <Link href={href} className={cn("block", cardClassName)} aria-label={title}>
      {content}
    </Link>
  );
}
