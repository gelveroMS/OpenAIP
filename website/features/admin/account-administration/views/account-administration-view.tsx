"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AccountAdminHeader from "../components/account-admin-header";
import AccountFilters from "../components/account-filters";
import AccountTabs from "../components/account-tabs";
import AccountsTable from "../components/accounts-table";
import ActivateAccountModal from "../components/modals/activate-account-modal";
import AccountDetailsModal from "../components/modals/account-details-modal";
import CreateOfficialModal from "../components/modals/create-official-modal";
import DeactivateAccountModal from "../components/modals/deactivate-account-modal";
import DeleteAccountModal from "../components/modals/delete-account-modal";
import EditAccountModal from "../components/modals/edit-account-modal";
import ResendInviteModal from "../components/modals/resend-invite-modal";
import ResetPasswordModal from "../components/modals/reset-password-modal";
import { useAccountAdministration } from "../hooks/use-account-administration";

export default function AccountAdministrationView() {
  const {
    activeTab,
    setActiveTab,

    rows,
    total,
    loading,
    error,
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
    roleOptions,
    createRoleOptions,
    lguOptions,

    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,

    selectedAccount,
    openModal,
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
  } = useAccountAdministration();

  return (
    <div className="space-y-6">
      <AccountAdminHeader
        onCreateOfficial={() => openFor("", "create")}
        showCreateOfficial={activeTab === "officials"}
      />

      <AccountTabs value={activeTab} onChange={setActiveTab} />

      <AccountFilters
        query={query}
        onQueryChange={setQuery}
        roleFilter={roleFilter}
        onRoleChange={setRoleFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        lguFilter={lguFilter}
        onLguChange={setLguFilter}
        roleOptions={roleOptions}
        lguOptions={lguOptions}
      />

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
          Loading accounts...
        </div>
      ) : (
        <>
          <AccountsTable
            rows={rows}
            onViewDetails={(id) => openFor(id, "details")}
            onEdit={(id) => openFor(id, "edit")}
            onDeactivate={(id) => openFor(id, "deactivate")}
            onDelete={(id) => openFor(id, "delete")}
            onResetPassword={(id) => openFor(id, "reset_password")}
            onResendInvite={(id) => openFor(id, "resend_invite")}
            onActivateOrReactivate={(id) => openFor(id, "activate")}
          />

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              {`Showing ${rows.length} of ${total} accounts`}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Rows</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => setPageSize(Number(value))}
                >
                  <SelectTrigger className="h-9 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span className="text-xs text-slate-600">{`Page ${page} of ${totalPages}`}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <AccountDetailsModal
        open={openModal === "details"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
      />

      <CreateOfficialModal
        open={openModal === "create"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        roleOptions={createRoleOptions}
        lguOptions={lguOptions}
        onSave={createOfficial}
        loading={mutating}
      />

      <EditAccountModal
        key={`edit-${selectedAccount?.id ?? "none"}-${openModal === "edit"}`}
        open={openModal === "edit"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        lguOptions={lguOptions}
        toLguKey={toLguKey}
        onSave={updateSelected}
        loading={mutating}
      />

      <DeactivateAccountModal
        open={openModal === "deactivate"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        onConfirm={deactivateSelected}
        loading={mutating}
      />

      <ActivateAccountModal
        open={openModal === "activate"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        onConfirm={activateSelected}
        loading={mutating}
      />

      <DeleteAccountModal
        open={openModal === "delete"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        onConfirm={deleteSelected}
        loading={mutating}
      />

      <ResetPasswordModal
        open={openModal === "reset_password"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        onConfirm={resetPasswordSelected}
        loading={mutating}
      />

      <ResendInviteModal
        open={openModal === "resend_invite"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        account={selectedAccount}
        onConfirm={resendInviteSelected}
        loading={mutating}
      />
    </div>
  );
}
