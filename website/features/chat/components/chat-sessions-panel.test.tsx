import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatSessionsPanel from "./ChatSessionsPanel";

describe("ChatSessionsPanel", () => {
  const baseSessions = [
    {
      id: "session-1",
      title: "Budget Review",
      timeLabel: "10:00 AM",
      isActive: true,
    },
  ];

  it("renders conversation title and time", () => {
    render(
      <ChatSessionsPanel
        sessions={baseSessions}
        query=""
        onQueryChange={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
      />
    );

    expect(screen.getByText("Budget Review")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("renames a conversation with Enter", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatSessionsPanel
        sessions={baseSessions}
        query=""
        onQueryChange={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onRename={onRename}
        onDelete={async () => {}}
      />
    );

    fireEvent.doubleClick(screen.getByText("Budget Review"));
    const input = screen.getByDisplayValue("Budget Review");
    fireEvent.change(input, { target: { value: "Road Projects 2026" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("session-1", "Road Projects 2026");
    });
  });

  it("deletes a conversation after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatSessionsPanel
        sessions={baseSessions}
        query=""
        onQueryChange={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onRename={async () => {}}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete budget review/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("session-1");
    });
  });

  it("opens inline rename from the rename icon", async () => {
    render(
      <ChatSessionsPanel
        sessions={baseSessions}
        query=""
        onQueryChange={() => {}}
        onSelect={() => {}}
        onNewChat={() => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /rename budget review/i }));
    expect(screen.getByDisplayValue("Budget Review")).toBeInTheDocument();
  });
});
