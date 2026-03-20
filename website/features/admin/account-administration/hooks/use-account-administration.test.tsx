import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountListResult,
  AccountRecord,
  CreateOfficialAccountInput,
} from "@/lib/repos/accounts/repo";
import { useAccountAdministration } from "./use-account-administration";

const mockListAccountsAction = vi.fn();
const mockCreateOfficialAccountAction = vi.fn();
const mockUpdateAccountAction = vi.fn();
const mockSetAccountStatusAction = vi.fn();
const mockDeleteAccountAction = vi.fn();
const mockResetAccountPasswordAction = vi.fn();
const mockResendInviteAction = vi.fn();

vi.mock("../actions/account-administration.actions", () => ({
  listAccountsAction: (...args: unknown[]) => mockListAccountsAction(...args),
  createOfficialAccountAction: (...args: unknown[]) =>
    mockCreateOfficialAccountAction(...args),
  updateAccountAction: (...args: unknown[]) => mockUpdateAccountAction(...args),
  setAccountStatusAction: (...args: unknown[]) => mockSetAccountStatusAction(...args),
  deleteAccountAction: (...args: unknown[]) => mockDeleteAccountAction(...args),
  resetAccountPasswordAction: (...args: unknown[]) =>
    mockResetAccountPasswordAction(...args),
  resendInviteAction: (...args: unknown[]) => mockResendInviteAction(...args),
}));

const account: AccountRecord = {
  id: "acct-1",
  tab: "officials",
  fullName: "Sample Official",
  email: "official@example.gov.ph",
  role: "barangay_official",
  status: "active",
  isActive: true,
  lguScopeType: "barangay",
  lguScopeId: "brgy-1",
  lguAssignment: "Barangay: Sample",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  lastLoginAt: null,
  invitedAt: null,
  emailConfirmedAt: null,
  invitationPending: false,
  canResendInvite: false,
};

const listResult: AccountListResult = {
  rows: [account],
  total: 1,
  page: 1,
  pageSize: 10,
  roleOptions: ["admin", "barangay_official", "city_official", "municipal_official"],
  lguOptions: [
    {
      key: "barangay:brgy-1",
      scopeType: "barangay",
      id: "brgy-1",
      label: "Barangay: Sample",
      isActive: true,
    },
  ],
};

const createInput: CreateOfficialAccountInput = {
  fullName: "New Official",
  email: "new.official@example.gov.ph",
  role: "barangay_official",
  scopeType: "barangay",
  scopeId: "brgy-1",
};

async function waitForInitialLoad(result: { current: ReturnType<typeof useAccountAdministration> }) {
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
}

describe("useAccountAdministration mutation error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAccountsAction.mockResolvedValue(listResult);
    mockCreateOfficialAccountAction.mockResolvedValue(account);
    mockUpdateAccountAction.mockResolvedValue(account);
    mockSetAccountStatusAction.mockResolvedValue(account);
    mockDeleteAccountAction.mockResolvedValue(undefined);
    mockResetAccountPasswordAction.mockResolvedValue(undefined);
    mockResendInviteAction.mockResolvedValue(undefined);
  });

  it("keeps create modal open and sets mutationError when create fails", async () => {
    mockCreateOfficialAccountAction.mockRejectedValueOnce(
      new Error("An account with this email already exists.")
    );

    const { result } = renderHook(() => useAccountAdministration());
    await waitForInitialLoad(result);

    act(() => {
      result.current.openFor("", "create");
    });

    await act(async () => {
      await result.current.createOfficial(createInput);
    });

    expect(result.current.openModal).toBe("create");
    expect(result.current.mutationError).toBe(
      "An account with this email already exists."
    );
    expect(result.current.notice).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("uses operation-specific fallback copy for delete failures", async () => {
    mockDeleteAccountAction.mockRejectedValueOnce("boom");

    const { result } = renderHook(() => useAccountAdministration());
    await waitForInitialLoad(result);

    act(() => {
      result.current.openFor(account.id, "delete");
    });

    await act(async () => {
      await result.current.deleteSelected();
    });

    expect(result.current.openModal).toBe("delete");
    expect(result.current.mutationError).toBe("Failed to delete account.");
    expect(result.current.notice).toBeNull();
  });

  it("clears mutationError on retry success and when modal opens/closes", async () => {
    mockCreateOfficialAccountAction
      .mockRejectedValueOnce(new Error("Transient failure."))
      .mockResolvedValueOnce(account);

    const { result } = renderHook(() => useAccountAdministration());
    await waitForInitialLoad(result);

    act(() => {
      result.current.openFor("", "create");
    });

    await act(async () => {
      await result.current.createOfficial(createInput);
    });
    expect(result.current.mutationError).toBe("Transient failure.");
    expect(result.current.openModal).toBe("create");

    await act(async () => {
      await result.current.createOfficial(createInput);
    });
    expect(result.current.mutationError).toBeNull();
    expect(result.current.openModal).toBeNull();
    expect(result.current.notice).toBe("Official account invited successfully.");

    act(() => {
      result.current.openFor(account.id, "delete");
    });
    expect(result.current.mutationError).toBeNull();

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.mutationError).toBeNull();
  });

  it("keeps load failures in error and leaves mutationError empty", async () => {
    mockListAccountsAction.mockRejectedValueOnce(new Error("Failed to load accounts."));

    const { result } = renderHook(() => useAccountAdministration());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load accounts.");
    expect(result.current.mutationError).toBeNull();
  });

  it("keeps delete success behavior unchanged", async () => {
    const { result } = renderHook(() => useAccountAdministration());
    await waitForInitialLoad(result);

    act(() => {
      result.current.openFor(account.id, "delete");
    });

    await act(async () => {
      await result.current.deleteSelected();
    });

    expect(result.current.openModal).toBeNull();
    expect(result.current.notice).toBe("Account deleted.");
    expect(result.current.mutationError).toBeNull();
  });
});
