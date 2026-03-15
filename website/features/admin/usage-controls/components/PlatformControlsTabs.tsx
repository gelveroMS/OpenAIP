"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PlatformControlsTab = "feedback" | "chatbot";

export default function PlatformControlsTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: PlatformControlsTab;
  onTabChange: (value: PlatformControlsTab) => void;
}) {
  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as PlatformControlsTab)}>
      <div className="w-full overflow-x-auto whitespace-nowrap" data-testid="platform-controls-tabs-scroll">
        <TabsList
          className="h-12 min-w-max w-max justify-start gap-2 rounded-none border-b border-slate-200 bg-transparent p-0 md:w-full md:gap-0"
          data-testid="platform-controls-tabs-list"
        >
          <TabsTrigger
            value="feedback"
            className="flex-none h-12 whitespace-nowrap rounded-none border-b-2 border-transparent px-4 text-[15px] text-slate-500 data-[state=active]:border-[#0E5D6F] data-[state=active]:text-slate-900"
          >
            Feedback Control
          </TabsTrigger>
          <TabsTrigger
            value="chatbot"
            className="flex-none h-12 whitespace-nowrap rounded-none border-b-2 border-transparent px-4 text-[15px] text-slate-500 data-[state=active]:border-[#0E5D6F] data-[state=active]:text-slate-900"
          >
            Chatbot Control
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
}
