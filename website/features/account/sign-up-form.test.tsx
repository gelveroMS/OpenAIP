import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "@/components/sign-up-form";

const mockPush = vi.fn();
const mockSignUp = vi.fn();
const mockVerifyOfficialInviteEligibilityAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("next/link", () => ({
  default: (props: { children: ReactNode; href: string }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  }),
}));

vi.mock("@/lib/actions/signup.actions", () => ({
  verifyOfficialInviteEligibilityAction: (...args: unknown[]) =>
    mockVerifyOfficialInviteEligibilityAction(...args),
}));

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockVerifyOfficialInviteEligibilityAction.mockResolvedValue({
      ok: true,
      fullName: "Test User",
      locale: "test-locale",
      message: "",
    });
    mockSignUp.mockResolvedValue({
      data: {
        user: {
          identities: [{}],
        },
      },
      error: null,
    });
  });

  it("enforces realtime password policy and matching confirmation before submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        passwordPolicy: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialCharacters: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignUpForm role="admin" baseURL="http://localhost:3000" />);

    const emailInput = screen.getByLabelText("Email");
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    const repeatPasswordInput = screen.getByLabelText("Repeat Password") as HTMLInputElement;
    const submitButton = screen.getByRole("button", { name: "Sign up" });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/password-policy",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    expect(passwordInput.type).toBe("password");
    expect(repeatPasswordInput.type).toBe("password");

    const passwordToggle = passwordInput.parentElement?.querySelector("button");
    const repeatPasswordToggle = repeatPasswordInput.parentElement?.querySelector("button");
    if (!(passwordToggle instanceof HTMLButtonElement) || !(repeatPasswordToggle instanceof HTMLButtonElement)) {
      throw new Error("Expected password toggle buttons to be rendered.");
    }

    fireEvent.click(passwordToggle);
    expect(passwordInput.type).toBe("text");
    expect(repeatPasswordInput.type).toBe("password");

    fireEvent.click(repeatPasswordToggle);
    expect(passwordInput.type).toBe("text");
    expect(repeatPasswordInput.type).toBe("text");

    fireEvent.click(passwordToggle);
    fireEvent.click(repeatPasswordToggle);
    expect(passwordInput.type).toBe("password");
    expect(repeatPasswordInput.type).toBe("password");

    fireEvent.change(emailInput, { target: { value: "admin@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "weakpass" } });
    fireEvent.change(repeatPasswordInput, { target: { value: "weakpass" } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: "ValidPassword123!" } });
    fireEvent.change(repeatPasswordInput, { target: { value: "ValidPassword123!" } });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "admin@example.com",
          password: "ValidPassword123!",
        })
      );
    });
    expect(mockPush).toHaveBeenCalledWith("http://localhost:3000/admin/sign-up-success");
  });
});
