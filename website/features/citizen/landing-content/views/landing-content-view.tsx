import CitizenFooter from "@/features/citizen/components/citizen-footer";
import type { LandingContentVM } from "@/lib/domain/landing-content";
import LandingContentCanvas from "../components/layout/landing-content-canvas";
import {
  AiAssistantPreviewSection,
  FinalCtaSection,
  FundsDistributionSection,
  HealthProjectsSection,
  HeroSection,
  InfrastructureProjectsSection,
  LguBudgetOverviewSection,
  ManifestoSection,
  VoiceMattersSection,
} from "./sections";

type LandingContentViewProps = {
  vm: LandingContentVM;
};

export default function LandingContentView({ vm }: LandingContentViewProps) {
  return (
    <LandingContentCanvas>
      <HeroSection vm={vm.hero} />
      <ManifestoSection vm={vm.manifesto} />
      <LguBudgetOverviewSection vm={vm.lguOverview} />
      <FundsDistributionSection vm={vm.distribution} />
      <HealthProjectsSection vm={vm.healthHighlights} />
      <InfrastructureProjectsSection vm={vm.infraHighlights} />
      <VoiceMattersSection vm={vm.feedback} />
      <AiAssistantPreviewSection vm={vm.chatPreview} />
      <FinalCtaSection vm={vm.finalCta} />
      <CitizenFooter forceVisible />
    </LandingContentCanvas>
  );
}
