"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function ConfirmUnpublishBannerModal({
  open,
  onOpenChange,
  onConfirm,
  confirmDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Confirm Unpublish Banner</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-[13.5px] text-slate-700">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div className="text-xs">
                <div className="font-semibold">High Impact Action</div>
                <div>
                  Unpublishing removes the current banner from all websites immediately. This action is
                  audit-logged.
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={confirmDisabled}>
              Confirm Unpublish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

