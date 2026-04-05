import { cn } from "@/lib/ui/utils";
import type { CitizenChatMessageVM } from "../types/citizen-chatbot.types";
import CitizenChatEvidence from "./citizen-chat-evidence";

export default function CitizenChatMessageBubble({
  message,
}: {
  message: CitizenChatMessageVM;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-[#022437] text-white"
            : "bg-white text-slate-800"
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        <p className={cn("mt-2 text-[11px]", isUser ? "text-white/70" : "text-slate-500")}>{message.timeLabel}</p>

        {!isUser ? (
          <>
            <CitizenChatEvidence evidence={message.evidence} />
          </>
        ) : null}
      </div>
    </div>
  );
}
