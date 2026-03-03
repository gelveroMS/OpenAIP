import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CitizenTopNav from "@/features/citizen/components/citizen-top-nav";

const mockUseCitizenAccount = vi.fn();

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <div role="img" aria-label={String(props.alt ?? "")} />
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => ({
    toString: () => "",
  }),
}));

vi.mock("@/features/citizen/auth/hooks/use-citizen-account", () => ({
  useCitizenAccount: () => mockUseCitizenAccount(),
}));

vi.mock("@/features/citizen/components/citizen-account-modal", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="citizen-account-modal-state">{open ? "open" : "closed"}</div>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/notifications/components/notifications-bell", () => ({
  default: () => <div data-testid="notifications-bell" />,
}));

describe("CitizenTopNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Sign In when no authenticated citizen profile is available", () => {
    mockUseCitizenAccount.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      error: null,
      refresh: vi.fn(),
    });

    render(<CitizenTopNav />);

    expect(screen.getAllByText("Sign In").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Open account")).not.toBeInTheDocument();
  });

  it("does not invoke refresh on initial render", async () => {
    const refresh = vi.fn();
    mockUseCitizenAccount.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      error: null,
      refresh,
    });

    render(<CitizenTopNav />);
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows name/barangay and opens account modal when authenticated", () => {
    mockUseCitizenAccount.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      profile: {
        fullName: "Juan Dela Cruz",
        email: "juan@example.com",
        firstName: "Juan",
        lastName: "Dela Cruz",
        barangay: "Barangay Uno",
        city: "Cabuyao",
        province: "Laguna",
      },
      error: null,
      refresh: vi.fn(),
    });

    render(<CitizenTopNav />);

    expect(screen.getAllByText("Juan Dela Cruz").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Barangay Uno").length).toBeGreaterThan(0);
    expect(screen.getByTestId("citizen-account-modal-state")).toHaveTextContent("closed");

    fireEvent.click(screen.getAllByRole("button", { name: "Open account" })[0]);

    expect(screen.getByTestId("citizen-account-modal-state")).toHaveTextContent("open");
  });
});
