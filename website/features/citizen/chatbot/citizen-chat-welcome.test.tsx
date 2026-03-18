import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenChatWelcome from "./components/citizen-chat-welcome";

describe("CitizenChatWelcome", () => {
  it("uses compact example query actions and forwards click values", () => {
    const onUseExample = vi.fn();
    const firstExample = "What is the total budget for FY 2025?";

    render(
      <CitizenChatWelcome
        examples={[firstExample, "List infrastructure projects in my barangay."]}
        onUseExample={onUseExample}
      />
    );

    expect(screen.queryByText(/^OpenAIP AI Assistant$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: firstExample }));
    expect(onUseExample).toHaveBeenCalledWith(firstExample);
  });
});
