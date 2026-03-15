import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountTabs from "./account-tabs";

describe("AccountTabs", () => {
  it("renders mobile scroll-strip class hooks", () => {
    render(<AccountTabs value="officials" onChange={vi.fn()} />);

    expect(screen.getByTestId("account-tabs-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("account-tabs-list").className).toContain("min-w-max");
  });

  it("keeps tab switching behavior", () => {
    const onChange = vi.fn();
    render(<AccountTabs value="officials" onChange={onChange} />);

    const citizensTab = screen.getByRole("tab", { name: "Citizens" });
    fireEvent.mouseDown(citizensTab);
    fireEvent.click(citizensTab);

    expect(onChange).toHaveBeenCalledWith("citizens");
  });
});
