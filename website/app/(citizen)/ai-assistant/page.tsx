import { Suspense } from "react";
import { CitizenChatbotView } from "@/features/citizen/chatbot";

const CitizenAiAssistantPage = async () => {
  return (
    <div className="h-full min-h-0">
      <Suspense
        fallback={
          <div className="space-y-4 p-3 sm:p-5" role="status" aria-live="polite" aria-busy="true">
            <div className="h-10 w-56 animate-pulse rounded-full bg-slate-200" />
            <div className="h-[60dvh] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="space-y-3">
                <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
                <div className="h-4 w-5/6 animate-pulse rounded-full bg-slate-100" />
                <div className="h-4 w-3/4 animate-pulse rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
        }
      >
        <CitizenChatbotView />
      </Suspense>
    </div>
  );
};

export default CitizenAiAssistantPage;
