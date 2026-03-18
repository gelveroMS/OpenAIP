"use client";

import { FileSearch } from "lucide-react";

export default function ChatAssistantLoadingState() {
  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-[90%] rounded-xl bg-[#E8ECEF] px-4 py-3 text-[#1E3A4A] shadow-sm sm:max-w-[280px]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#D9E7ED] text-[#0E7490]">
            <FileSearch className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold leading-tight tracking-tight">
            Searching AIP documents...
          </p>
        </div>

        <div className="mt-3 h-1 w-full rounded-full bg-[#D0D8DE]">
          <div className="h-full w-[92%] animate-pulse rounded-full bg-[#0E7490]" />
        </div>

        <div className="mt-3 flex items-center gap-2.5 text-[#7A8791]">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#9AA6AF]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#9AA6AF] [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#9AA6AF] [animation-delay:240ms]" />
          </div>
          <span className="text-[11px] font-medium">OpenAIP AI Assistant</span>
        </div>
      </div>
    </div>
  );
}
