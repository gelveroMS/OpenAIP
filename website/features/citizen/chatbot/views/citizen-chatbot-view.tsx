"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CitizenChatShell from "../components/citizen-chat-shell";
import { useCitizenChatbot } from "../hooks/use-citizen-chatbot";

export default function CitizenChatbotView() {
  const {
    activeSession,
    canManageConversations,
    composerMode,
    composerPlaceholder,
    errorMessage,
    errorState,
    exampleQueries,
    isBootstrapping,
    isComposerDisabled,
    isSending,
    messageInput,
    messages,
    query,
    sessionItems,
    setMessageInput,
    setQuery,
    handleComposerPrimaryAction,
    handleDeleteSession,
    handleNewChat,
    handleRenameSession,
    handleSelectSession,
    handleSend,
    handleUseExample,
    handleUseFollowUp,
  } = useCitizenChatbot();

  const threadRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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

    const sessionChanged = previousSessionIdRef.current !== activeSession?.id;
    previousSessionIdRef.current = activeSession?.id ?? null;

    if (sessionChanged || isNearBottom()) {
      threadRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      setShowJumpToLatest(false);
      return;
    }

    if (messages.length > 0 || isSending) {
      setShowJumpToLatest(true);
    }
  }, [activeSession?.id, isNearBottom, isSending, messages.length]);

  const stableExamples = useMemo(() => exampleQueries, [exampleQueries]);

  return (
    <CitizenChatShell
      activeContext={activeSession?.context ?? {}}
      canManageConversations={canManageConversations}
      composerMode={composerMode}
      composerPlaceholder={composerPlaceholder}
      errorMessage={errorMessage}
      errorState={errorState}
      exampleQueries={stableExamples}
      isBootstrapping={isBootstrapping}
      isComposerDisabled={isComposerDisabled}
      isSending={isSending}
      messageInput={messageInput}
      messages={messages}
      query={query}
      sessionItems={sessionItems}
      threadRef={threadRef}
      scrollContainerRef={scrollContainerRef}
      showJumpToLatest={showJumpToLatest}
      onThreadScroll={handleThreadScroll}
      onJumpToLatest={handleJumpToLatest}
      onComposerPrimaryAction={handleComposerPrimaryAction}
      onDeleteSession={handleDeleteSession}
      onMessageInputChange={setMessageInput}
      onNewChat={handleNewChat}
      onQueryChange={setQuery}
      onRenameSession={handleRenameSession}
      onSelectSession={handleSelectSession}
      onSend={handleSend}
      onUseExample={handleUseExample}
      onUseFollowUp={handleUseFollowUp}
    />
  );
}
