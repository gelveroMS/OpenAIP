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
  const lastMessageSignature = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return "none";
    return `${lastMessage.id}:${lastMessage.content.length}`;
  }, [messages]);

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollContainerRef.current;
    if (!node) return;
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior });
    } else {
      node.scrollTop = node.scrollHeight;
    }
    setShowJumpToLatest(false);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  useEffect(() => {
    if (!scrollContainerRef.current) return;

    const sessionChanged = previousSessionIdRef.current !== activeSession?.id;
    previousSessionIdRef.current = activeSession?.id ?? null;

    if (sessionChanged || lastMessageSignature !== "none" || isSending) {
      scrollToBottom(sessionChanged ? "auto" : "smooth");
      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    }
  }, [activeSession?.id, isSending, lastMessageSignature, scrollToBottom]);

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
