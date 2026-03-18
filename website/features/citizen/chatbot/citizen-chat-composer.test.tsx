import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenChatComposer from "./components/citizen-chat-composer";

describe("CitizenChatComposer", () => {
  it("shows disabled input with sign-in CTA for anonymous mode", () => {
    const onPrimaryAction = vi.fn();

    render(
      <CitizenChatComposer
        mode="sign_in"
        value=""
        isSending={false}
        placeholder="Sign in to use the AI Assistant."
        disabled={false}
        onChange={vi.fn()}
        onPrimaryAction={onPrimaryAction}
      />
    );

    const textarea = screen.getByLabelText(/chat message input/i);
    expect(textarea).toBeDisabled();
    expect(screen.getByText(/sign in required to use the ai assistant/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it("keeps composer sticky and sends on Enter in send mode", () => {
    const onPrimaryAction = vi.fn();
    const { container } = render(
      <CitizenChatComposer
        mode="send"
        value="Hello"
        isSending={false}
        placeholder="Ask about budgets"
        disabled={false}
        onChange={vi.fn()}
        onPrimaryAction={onPrimaryAction}
      />
    );

    expect(container.firstChild).toHaveClass("sticky", "bottom-0");
    fireEvent.keyDown(screen.getByLabelText(/chat message input/i), {
      key: "Enter",
      shiftKey: false,
    });
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });
});
