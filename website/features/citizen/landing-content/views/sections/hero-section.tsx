import Image from "next/image";
import type { LandingHeroVM } from "@/lib/domain/landing-content";
import FullScreenSection from "../../components/layout/full-screen-section";
import PrimaryButton from "../../components/atoms/primary-button";
import HeroMotion from "./hero-motion.client";

type HeroSectionProps = {
  vm?: LandingHeroVM;
};

type LegacyHeroShape = Partial<{
  ctaHref: string;
}>;

const HERO_BG_SRC = "/citizen-dashboard/hero.webp";

export default function HeroSection({ vm }: HeroSectionProps) {
  const legacyVm = vm as LandingHeroVM & LegacyHeroShape;
  const ctaTarget = vm?.ctaHrefOrAction;
  const title = "Know Where\nEvery Peso Goes.";
  const subtitle =
    vm?.subtitle ??
    "Explore the Annual Investment Plan through clear budget breakdowns, sector allocations, and funded projects.";
  const ctaLabel = vm?.ctaLabel ?? "Explore the AIP";
  const ctaProps =
    ctaTarget?.type === "href"
      ? { href: ctaTarget.value }
      : ctaTarget?.type === "action"
        ? { actionKey: ctaTarget.value }
        : legacyVm?.ctaHref
          ? { href: legacyVm.ctaHref }
          : {};

  return (
    <FullScreenSection
      id="hero"
      variant="dark"
      className="items-stretch bg-[#EAF1F5] text-linen"
      contentClassName="max-w-none px-0 py-0"
    >
      <div className="relative left-1/2 -mt-12 w-screen -translate-x-1/2 px-3 sm:px-4 md:px-6">
        <div className="relative h-[calc(100vh-96px)] min-h-[620px] w-full overflow-hidden rounded-2xl supports-[height:100svh]:h-[calc(100svh-96px)]">
          <div className="pointer-events-none absolute inset-0">
            <Image
              src={HERO_BG_SRC}
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-center"
              priority
            />

            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.24)_45%,rgba(0,0,0,0.42)_100%)]" />
          </div>

          <HeroMotion
            title={title}
            subtitle={subtitle}
            cta={
              <PrimaryButton
                label={ctaLabel}
                ariaLabel={ctaLabel}
                {...ctaProps}
              />
            }
          />
        </div>
      </div>
    </FullScreenSection>
  );
}
