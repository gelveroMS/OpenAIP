import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePasswordForm } from "@/features/account/update-password-form";

const mockPush = vi.fn();
const mockGetSession = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockSetSession = vi.fn();

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
    mockSetSession.mockResolvedValue({ error: null });
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
});
