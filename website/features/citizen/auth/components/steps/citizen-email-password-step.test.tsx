import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import CitizenEmailPasswordStep from "@/features/citizen/auth/components/steps/citizen-email-password-step";
import type { PasswordPolicyRuleStatus } from "@/lib/security/password-policy";

vi.mock("next/link", () => ({
  default: (props: { children: ReactNode; href: string }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

const signupRules: PasswordPolicyRuleStatus[] = [
  {
    id: "min_length",
    label: "At least 12 characters",
    errorMessage: "Password must be at least 12 characters.",
    passed: false,
  },
];

describe("CitizenEmailPasswordStep", () => {
  it("shows policy checklist in signup mode, keeps mode switch mobile-only, and blocks submit when disabled", () => {
    const onSubmit = vi.fn();
    render(
      <CitizenEmailPasswordStep
        titleId="title"
        descriptionId="description"
        mode="signup"
        email="citizen@example.com"
        password="weak"
        policyRules={signupRules}
        errorMessage={null}
        isLoading={false}
        disableSubmit={true}
        onEmailChange={vi.fn()}
        onPasswordChange={vi.fn()}
        onSubmit={onSubmit}
        onToggleMode={vi.fn()}
      />
    );

    expect(screen.getByText("At least 12 characters")).toBeInTheDocument();
    const submitButton = screen.getByRole("button", { name: "Create account" });
    expect(submitButton).toBeDisabled();
    const modeSwitchText = screen.getByText("Already have an account?");
    expect(modeSwitchText.closest("div")).toHaveClass("md:hidden");
    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps login mode free from signup-only checklist gating and supports show/hide password", () => {
    render(
      <CitizenEmailPasswordStep
        titleId="title"
        descriptionId="description"
        mode="login"
        email="citizen@example.com"
        password="any-password"
        policyRules={signupRules}
        errorMessage={null}
        isLoading={false}
        disableSubmit={false}
        onEmailChange={vi.fn()}
        onPasswordChange={vi.fn()}
        onSubmit={vi.fn()}
        onToggleMode={vi.fn()}
      />
    );

    expect(screen.queryByText("At least 12 characters")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();

    const passwordInput = screen.getByTestId("citizen-auth-password-input") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordInput.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput.type).toBe("password");
  });
});
