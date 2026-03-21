"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOfficialAccountAction,
  deleteAccountAction,
  listAccountsAction,
  resendInviteAction,
  resetAccountPasswordAction,
  setAccountStatusAction,
  updateAccountAction,
} from "../actions/account-administration.actions";
import type {
  AccountListResult,
  AccountRole,
  AccountScopeType,
  AccountStatus,
  AccountTab,
  CreateOfficialAccountInput,
  OfficialRole,
  UpdateAccountInput,
} from "@/lib/repos/accounts/repo";

export type OpenModal =
  | "details"
  | "create"
  | "edit"
  | "deactivate"
  | "activate"
  | "delete"
  | "reset_password"
  | "resend_invite"
  | null;

export type RoleFilter = "all" | AccountRole;
export type StatusFilter = "all" | AccountStatus;
export type LguFilter = "all" | string;

const DEFAULT_PAGE_SIZE = 10;

function initialListResult(): AccountListResult {
  return {
    rows: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    roleOptions: ["admin", "barangay_official", "city_official", "municipal_official"],
    lguOptions: [],
  };
}

export function useAccountAdministration() {
  const [activeTab, setActiveTab] = useState<AccountTab>("officials");
  const [listResult, setListResult] = useState<AccountListResult>(initialListResult());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lguFilter, setLguFilter] = useState<LguFilter>("all");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) return null;
    return listResult.rows.find((row) => row.id === selectedAccountId) ?? null;
  }, [listResult.rows, selectedAccountId]);

  const totalPages = Math.max(1, Math.ceil(listResult.total / listResult.pageSize));

  const lguOptions = useMemo(() => listResult.lguOptions, [listResult.lguOptions]);

  const filteredRoleOptions = useMemo(() => {
    if (activeTab === "citizens") return ["citizen"] as AccountRole[];
    return listResult.roleOptions.filter((role) => role !== "citizen");
  }, [activeTab, listResult.roleOptions]);

  const createRoleOptions = useMemo(
    () =>
      (["barangay_official", "city_official", "municipal_official"] as OfficialRole[]),
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAccountsAction({
        tab: activeTab,
        query,
        role: roleFilter,
        status: statusFilter,
        lguKey: lguFilter,
        page,
        pageSize,
      });
      setListResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, lguFilter, page, pageSize, query, roleFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, query, roleFilter, statusFilter, lguFilter]);

  useEffect(() => {
    setRoleFilter("all");
    setLguFilter("all");
  }, [activeTab]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function closeModal() {
    setOpenModal(null);
    setMutationError(null);
  }

  function openFor(id: string, modal: Exclude<OpenModal, null>) {
    if (modal === "create") {
      setSelectedAccountId(null);
    } else {
      setSelectedAccountId(id);
    }
    setOpenModal(modal);
    setNotice(null);
    setMutationError(null);
  }

  async function performMutation(
    run: () => Promise<void>,
    fallbackErrorMessage = "Operation failed."
  ) {
    setMutating(true);
    setMutationError(null);
    setNotice(null);
    try {
      await run();
      await load();
      closeModal();
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : fallbackErrorMessage
      );
    } finally {
      setMutating(false);
    }
  }

  async function createOfficial(input: CreateOfficialAccountInput) {
    await performMutation(async () => {
      await createOfficialAccountAction(input);
      setNotice("Official account invited successfully.");
    }, "Failed to create account.");
  }

  async function updateSelected(input: { fullName: string; role: AccountRole; lguKey: string | "none" }) {
    if (!selectedAccount) return;

    const scopeType = input.lguKey === "none"
      ? "none"
      : (input.lguKey.split(":")[0] as AccountScopeType);
    const scopeId =
      input.lguKey === "none" ? null : input.lguKey.split(":").slice(1).join(":");

    const patch: UpdateAccountInput = {
      fullName: input.fullName,
      role: input.role,
      scopeType,
      scopeId,
    };

    await performMutation(async () => {
      await updateAccountAction(selectedAccount.id, patch);
      setNotice("Account updated.");
    });
  }

  async function deactivateSelected() {
    if (!selectedAccount) return;
    await performMutation(async () => {
      await setAccountStatusAction(selectedAccount.id, "deactivated");
      setNotice("Account deactivated.");
    });
  }

  async function activateSelected() {
    if (!selectedAccount) return;
    await performMutation(async () => {
      await setAccountStatusAction(selectedAccount.id, "active");
      setNotice("Account activated.");
    });
  }

  async function deleteSelected() {
    if (!selectedAccount) return;
    await performMutation(async () => {
      await deleteAccountAction(selectedAccount.id);
      setSelectedAccountId(null);
      setNotice("Account deleted.");
    }, "Failed to delete account.");
  }

  async function resetPasswordSelected() {
    if (!selectedAccount) return;
    await performMutation(async () => {
      await resetAccountPasswordAction(selectedAccount.id);
      setNotice("Password reset email sent.");
    });
  }

  async function resendInviteSelected() {
    if (!selectedAccount) return;
    await performMutation(async () => {
      await resendInviteAction(selectedAccount.id);
      setNotice("Invite resent.");
    });
  }

  function toLguKey(scopeType: AccountScopeType, scopeId: string | null) {
    if (scopeType === "none" || !scopeId) return "none";
    return `${scopeType}:${scopeId}`;
  }

  return {
    activeTab,
    setActiveTab,

    rows: listResult.rows,
    total: listResult.total,
    loading,
    error,
    mutationError,
    notice,
    mutating,

    query,
    setQuery,
    roleFilter,
    setRoleFilter,
    statusFilter,
    setStatusFilter,
    lguFilter,
    setLguFilter,
    roleOptions: filteredRoleOptions,
    createRoleOptions,
    lguOptions,

    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,

    selectedAccount,
    openModal,
    setOpenModal,
    closeModal,
    openFor,

    createOfficial,
    updateSelected,
    deactivateSelected,
    activateSelected,
    deleteSelected,
    resetPasswordSelected,
    resendInviteSelected,

    toLguKey,
  };
}
