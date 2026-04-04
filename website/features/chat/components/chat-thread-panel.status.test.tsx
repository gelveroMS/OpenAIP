import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChatThreadPanel from "./ChatThreadPanel";

describe("ChatThreadPanel status states", () => {
  it("shows analyzing state only while awaiting assistant", () => {
    render(
      <ChatThreadPanel
        title="New Chat"
        messages={[]}
        messageInput=""
        onMessageChange={() => {}}
        onSend={() => {}}
        threadRef={createRef<HTMLDivElement>()}
        isSending={false}
        isAwaitingAssistant
      />
    );

    expect(screen.getByText("Analyzing your request...")).toBeInTheDocument();
  });

  it("does not show analyzing state while only sending", () => {
    render(
      <ChatThreadPanel
        title="New Chat"
        messages={[]}
        messageInput=""
        onMessageChange={() => {}}
        onSend={() => {}}
        threadRef={createRef<HTMLDivElement>()}
        isSending
        isAwaitingAssistant={false}
      />
    );

    expect(screen.queryByText("Analyzing your request...")).not.toBeInTheDocument();
  });
});
