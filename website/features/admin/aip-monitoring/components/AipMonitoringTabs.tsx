"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AipMonitoringTab = "aips" | "cases";

export default function AipMonitoringTabs({
  value,
  onChange,
  casesCount,
}: {
  value: AipMonitoringTab;
  onChange: (tab: AipMonitoringTab) => void;
  casesCount: number;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as AipMonitoringTab)}>
      <div className="w-full overflow-x-auto whitespace-nowrap" data-testid="aip-monitoring-tabs-scroll">
        <TabsList
          className="h-12 min-w-max w-max justify-start gap-2 rounded-none border-b border-slate-200 bg-transparent p-0 md:w-full md:gap-6"
          data-testid="aip-monitoring-tabs-list"
        >
          <TabsTrigger
            value="aips"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-[15px] font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            AIPs
          </TabsTrigger>
          <TabsTrigger
            value="cases"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-[15px] font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            Cases ({casesCount})
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
}
