import Image from "next/image";
import type { LguOverviewVM } from "@/lib/domain/landing-content";
import FullScreenSection from "../../components/layout/full-screen-section";
import LguBudgetOverviewMotion from "./lgu-budget-overview-motion.client";

type LguBudgetOverviewSectionProps = {
  vm: LguOverviewVM;
};

const MAP_PANEL_HEIGHT_CLASS = "h-[300px] sm:h-[340px] md:h-[420px] lg:h-full";

export default function LguBudgetOverviewSection({ vm }: LguBudgetOverviewSectionProps) {
  return (
    <FullScreenSection id="lgu-budget-overview" className="relative overflow-hidden bg-[#DCE6EC]">
      <div className="pointer-events-none absolute inset-0">
        <Image
          src="/citizen-dashboard/school.png"
          alt=""
          fill
          sizes="10vw"
          className="object-cover object-center opacity-95"
        />
        <div className="absolute inset-0 bg-[#DCE6EC]/80" />
      </div>

      <LguBudgetOverviewMotion vm={vm} mapPanelHeightClass={MAP_PANEL_HEIGHT_CLASS} />
    </FullScreenSection>
  );
}
