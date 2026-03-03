"use client";

import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function UnhideUpdateModal({
  open,
  onOpenChange,
  reason,
  onReasonChange,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}) {
  const isValid = reason.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Unhide Update</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-[13.5px] text-slate-700">
          <Alert className="border-sky-200 bg-sky-50 text-sky-900">
            <Info className="h-4 w-4 text-sky-600" />
            <AlertDescription className="text-sky-800">
              <div className="font-medium">Restore Update Visibility</div>
              <div className="mt-2 text-sm">
                The update will be restored for public viewing. This action is audit-logged for
                accountability.
              </div>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>
              Reason for Unhide <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Explain why this update should be restored to public visibility..."
              className="min-h-[120px]"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            Audit Logging: All actions performed on this workflow case are automatically logged with
            timestamps, user information, and justification for compliance purposes.
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Button className="w-56" disabled={!isValid || isSubmitting} onClick={onConfirm}>
              {isSubmitting ? "Unhiding..." : "Confirm Unhide Update"}
            </Button>
            <Button
              variant="outline"
              className="w-56"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
