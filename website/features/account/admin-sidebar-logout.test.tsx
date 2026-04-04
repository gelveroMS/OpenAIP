import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminSidebar from "@/components/layout/admin-sidebar";

const mockUsePathname = vi.fn();

vi.mock("next/image", () => ({
  default: () => <div data-testid="next-image" />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("AdminSidebar", () => {
  it("keeps usage controls link stable without dashboard filters", () => {
    mockUsePathname.mockReturnValue("/admin");

    render(<AdminSidebar />);

    expect(screen.getByRole("link", { name: "Usage Controls" })).toHaveAttribute(
      "href",
      "/admin/usage-controls"
    );
  });

  it("does not render a logout button in the sidebar navigation", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminSidebar />);

    expect(screen.queryByRole("button", { name: /logout/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();
  });
});
