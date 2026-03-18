import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChatThreadPanel from "./ChatThreadPanel";

describe("ChatThreadPanel mobile composer", () => {
  it("renders a sticky composer container for mobile layouts", () => {
    render(
      <ChatThreadPanel
        title="New Chat"
        messages={[]}
        messageInput=""
        onMessageChange={() => {}}
        onSend={() => {}}
        threadRef={createRef<HTMLDivElement>()}
        isSending={false}
      />
    );

    const composer = screen.getByTestId("chat-thread-composer");
    expect(composer.className).toContain("sticky");
    expect(composer.className).toContain("md:static");
  });
});
