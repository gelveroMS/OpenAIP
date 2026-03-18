import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AipMonitoringTabs from "./AipMonitoringTabs";

describe("AipMonitoringTabs", () => {
  it("renders mobile scroll-strip class hooks", () => {
    render(<AipMonitoringTabs value="aips" onChange={vi.fn()} casesCount={8} />);

    expect(screen.getByTestId("aip-monitoring-tabs-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("aip-monitoring-tabs-list").className).toContain("min-w-max");
  });

  it("keeps tab switching behavior", () => {
    const onChange = vi.fn();
    render(<AipMonitoringTabs value="aips" onChange={onChange} casesCount={8} />);

    const casesTab = screen.getByRole("tab", { name: "Cases (8)" });
    fireEvent.mouseDown(casesTab);
    fireEvent.click(casesTab);

    expect(onChange).toHaveBeenCalledWith("cases");
  });
});
