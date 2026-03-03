import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminTopbar from "@/components/layout/admin-topbar";

vi.mock("@/features/account/AdminAccountModal", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="admin-account-modal-state">{open ? "open" : "closed"}</div>
  ),
}));

vi.mock("@/features/notifications/components/notifications-bell", () => ({
  default: () => <div data-testid="notifications-bell" />,
}));

describe("AdminTopbar account icon", () => {
  it("opens the account modal when the top-right account icon is clicked", () => {
    render(
      <AdminTopbar
        name="Admin User"
        roleLabel="System Administration"
        accountProfile={{
          fullName: "Admin User",
          email: "admin@example.com",
          role: "admin",
        }}
      />
    );

    expect(screen.getByTestId("admin-account-modal-state")).toHaveTextContent("closed");

    fireEvent.click(screen.getByRole("button", { name: "Open account" }));

    expect(screen.getByTestId("admin-account-modal-state")).toHaveTextContent("open");
  });
});
