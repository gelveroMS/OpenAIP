"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountTab } from "@/lib/repos/accounts/repo";

export default function AccountTabs({
  value,
  onChange,
}: {
  value: AccountTab;
  onChange: (tab: AccountTab) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as AccountTab)}>
      <div className="w-full overflow-x-auto whitespace-nowrap" data-testid="account-tabs-scroll">
        <TabsList
          className="h-12 min-w-max w-max justify-start gap-2 rounded-none border-b border-slate-200 bg-transparent p-0 md:w-full md:gap-6"
          data-testid="account-tabs-list"
        >
          <TabsTrigger
            value="officials"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-sm font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            Officials
          </TabsTrigger>
          <TabsTrigger
            value="citizens"
            className="flex-none h-12 whitespace-nowrap rounded-none px-4 text-sm font-medium text-slate-500 data-[state=active]:border-b-2 data-[state=active]:border-teal-700 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:shadow-none md:px-6"
          >
            Citizens
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
}
