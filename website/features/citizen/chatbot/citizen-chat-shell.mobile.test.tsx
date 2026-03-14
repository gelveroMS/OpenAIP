import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenChatShell from "./components/citizen-chat-shell";

vi.mock("./components/citizen-chat-sidebar", () => ({
  default: function MockCitizenChatSidebar({
    onSelectSession,
  }: {
    onSelectSession: (id: string) => void;
  }) {
    return (
      <div data-testid="mock-chat-sidebar">
        <button type="button" onClick={() => onSelectSession("session-1")}>
          Session One
        </button>
      </div>
    );
  },
}));

vi.mock("./components/citizen-chat-message-list", () => ({
  default: function MockCitizenChatMessageList() {
    return <div data-testid="mock-message-list">Message list</div>;
  },
}));

vi.mock("./components/citizen-chat-composer", () => ({
  default: function MockCitizenChatComposer() {
    return <div data-testid="mock-composer">Composer</div>;
  },
}));

vi.mock("./components/citizen-chat-error-state", () => ({
  default: function MockCitizenChatErrorState() {
    return <div data-testid="mock-error-state">Error state</div>;
  },
}));

describe("CitizenChatShell mobile layout", () => {
  it("uses chat-first mobile layout and opens conversation drawer from header button", async () => {
    render(
      <CitizenChatShell
        activeContext={{}}
        errorMessage={null}
        errorState="none"
        exampleQueries={["What is the total budget for FY 2025?"]}
        isBootstrapping={false}
        isComposerDisabled={false}
        composerMode="send"
        composerPlaceholder="Ask about budgets"
        isSending={false}
        messageInput=""
        messages={[]}
        canManageConversations
        query=""
        sessionItems={[]}
        threadRef={createRef<HTMLDivElement>()}
        scrollContainerRef={createRef<HTMLDivElement>()}
        showJumpToLatest={false}
        onThreadScroll={vi.fn()}
        onJumpToLatest={vi.fn()}
        onMessageInputChange={vi.fn()}
        onNewChat={vi.fn()}
        onDeleteSession={vi.fn()}
        onQueryChange={vi.fn()}
        onRenameSession={vi.fn()}
        onSelectSession={vi.fn()}
        onComposerPrimaryAction={vi.fn()}
        onSend={vi.fn()}
        onUseExample={vi.fn()}
        onUseFollowUp={vi.fn()}
      />
    );

    const desktopSidebarContainer = screen.getByTestId("chat-sidebar-desktop");
    expect(desktopSidebarContainer.className).toContain("hidden");
    expect(screen.queryByTestId("chat-sidebar-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open conversations/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar-drawer")).toBeInTheDocument();
    });
  });
});
