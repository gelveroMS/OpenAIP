import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LguTopbar from "@/components/layout/lgu-topbar";

vi.mock("@/features/account/AccountModal", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="account-modal-state">{open ? "open" : "closed"}</div>
  ),
}));

vi.mock("@/features/notifications/components/notifications-bell", () => ({
  default: () => <div data-testid="notifications-bell" />,
}));

describe("LguTopbar account icon", () => {
  it("opens the account modal when the top-right account icon is clicked", () => {
    render(
      <LguTopbar
        name="Barangay User"
        roleLabel="Barangay Official"
        accountProfile={{
          fullName: "Barangay User",
          email: "barangay@example.gov.ph",
          position: "Barangay Official",
          office: "Barangay Hall",
          role: "barangay",
        }}
      />
    );

    expect(screen.getByTestId("account-modal-state")).toHaveTextContent("closed");

    fireEvent.click(screen.getByRole("button", { name: "Open account" }));

    expect(screen.getByTestId("account-modal-state")).toHaveTextContent("open");
  });
});
