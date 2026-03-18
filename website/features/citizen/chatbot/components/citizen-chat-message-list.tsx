import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import CitizenChatLoadingMessage from "./citizen-chat-loading-message";
import CitizenChatMessageBubble from "./citizen-chat-message-bubble";
import CitizenChatWelcome from "./citizen-chat-welcome";
import type { CitizenChatMessageVM } from "../types/citizen-chatbot.types";

export default function CitizenChatMessageList({
  messages,
  isSending,
  exampleQueries,
  onUseExample,
  onUseFollowUp,
  onScroll,
  onJumpToLatest,
  scrollContainerRef,
  showJumpToLatest = false,
  threadRef,
}: {
  messages: CitizenChatMessageVM[];
  isSending: boolean;
  exampleQueries: readonly string[];
  onUseExample: (value: string) => void;
  onUseFollowUp: (value: string) => void;
  onScroll?: () => void;
  onJumpToLatest?: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  showJumpToLatest?: boolean;
  threadRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollContainerRef}
      data-chat-thread-scroll-container
      className="min-h-0 flex-1 overflow-y-auto bg-inherit px-3 py-2 sm:px-5 sm:py-4"
      onScroll={onScroll}
    >
      <div className="space-y-3 pb-20 sm:space-y-4 sm:pb-24">
        {!messages.length ? (
          <CitizenChatWelcome examples={exampleQueries} onUseExample={onUseExample} />
        ) : (
          messages.map((message) => (
            <CitizenChatMessageBubble key={message.id} message={message} onUseFollowUp={onUseFollowUp} />
          ))
        )}

        {isSending ? <CitizenChatLoadingMessage /> : null}
        {showJumpToLatest ? (
          <div className="sticky bottom-2 z-10 flex justify-center">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-full px-3 text-xs"
              onClick={onJumpToLatest}
            >
              New messages
            </Button>
          </div>
        ) : null}

        <div ref={threadRef} />
      </div>
    </div>
  );
}
