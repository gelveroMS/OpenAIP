import type { LandingManifestoVM } from "@/lib/domain/landing-content";
import FullScreenSection from "../../components/layout/full-screen-section";
import ManifestoMotion from "./manifesto-motion.client";

type ManifestoSectionProps = {
  vm: LandingManifestoVM;
};

export default function ManifestoSection({ vm }: ManifestoSectionProps) {
  const eyebrow = vm.eyebrow || "PUBLIC. CLEAR. ACCOUNTABLE.";
  const emphasis = "Fully Transparent.";

  return (
    <FullScreenSection id="manifesto" className="relative min-h-[88svh] overflow-hidden bg-[#EAF1F5] font-inter md:min-h-screen">
      <div className="relative mx-auto flex min-h-[72svh] max-w-[900px] items-center justify-center py-3 md:min-h-screen">
        <ManifestoMotion
          eyebrow={eyebrow}
          lines={vm.lines}
          emphasis={emphasis}
          supportingLine={vm.subtext}
        />
      </div>
    </FullScreenSection>
  );
}
