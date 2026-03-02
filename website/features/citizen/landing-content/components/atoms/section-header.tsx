import { cn } from "@/lib/ui/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  className?: string;
  titleClassName?: string;
};

export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
  className,
  titleClassName,
}: SectionHeaderProps) {
  return (
    <header className={cn(align === "center" ? "text-center" : "text-left", className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#4B88A2]">{eyebrow}</p>
      ) : null}
      <h2
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight md:text-4xl",
          align === "center" ? "mx-auto max-w-3xl" : "",
          titleClassName
        )}
      >
        {title}
      </h2>
      {subtitle ? (
        <p className={cn("mt-3 text-sm leading-7 md:text-base", align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl")}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

