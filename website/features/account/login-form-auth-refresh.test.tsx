import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
    push: mockPush,
  }),
}));

vi.mock("next/image", () => ({
  default: () => <div data-testid="next-image" />,
}));

vi.mock("next/link", () => ({
  default: (props: { children: ReactNode; href: string }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

describe("LoginForm auth navigation refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refreshes router after successful admin sign-in", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, role: "admin" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm role="admin" baseURL="http://localhost:3000" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@email.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/staff-sign-in",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/admin");
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not refresh router when sign-in fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: { message: "Role Validation Failed." } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm role="admin" baseURL="http://localhost:3000" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@email.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Role Validation Failed.");
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
