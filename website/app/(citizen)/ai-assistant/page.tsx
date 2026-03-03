import { Suspense } from "react";
import { CitizenChatbotView } from "@/features/citizen/chatbot";
const CitizenAiAssistantPage = async () => {
  return (
    <div className="h-full min-h-0">
      <Suspense fallback={null}>
        <CitizenChatbotView />
      </Suspense>
    </div>
  );
};

export default CitizenAiAssistantPage;
