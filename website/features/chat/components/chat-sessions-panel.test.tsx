import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatSessionsPanel from "./ChatSessionsPanel";

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

describe("ChatSessionsPanel", () => {
  const baseSessions = [
    {
      id: "session-1",
      title: "Budget Review",
      timeLabel: "10:00 AM",
      isActive: true,
    },
  ];

  beforeEach(() => {
    mockUseFinePointer.mockReturnValue(true);
  });

  it("renders conversation title without session time", () => {
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
    expect(screen.queryByText("10:00 AM")).not.toBeInTheDocument();
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("uses hover/focus classes for inline actions on fine pointers", () => {
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

    expect(screen.getByTestId("session-actions-inline-session-1")).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100"
    );
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

  it("uses a meatballs menu on touch pointers", async () => {
    mockUseFinePointer.mockReturnValue(false);

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

    expect(screen.queryByTestId("session-actions-inline-session-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /session actions for budget review/i }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Budget Review")).toBeInTheDocument();
    });
  });
});
