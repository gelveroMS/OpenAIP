"use client";

import { useState, type RefObject } from "react";
import type { Json } from "@/lib/contracts/databasev2";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type {
  CitizenChatComposerMode,
  CitizenChatErrorState as ChatErrorState,
  CitizenChatMessageVM,
  CitizenChatSessionVM,
} from "../types/citizen-chatbot.types";
import CitizenChatComposer from "./citizen-chat-composer";
import CitizenChatErrorState from "./citizen-chat-error-state";
import CitizenChatHeader from "./citizen-chat-header";
import CitizenChatMessageList from "./citizen-chat-message-list";
import CitizenChatSidebar from "./citizen-chat-sidebar";

export default function CitizenChatShell({
  activeContext,
  errorMessage,
  errorState,
  exampleQueries,
  isBootstrapping,
  isComposerDisabled,
  composerMode,
  composerPlaceholder,
  isSending,
  messageInput,
  messages,
  canManageConversations,
  query,
  sessionItems,
  threadRef,
  scrollContainerRef,
  showJumpToLatest,
  onThreadScroll,
  onJumpToLatest,
  onMessageInputChange,
  onNewChat,
  onDeleteSession,
  onQueryChange,
  onRenameSession,
  onSelectSession,
  onComposerPrimaryAction,
  onSend,
  onUseExample,
  onUseFollowUp,
}: {
  activeContext: Json;
  errorMessage: string | null;
  errorState: ChatErrorState;
  exampleQueries: readonly string[];
  isBootstrapping: boolean;
  isComposerDisabled: boolean;
  composerMode: CitizenChatComposerMode;
  composerPlaceholder: string;
  isSending: boolean;
  messageInput: string;
  messages: CitizenChatMessageVM[];
  canManageConversations: boolean;
  query: string;
  sessionItems: CitizenChatSessionVM[];
  threadRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  onThreadScroll: () => void;
  onJumpToLatest: () => void;
  onMessageInputChange: (value: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => Promise<void>;
  onQueryChange: (value: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onSelectSession: (id: string) => void;
  onComposerPrimaryAction: () => void;
  onSend: () => void;
  onUseExample: (value: string) => void;
  onUseFollowUp: (value: string) => void;
}) {
  void activeContext;
  const [isConversationsDrawerOpen, setIsConversationsDrawerOpen] = useState(false);

  const handleSelectSession = (sessionId: string) => {
    onSelectSession(sessionId);
    setIsConversationsDrawerOpen(false);
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-hidden md:h-[calc(100dvh-12rem)] md:grid-cols-[320px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Sheet open={isConversationsDrawerOpen} onOpenChange={setIsConversationsDrawerOpen}>
        <SheetContent
          side="left"
          className="w-[18rem] max-w-[88vw] gap-0 border-r-0 p-0 md:hidden"
          data-testid="chat-sidebar-drawer"
        >
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">
            Browse, search, and manage AI Assistant conversations.
          </SheetDescription>
          <CitizenChatSidebar
            canManageConversations={canManageConversations}
            query={query}
            sessions={sessionItems}
            onQueryChange={onQueryChange}
            onNewChat={onNewChat}
            onDeleteSession={onDeleteSession}
            onRenameSession={onRenameSession}
            onSelectSession={handleSelectSession}
          />
        </SheetContent>
      </Sheet>

      <div className="hidden min-h-0 md:flex" data-testid="chat-sidebar-desktop">
        <CitizenChatSidebar
          canManageConversations={canManageConversations}
          query={query}
          sessions={sessionItems}
          onQueryChange={onQueryChange}
          onNewChat={onNewChat}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onSelectSession={onSelectSession}
        />
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-transparent">
        <CitizenChatHeader onOpenConversations={() => setIsConversationsDrawerOpen(true)} />

        {isBootstrapping ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 sm:px-6">
            <p className="text-sm text-slate-500">Loading your conversations...</p>
          </div>
        ) : (
          <>
            {errorState !== "none" ? (
              <div className="bg-inherit px-3 pt-2 sm:px-6 sm:pt-4">
                <CitizenChatErrorState state={errorState} message={errorMessage} onRetry={onSend} />
              </div>
            ) : null}

            <CitizenChatMessageList
              messages={messages}
              isSending={isSending}
              exampleQueries={exampleQueries}
              onUseExample={onUseExample}
              onUseFollowUp={onUseFollowUp}
              onScroll={onThreadScroll}
              onJumpToLatest={onJumpToLatest}
              scrollContainerRef={scrollContainerRef}
              showJumpToLatest={showJumpToLatest}
              threadRef={threadRef}
            />
          </>
        )}

        <CitizenChatComposer
          mode={composerMode}
          value={messageInput}
          isSending={isSending}
          placeholder={composerPlaceholder}
          onChange={onMessageInputChange}
          onPrimaryAction={onComposerPrimaryAction}
          disabled={isComposerDisabled}
        />
      </div>
    </section>
  );
}
