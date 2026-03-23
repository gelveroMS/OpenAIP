"use client";

import { useState } from "react";
import BudgetCategoriesPanel from "../components/budget-categories-panel";
import LguManagementHeader from "../components/lgu-management-header";
import LguMasterList from "../components/lgu-master-list";
import AddLguModal from "../components/modals/add-lgu-modal";
import DeactivateLguModal from "../components/modals/deactivate-lgu-modal";
import EditLguModal from "../components/modals/edit-lgu-modal";
import { useLguManagement } from "../hooks/use-lgu-management";
import { mapLguDeactivationError } from "../utils/map-lgu-deactivation-error";

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
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [deactivateSubmitError, setDeactivateSubmitError] = useState<string | null>(
    null
  );
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);

  function openEditWithReset(id: string) {
    setEditSubmitError(null);
    openEdit(id);
  }

  function openDeactivateWithReset(id: string) {
    setDeactivateSubmitError(null);
    openDeactivate(id);
  }

  function handleEditOpenChange(open: boolean) {
    setEditOpen(open);
    if (!open) {
      setEditSubmitError(null);
    }
  }

  function handleDeactivateOpenChange(open: boolean) {
    setDeactivateOpen(open);
    if (!open) {
      setDeactivateSubmitError(null);
    }
  }

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
              onEdit={(id) => openEditWithReset(id)}
              onDeactivate={(id) => openDeactivateWithReset(id)}
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
        onOpenChange={handleEditOpenChange}
        lgu={selected}
        lgus={lgus}
        submitError={editSubmitError}
        onSave={async (id, patch, nextStatus) => {
          const isDeactivationAttempt =
            selected?.status !== undefined &&
            selected.status !== nextStatus &&
            nextStatus === "deactivated";

          setInlineError(null);
          setEditSubmitError(null);
          try {
            await editLgu(id, patch);
            if (selected && selected.status !== nextStatus) {
              await setStatus(id, nextStatus);
            }
          } catch (err) {
            if (isDeactivationAttempt) {
              setEditSubmitError(mapLguDeactivationError(err));
            } else {
              setInlineError(
                err instanceof Error ? err.message : "Failed to update LGU."
              );
            }
            throw err;
          }
        }}
      />

      <DeactivateLguModal
        open={deactivateOpen}
        onOpenChange={handleDeactivateOpenChange}
        lgu={selected}
        loading={deactivateSubmitting}
        submitError={deactivateSubmitError}
        onConfirm={async (id) => {
          setDeactivateSubmitError(null);
          setDeactivateSubmitting(true);
          try {
            await setStatus(id, "deactivated");
            handleDeactivateOpenChange(false);
          } catch (err) {
            setDeactivateSubmitError(mapLguDeactivationError(err));
          } finally {
            setDeactivateSubmitting(false);
          }
        }}
      />
    </div>
  );
}

