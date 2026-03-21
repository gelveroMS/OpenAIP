import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePasswordForm } from "@/features/account/update-password-form";

const mockPush = vi.fn();
const mockGetSession = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockSetSession = vi.fn();
const MISSING_SESSION_MESSAGE =
  "Your reset session is missing or expired. Reopen the latest invite/reset link from your email.";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  }),
}));

describe("UpdatePasswordForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: { user: { id: "user-1" } },
      },
    });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockSetSession.mockResolvedValue({ error: null });
  });

  it("accepts token_hash invite/recovery links on update-password route", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState(
      null,
      "",
      "/city/update-password?token_hash=abc123&type=invite"
    );

    render(<UpdatePasswordForm role="city" baseURL="http://localhost:3000" />);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: "abc123",
        type: "invite",
      });
    });
    expect(window.location.search).toBe("");
  });

  it("prefers invite hash tokens over any existing browser session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState(
      null,
      "",
      "/city/update-password#access_token=invite_access&refresh_token=invite_refresh"
    );

    render(<UpdatePasswordForm role="city" baseURL="http://localhost:3000" />);

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "invite_access",
        refresh_token: "invite_refresh",
      });
    });
    expect(window.location.hash).toBe("");
  });

  it("suppresses PKCE exchange warnings when code exists but session is already active", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "PKCE code verifier not found in storage." },
    });

    window.history.pushState(null, "", "/city/update-password?code=stale-code");

    render(<UpdatePasswordForm role="city" baseURL="http://localhost:3000" />);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/PKCE code verifier/i)).not.toBeInTheDocument();
  });

  it("shows a user-friendly message when session bootstrap fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
    });
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "PKCE code verifier not found in storage." },
    });

    window.history.pushState(null, "", "/city/update-password?code=broken-code");

    render(<UpdatePasswordForm role="city" baseURL="http://localhost:3000" />);

    await waitFor(() => {
      expect(screen.getByText(MISSING_SESSION_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.queryByText(/PKCE code verifier/i)).not.toBeInTheDocument();
  });

  it("toggles visibility for new and confirm password fields independently", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdatePasswordForm role="citizen" baseURL="http://localhost:3000" />);

    const passwordInput = screen.getByLabelText("New password") as HTMLInputElement;
    const confirmPasswordInput = screen.getByLabelText("Confirm new password") as HTMLInputElement;

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/password-policy",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    expect(passwordInput.type).toBe("password");
    expect(confirmPasswordInput.type).toBe("password");

    const passwordToggle = passwordInput.parentElement?.querySelector("button");
    const confirmPasswordToggle = confirmPasswordInput.parentElement?.querySelector("button");
    if (
      !(passwordToggle instanceof HTMLButtonElement) ||
      !(confirmPasswordToggle instanceof HTMLButtonElement)
    ) {
      throw new Error("Expected password toggle buttons to be rendered.");
    }

    fireEvent.click(passwordToggle);
    expect(passwordInput.type).toBe("text");
    expect(confirmPasswordInput.type).toBe("password");

    fireEvent.click(confirmPasswordToggle);
    expect(passwordInput.type).toBe("text");
    expect(confirmPasswordInput.type).toBe("text");

    fireEvent.click(passwordToggle);
    fireEvent.click(confirmPasswordToggle);
    expect(passwordInput.type).toBe("password");
    expect(confirmPasswordInput.type).toBe("password");
  });

  it("blocks submit until policy and confirm-password requirements are satisfied", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      if (url === "/auth/update-password") {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdatePasswordForm role="citizen" baseURL="http://localhost:3000" />);

    const passwordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");
    const submitButton = screen.getByRole("button", { name: "Save new password" });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/password-policy",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    expect(submitButton).toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: "weakpass" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "weakpass" } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: "ValidPassword123!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "ValidPassword123!" } });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/update-password",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("falls back to server validation when policy fetch fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
          ok: false,
          json: async () => ({ ok: false }),
        };
      }
      if (url === "/auth/update-password") {
        return {
          ok: false,
          json: async () => ({ ok: false, error: { message: "Server rejected password." } }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdatePasswordForm role="citizen" baseURL="http://localhost:3000" />);

    const passwordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");
    const submitButton = screen.getByRole("button", { name: "Save new password" });

    fireEvent.change(passwordInput, { target: { value: "weak" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "weak" } });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/update-password",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByText("Server rejected password.")).toBeInTheDocument();
  });

  it("treats non-JSON successful responses as failure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/password-policy") {
        return {
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
        };
      }
      if (url === "/auth/update-password") {
        return {
          ok: true,
          json: async () => {
            throw new Error("Invalid JSON");
          },
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdatePasswordForm role="city" baseURL="http://localhost:3000" />);

    const passwordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");
    const submitButton = screen.getByRole("button", { name: "Save new password" });

    fireEvent.change(passwordInput, { target: { value: "ValidPassword123!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "ValidPassword123!" } });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Unable to update password.")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
