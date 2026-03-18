"use client";

import { useState } from "react";
import BudgetCategoriesPanel from "../components/budget-categories-panel";
import LguManagementHeader from "../components/lgu-management-header";
import LguMasterList from "../components/lgu-master-list";
import AddLguModal from "../components/modals/add-lgu-modal";
import DeactivateLguModal from "../components/modals/deactivate-lgu-modal";
import EditLguModal from "../components/modals/edit-lgu-modal";
import { useLguManagement } from "../hooks/use-lgu-management";

export default function LguManagementView() {
  const {
    loading,
    error,
    query,
    setQuery,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    lgus,
    filteredLgus,
    addOpen,
    setAddOpen,
    editOpen,
    setEditOpen,
    deactivateOpen,
    setDeactivateOpen,
    selected,
    openAdd,
    openEdit,
    openDeactivate,
    addLgu,
    editLgu,
    setStatus,
  } = useLguManagement();

  const [inlineError, setInlineError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <LguManagementHeader onAdd={openAdd} />

      {inlineError ? <div className="text-sm text-rose-600">{inlineError}</div> : null}

      {loading ? (
        <div className="text-sm text-slate-500">Loading LGUs...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <LguMasterList
              query={query}
              onQueryChange={setQuery}
              typeFilter={typeFilter}
              onTypeChange={setTypeFilter}
              statusFilter={statusFilter}
              onStatusChange={setStatusFilter}
              rows={filteredLgus}
              onEdit={(id) => openEdit(id)}
              onDeactivate={(id) => openDeactivate(id)}
              onActivate={async (id) => {
                try {
                  await setStatus(id, "active");
                } catch (err) {
                  setInlineError(
                    err instanceof Error ? err.message : "Failed to activate LGU."
                  );
                }
              }}
            />
          </div>

          <div className="min-w-0">
            <BudgetCategoriesPanel />
          </div>
        </div>
      )}

      <AddLguModal
        open={addOpen}
        onOpenChange={setAddOpen}
        lgus={lgus}
        onSave={async (input) => {
          setInlineError(null);
          try {
            await addLgu(input);
          } catch (err) {
            setInlineError(err instanceof Error ? err.message : "Failed to add LGU.");
            throw err;
          }
        }}
      />

      <EditLguModal
        open={editOpen}
        onOpenChange={setEditOpen}
        lgu={selected}
        lgus={lgus}
        onSave={async (id, patch, nextStatus) => {
          setInlineError(null);
          try {
            await editLgu(id, patch);
            if (selected && selected.status !== nextStatus) {
              await setStatus(id, nextStatus);
            }
          } catch (err) {
            setInlineError(
              err instanceof Error ? err.message : "Failed to update LGU."
            );
            throw err;
          }
        }}
      />

      <DeactivateLguModal
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        lgu={selected}
        onConfirm={async (id) => {
          setInlineError(null);
          try {
            await setStatus(id, "deactivated");
          } catch (err) {
            setInlineError(
              err instanceof Error ? err.message : "Failed to deactivate LGU."
            );
            throw err;
          }
        }}
      />
    </div>
  );
}

