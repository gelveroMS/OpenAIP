import Image from "next/image";
import { cn } from "@/lib/ui/utils";

const HERO_BG_SRC = "/citizen-dashboard/hero.webp";

type CitizenPageHeroProps = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  imageSrc?: string;
  className?: string;
};

export default function CitizenPageHero({
  title,
  subtitle,
  eyebrow,
  imageSrc,
  className,
}: CitizenPageHeroProps) {
  return (
    // ✅ Full-bleed breakout wrapper (no background here)
    <section
      className={cn(
        "relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen",
        className
      )}
    >
      {/* ✅ This creates the “x-axis margin” from the viewport edges */}
      <div className="px-4 sm:px-6 lg:px-8">
        {/* ✅ Actual hero box (background + border + shadow) */}
        <div
          className={cn(
            "relative h-[255px] overflow-hidden text-white shadow-sm"
          )}
        >
          {imageSrc ? (
            <div className="absolute inset-0">
              <Image
                src={imageSrc}
                alt={title}
                fill
                className="object-cover object-center"
                priority
              />
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0">
              <Image
                src={HERO_BG_SRC}
                alt=""
                fill
                className="object-fill"
                sizes="100vw"
                priority
              />
            </div>
          )}

          {/* ✅ Align hero content with your page width (6xl) */}
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.08)_42%,rgba(0,0,0,0.6)_100%)]"
            aria-hidden
          />

          <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-4 text-center sm:px-6 lg:px-8">
            {eyebrow ? (
              <p className="text-xs uppercase tracking-[0.2em] text-slate-100/80">
                {eyebrow}
              </p>
            ) : null}
            <h1
              className="text-4xl font-normal uppercase tracking-[0.06em] text-white md:text-6xl"
              style={{ fontFamily: "var(--font-baskervville-sc), Georgia, serif" }}
            >
              {title}
            </h1>
            <p className="mx-auto mt-4 max-w-4xl text-xs md:text-base">
              {subtitle}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

