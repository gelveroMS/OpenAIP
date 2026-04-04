import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "@/components/sign-up-form";

const mockPush = vi.fn();
const mockSignUp = vi.fn();
const mockVerifyOfficialInviteEligibilityAction = vi.fn();
const PASSWORD_POLICY_RESPONSE = {
  ok: true,
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialCharacters: true,
  },
};

function stubPasswordPolicyFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => PASSWORD_POLICY_RESPONSE,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
    const fetchMock = stubPasswordPolicyFetch();

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

  it("keeps existing-account outcomes indistinguishable by redirecting to success", async () => {
    stubPasswordPolicyFetch();
    mockSignUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });

    render(<SignUpForm role="city" baseURL="http://localhost:3000" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "official@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ValidPassword123!" } });
    fireEvent.change(screen.getByLabelText("Repeat Password"), {
      target: { value: "ValidPassword123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("http://localhost:3000/city/sign-up-success");
    });
    expect(screen.queryByText(/account already exists/i)).not.toBeInTheDocument();
  });

  it("shows generic non-diagnostic error for operational failures", async () => {
    stubPasswordPolicyFetch();
    mockSignUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "database unavailable" },
    });

    render(<SignUpForm role="admin" baseURL="http://localhost:3000" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ValidPassword123!" } });
    fireEvent.change(screen.getByLabelText("Repeat Password"), {
      target: { value: "ValidPassword123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    await waitFor(() => {
      expect(
        screen.getByText("Unable to process sign-up right now. Please try again later.")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/database unavailable/i)).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
