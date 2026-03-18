"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import ChatSessionsPanel from "../components/ChatSessionsPanel";
import ChatThreadPanel from "../components/ChatThreadPanel";
import { useLguChatbot } from "../hooks/use-lgu-chatbot";

export default function LguChatbotView({
  routePrefix = "/api/barangay/chat",
}: {
  routePrefix?: string;
} = {}) {
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const {
    activeSessionId,
    query,
    messageInput,
    isSessionsLoading,
    isMessagesLoading,
    isSending,
    error,
    sessionListItems,
    activeSession,
    bubbles,
    setQuery,
    setMessageInput,
    handleSelect,
    handleNewChat,
    handleSend,
    handleRenameSession,
    handleDeleteSession,
  } = useLguChatbot(routePrefix);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(null);

  const isNearBottom = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return true;
    const threshold = 96;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
  }, []);

  const handleThreadScroll = useCallback(() => {
    if (isNearBottom()) {
      setShowJumpToLatest(false);
    }
  }, [isNearBottom]);

  const handleJumpToLatest = useCallback(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    if (!threadRef.current) return;

    const sessionChanged = previousSessionIdRef.current !== activeSessionId;
    previousSessionIdRef.current = activeSessionId;

    if (sessionChanged || isNearBottom()) {
      threadRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      setShowJumpToLatest(false);
      return;
    }

    if (bubbles.length > 0 || isSending) {
      setShowJumpToLatest(true);
    }
  }, [activeSessionId, bubbles.length, isNearBottom, isSending]);

  const resolvedActiveTitle = activeSession ? activeSession.title ?? "New Chat" : "New Chat";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden text-[13.5px] md:gap-6">
      <div className="space-y-2 shrink-0">
        <div className="flex items-center gap-2 md:hidden">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg px-3"
            onClick={() => setMobileSessionsOpen(true)}
            aria-label="Open conversations"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <h1 className="truncate text-[32px] leading-none font-semibold">Chatbot</h1>
        </div>
        <h1 className="hidden text-[28px] font-semibold md:block">Chatbot</h1>
        <p className="text-muted-foreground text-[14px]">
          Ask questions and get guided assistance related to the Annual Investment Program,
          projects, and compliance workflows.
        </p>
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs md:hidden">
          <span className="text-foreground shrink-0 font-semibold">Active:</span>
          <span className="truncate">{resolvedActiveTitle}</span>
        </div>
      </div>

      <Sheet open={mobileSessionsOpen} onOpenChange={setMobileSessionsOpen}>
        <SheetContent
          side="left"
          className="w-[min(92vw,22rem)] max-w-[92vw] gap-0 p-0"
        >
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">
            View and manage chatbot conversations.
          </SheetDescription>
          <div data-testid="lgu-chat-sessions-drawer" className="h-full min-h-0">
            <ChatSessionsPanel
              compact
              isLoading={isSessionsLoading}
              sessions={sessionListItems}
              query={query}
              onQueryChange={setQuery}
              onSelect={(id) => {
                handleSelect(id);
                setMobileSessionsOpen(false);
              }}
              onNewChat={() => {
                handleNewChat();
                setMobileSessionsOpen(false);
              }}
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="grid h-full min-h-0 min-w-0 flex-1 gap-4 overflow-hidden md:gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div
          data-testid="lgu-chat-sessions-desktop"
          className="hidden h-full min-h-0 overflow-hidden md:block"
        >
          <ChatSessionsPanel
            isLoading={isSessionsLoading}
            sessions={sessionListItems}
            query={query}
            onQueryChange={setQuery}
            onSelect={handleSelect}
            onNewChat={handleNewChat}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
          />
        </div>

        <div className="h-full min-h-0 min-w-0 overflow-hidden">
          <ChatThreadPanel
            title={resolvedActiveTitle}
            messages={bubbles}
            messageInput={messageInput}
            onMessageChange={setMessageInput}
            onSend={handleSend}
            onThreadScroll={handleThreadScroll}
            onJumpToLatest={handleJumpToLatest}
            threadRef={threadRef}
            scrollContainerRef={scrollContainerRef}
            isMessagesLoading={isMessagesLoading}
            showJumpToLatest={showJumpToLatest}
            isSending={isSending}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
