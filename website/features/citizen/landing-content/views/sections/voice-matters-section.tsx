import { MessageCircle } from "lucide-react";
import { FeedbackCategorySummaryChart } from "@/components/chart";
import { Button } from "@/components/ui/button";
import type { FeedbackSnapshotVM } from "@/lib/domain/landing-content";
import FullScreenSection from "../../components/layout/full-screen-section";
import {
  MotionInView,
  MotionItem,
  MotionPressable,
  MotionStagger,
} from "../../components/motion/motion-primitives";

type VoiceMattersSectionProps = {
  vm: FeedbackSnapshotVM;
};

function FeedbackCategorySummaryCard({ vm }: { vm: FeedbackSnapshotVM }) {
  return (
    <div className="h-full rounded-2xl border border-white/10 bg-[#0b2f3a] px-3 py-4 sm:px-4 sm:py-5">
      <FeedbackCategorySummaryChart
        items={vm.categorySummary}
        tone="dark"
      />
    </div>
  );
}

function ResponseRateCard({ vm }: { vm: FeedbackSnapshotVM }) {
  return (
    <div className="flex min-h-[150px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0b2f3a] px-2 py-4 text-center sm:min-h-[165px] sm:py-5">
      <p className="text-2xl font-semibold leading-none text-white sm:text-3xl">Response Rate</p>
      <p className="mt-2 text-5xl font-bold leading-none text-[#05C7F2] sm:text-6xl">{vm.responseRate}%</p>
      <p className="mt-3 text-sm text-white/70">Average response time: {vm.avgResponseTimeDays} days</p>
    </div>
  );
}

function HaveAConcernCard() {
  return (
    <div id="voice-feedback" className="flex min-h-[150px] items-center rounded-2xl border border-white/10 bg-[#0b2f3a] px-3 py-4 sm:min-h-[165px] sm:px-2 sm:py-5">
      <div className="shrink-0">
        <MessageCircle className="h-14 w-16 text-white/70 sm:h-25 sm:w-33" aria-hidden="true" strokeWidth={1} />
      </div>
      <div className="space-y-3 sm:space-y-4">
        <p className="text-2xl font-semibold leading-none text-white sm:text-3xl">Want to Know More?</p>
        <MotionPressable className="inline-flex">
          <Button
            asChild
            className="h-9 rounded-xl bg-[#05C7F2] px-5 text-sm font-semibold text-[#001925] hover:bg-[#22d3ee]/90 focus-visible:ring-2 focus-visible:ring-[#67E8F9] sm:h-10 sm:px-6 sm:text-base"
          >
            <a href="/about-us" aria-label="See About Us">
              See About Us
            </a>
          </Button>
        </MotionPressable>
      </div>
    </div>
  );
}

export default function VoiceMattersSection({ vm }: VoiceMattersSectionProps) {
  const title = vm.title || "Your Voice Matters.";
  const subtitle =
    vm.subtitle ||
    "Track feedback trends and response performance to ensure continued accountability.";

  return (
    <FullScreenSection id="voice-matters" className="bg-[#EDF1F4]">
      <div className="mx-auto w-full max-w-6xl space-y-5 md:space-y-8">
        <header className="text-center">
          <MotionStagger className="space-y-3 md:space-y-4" delayChildren={0.04}>
            <MotionItem>
              <h2 className="break-words text-[clamp(2.35rem,13vw,4.4rem)] font-bold text-darkslategray text-[#0C2C3A] md:text-6xl">{title}</h2>
            </MotionItem>
            <MotionItem variant="fadeIn">
              <p className="mx-auto max-w-3xl text-sm text-slate-600 md:text-base">{subtitle}</p>
            </MotionItem>
          </MotionStagger>
        </header>

        <div className="grid grid-cols-12 items-stretch gap-4 md:gap-8">
          <div className="col-span-12 h-full lg:col-span-7">
            <MotionInView className="h-full" variant="scaleIn">
              <FeedbackCategorySummaryCard vm={vm} />
            </MotionInView>
          </div>

          <MotionStagger className="col-span-12 flex flex-col gap-4 md:gap-6 lg:col-span-5" delayChildren={0.08}>
            <MotionItem>
              <ResponseRateCard vm={vm} />
            </MotionItem>
            <MotionItem>
              <HaveAConcernCard />
            </MotionItem>
          </MotionStagger>
        </div>
      </div>
    </FullScreenSection>
  );
}
