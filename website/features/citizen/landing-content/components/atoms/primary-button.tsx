import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";

type PrimaryButtonProps = {
  label: string;
  href?: string;
  actionKey?: string;
  className?: string;
  ariaLabel?: string;
};

export default function PrimaryButton({
  label,
  href,
  actionKey,
  className,
  ariaLabel,
}: PrimaryButtonProps) {
  const baseClassName =
    "h-12 rounded-full bg-[#CBECF4] px-8 text-base text-[#001925] hover:bg-[#CBECF4]/90 focus-visible:ring-2 focus-visible:ring-[#67E8F9]";

  if (href) {
    return (
      <Button
        asChild
        className={cn(
          baseClassName,
          className
        )}
      >
        <Link href={href} aria-label={ariaLabel ?? label}>
          {label}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      aria-label={ariaLabel ?? label}
      data-action-key={actionKey}
      className={cn(
        baseClassName,
        className
      )}
    >
      {label}
    </Button>
  );
}

