import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FeedbackModerationTabs from "./FeedbackModerationTabs";

describe("FeedbackModerationTabs", () => {
  it("renders mobile scroll-strip class hooks", () => {
    render(<FeedbackModerationTabs value="feedback" onChange={vi.fn()} />);

    expect(screen.getByTestId("feedback-moderation-tabs-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("feedback-moderation-tabs-list").className).toContain("min-w-max");
  });

  it("keeps tab switching behavior and long-label nowrap", () => {
    const onChange = vi.fn();
    render(<FeedbackModerationTabs value="feedback" onChange={onChange} />);

    const updatesTab = screen.getByRole("tab", { name: "Projects Updates & Media" });
    expect(updatesTab.className).toContain("whitespace-nowrap");

    fireEvent.mouseDown(updatesTab);
    fireEvent.click(updatesTab);

    expect(onChange).toHaveBeenCalledWith("updates");
  });
});
