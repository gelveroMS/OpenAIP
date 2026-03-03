import { render, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionTimeoutGuard from "@/components/security/session-timeout-guard";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{props.children}</button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe("SessionTimeoutGuard route scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send heartbeat on public routes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionTimeoutGuard />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends heartbeat on protected admin routes", async () => {
    mockPathname = "/admin";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        timeoutMs: 1_800_000,
        warningMs: 300_000,
        lastActivityAtMs: Date.now(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionTimeoutGuard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/session/activity",
        expect.objectContaining({
          method: "POST",
          cache: "no-store",
        })
      );
    });
  });
});
