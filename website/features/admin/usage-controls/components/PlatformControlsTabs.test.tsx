import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlatformControlsTabs from "./PlatformControlsTabs";

describe("PlatformControlsTabs", () => {
  it("renders mobile scroll-strip class hooks", () => {
    render(<PlatformControlsTabs activeTab="feedback" onTabChange={vi.fn()} />);

    expect(screen.getByTestId("platform-controls-tabs-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("platform-controls-tabs-list").className).toContain("min-w-max");
  });

  it("keeps tab switching behavior", () => {
    const onTabChange = vi.fn();
    render(<PlatformControlsTabs activeTab="feedback" onTabChange={onTabChange} />);

    const chatbotTab = screen.getByRole("tab", { name: "Chatbot Control" });
    fireEvent.mouseDown(chatbotTab);
    fireEvent.click(chatbotTab);

    expect(onTabChange).toHaveBeenCalledWith("chatbot");
  });
});
