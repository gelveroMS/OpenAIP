import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenChatSessionItem from "./components/citizen-chat-session-item";

describe("CitizenChatSessionItem", () => {
  it("renames a conversation inline on Enter", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(
      <CitizenChatSessionItem
        session={{
          id: "session-1",
          title: "Old Title",
          timeLabel: "10:40 AM",
          isActive: false,
        }}
        onSelect={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText("10:40 AM")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /rename old title/i }));
    const input = screen.getByDisplayValue("Old Title");
    fireEvent.change(input, { target: { value: "Road Works 2026" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("session-1", "Road Works 2026");
    });
  });

  it("deletes a conversation after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <CitizenChatSessionItem
        session={{
          id: "session-2",
          title: "To Delete",
          timeLabel: "11:10 AM",
          isActive: true,
        }}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete to delete/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("session-2");
    });
  });
});
