"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AccountRecord } from "@/lib/repos/accounts/repo";

export default function DeleteAccountModal({
  open,
  onOpenChange,
  account,
  onConfirm,
  loading,
  submitError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountRecord | null;
  onConfirm: () => void;
  loading: boolean;
  submitError: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Delete Account</DialogTitle>
        </DialogHeader>

        {!account ? (
          <div className="text-sm text-slate-500">No account selected.</div>
        ) : (
          <div className="space-y-4">
            <Alert variant="destructive" className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700">
                {`Delete ${account.fullName}'s account permanently? This removes profile data and auth access.`}
              </AlertDescription>
            </Alert>

            {submitError ? (
              <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="admin-delete-account-error">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-700">{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center justify-center gap-3">
              <Button variant="destructive" className="w-48" onClick={onConfirm} disabled={loading}>
                Delete
              </Button>
              <Button
                variant="outline"
                className="w-48"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
