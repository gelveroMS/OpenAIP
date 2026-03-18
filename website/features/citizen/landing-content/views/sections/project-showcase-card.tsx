import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { ProjectCardVM } from "@/lib/domain/landing-content";
import { cn } from "@/lib/ui/utils";

type ProjectShowcaseCardProps = {
  project: ProjectCardVM;
  budgetLabel: string;
  className?: string;
  tagChipClassName?: string;
  budgetChipClassName?: string;
  ctaClassName?: string;
  ctaHref?: string;
};

export default function ProjectShowcaseCard({
  project,
  budgetLabel,
  className,
  tagChipClassName,
  budgetChipClassName,
  ctaClassName,
  ctaHref = "/projects/health",
}: ProjectShowcaseCardProps) {
  return (
    <article
      tabIndex={0}
      className={cn(
        "h-auto min-h-[390px] w-full max-w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#67E8F9] md:h-[454px]",
        className
      )}
    >
      <div className="relative h-[176px] md:h-[196px]">
        <Image src={project.imageSrc} alt={project.title} fill className="object-cover" sizes="360px" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/45" />
        <div
          className={cn(
            "absolute left-3 top-3 rounded-full bg-[#EC4899]/90 px-3 py-1 text-[11px] font-semibold text-white",
            tagChipClassName
          )}
        >
          {project.tagLabel}
        </div>
        <div
          className={cn(
            "absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold text-[#BE185D]",
            budgetChipClassName
          )}
        >
          {budgetLabel}
        </div>
      </div>
      <div className="flex min-h-[214px] flex-col gap-2.5 p-4 md:h-[258px] md:gap-3 md:p-5">
        <div className="space-y-2">
          <h3 className="break-words text-lg font-semibold leading-tight text-[#0C2C3A]">{project.title}</h3>
          <p className="break-words text-sm text-slate-600">{project.subtitle}</p>
        </div>
        <div className="mt-auto">
          <Button
            asChild
            variant="outline"
            className={cn("w-full rounded-full border-[#E54B9B] bg-[#FFF1F8] text-[#C93F87] hover:bg-[#FFE4F2]", ctaClassName)}
          >
            <Link href={ctaHref}>View Project</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
