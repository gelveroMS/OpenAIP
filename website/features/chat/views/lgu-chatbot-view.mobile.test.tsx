import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LguChatbotView from "./lgu-chatbot-view";

const mockUseLguChatbot = vi.fn();

vi.mock("../hooks/use-lgu-chatbot", () => ({
  useLguChatbot: (...args: unknown[]) => mockUseLguChatbot(...args),
}));

describe("LguChatbotView mobile layout", () => {
  it("uses chat-first mobile layout and opens/closes the conversation drawer", async () => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true,
    });

    const handleSelect = vi.fn();
    const handleNewChat = vi.fn();
    const handleRenameSession = vi.fn().mockResolvedValue(undefined);
    const handleDeleteSession = vi.fn().mockResolvedValue(undefined);

    mockUseLguChatbot.mockReturnValue({
      activeSessionId: "session-1",
      query: "",
      messageInput: "",
      isSessionsLoading: false,
      isMessagesLoading: false,
      isSending: false,
      error: null,
      sessionListItems: [
        {
          id: "session-1",
          title: "Budget chat",
          timeLabel: "10:00 AM",
          isActive: true,
        },
      ],
      activeSession: { id: "session-1", title: "Budget chat" },
      bubbles: [],
      setQuery: vi.fn(),
      setMessageInput: vi.fn(),
      handleSelect,
      handleNewChat,
      handleSend: vi.fn(),
      handleRenameSession,
      handleDeleteSession,
    });

    render(<LguChatbotView />);

    const desktopSidebar = screen.getByTestId("lgu-chat-sessions-desktop");
    expect(desktopSidebar.className).toContain("hidden");
    expect(screen.queryByTestId("lgu-chat-sessions-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open conversations/i }));

    const drawer = await screen.findByTestId("lgu-chat-sessions-drawer");
    const drawerSessionButton = within(drawer).getByRole("button", {
      name: "Budget chat",
    });
    fireEvent.click(drawerSessionButton);

    expect(handleSelect).toHaveBeenCalledWith("session-1");
    await waitFor(() => {
      expect(screen.queryByTestId("lgu-chat-sessions-drawer")).not.toBeInTheDocument();
    });
  });
});
