import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CitizenChatSessionItem from "./components/citizen-chat-session-item";

const mockUseFinePointer = vi.fn(() => true);

vi.mock("@/lib/ui/use-fine-pointer", () => ({
  useFinePointer: () => mockUseFinePointer(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
      }}
    >
      {children}
    </button>
  ),
}));

describe("CitizenChatSessionItem", () => {
  beforeEach(() => {
    mockUseFinePointer.mockReturnValue(true);
  });

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

  it("uses hover/focus classes for inline actions on fine pointers", () => {
    render(
      <CitizenChatSessionItem
        session={{
          id: "session-1",
          title: "Old Title",
          timeLabel: "10:40 AM",
          isActive: false,
        }}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByTestId("session-actions-inline-session-1")).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100"
    );
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

  it("uses a meatballs menu on touch pointers", async () => {
    mockUseFinePointer.mockReturnValue(false);

    render(
      <CitizenChatSessionItem
        session={{
          id: "session-3",
          title: "Menu Session",
          timeLabel: "11:10 AM",
          isActive: true,
        }}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByTestId("session-actions-inline-session-3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /session actions for menu session/i }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Menu Session")).toBeInTheDocument();
    });
  });
});
