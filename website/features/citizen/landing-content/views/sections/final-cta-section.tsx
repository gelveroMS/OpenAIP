import type { FinalCtaVM } from "@/lib/domain/landing-content";
import FullScreenSection from "../../components/layout/full-screen-section";
import FinalCtaMotion from "./final-cta-motion.client";

type FinalCtaSectionProps = {
  vm?: FinalCtaVM;
};

export default function FinalCtaSection({ vm }: FinalCtaSectionProps) {
  const safeVm: FinalCtaVM = {
    title: vm?.title ?? "Governance Made Visible.",
    subtitle: vm?.subtitle ?? "Stay informed. Stay engaged. Stay empowered.",
    ctaLabel: vm?.ctaLabel ?? "View Full AIP",
    ctaHref: vm?.ctaHref,
  };

  return (
    <FullScreenSection
      id="final-cta"
      variant="dark"
      className="items-stretch bg-[linear-gradient(180deg,#00384B_0%,#001925_100%)]"
      contentClassName="max-w-none px-0 py-0"
    >
      <FinalCtaMotion vm={safeVm} />
    </FullScreenSection>
  );
}
