"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type FeedbackModerationTab = "feedback" | "updates";

export default function FeedbackModerationTabs({
  value,
  onChange,
}: {
  value: FeedbackModerationTab;
  onChange: (tab: FeedbackModerationTab) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as FeedbackModerationTab)}>
      <div className="w-full overflow-x-auto whitespace-nowrap" data-testid="feedback-moderation-tabs-scroll">
        <TabsList
          className="h-12 min-w-max w-max justify-start gap-2 rounded-none border-b border-slate-200 bg-transparent p-0 md:w-full md:gap-6"
          data-testid="feedback-moderation-tabs-list"
        >
          <TabsTrigger
            value="feedback"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-[15px] font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            Feedback
          </TabsTrigger>
          <TabsTrigger
            value="updates"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-[15px] font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            Projects Updates & Media
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
}

