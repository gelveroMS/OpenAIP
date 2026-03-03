import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminSidebar from "@/components/layout/admin-sidebar";

const mockUsePathname = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock("next/image", () => ({
  default: () => <div data-testid="next-image" />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}));

describe("AdminSidebar", () => {
  it("carries dashboard date filters into the usage controls link", () => {
    mockUsePathname.mockReturnValue("/admin");
    mockUseSearchParams.mockReturnValue(new URLSearchParams("from=2026-03-01&to=2026-03-14"));

    render(<AdminSidebar />);

    expect(screen.getByRole("link", { name: "Usage Controls" })).toHaveAttribute(
      "href",
      "/admin/usage-controls?from=2026-03-01&to=2026-03-14"
    );
  });

  it("does not render a logout button in the sidebar navigation", () => {
    mockUsePathname.mockReturnValue("/admin");
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    render(<AdminSidebar />);

    expect(screen.queryByRole("button", { name: /logout/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();
  });
});
