"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function HideFeedbackModal({
  open,
  onOpenChange,
  reason,
  onReasonChange,
  violationCategory,
  onViolationCategoryChange,
  onConfirm,
  violationOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  violationCategory: string;
  onViolationCategoryChange: (value: string) => void;
  onConfirm: () => void;
  violationOptions: string[];
}) {
  const isValid = reason.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Hide Feedback</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-[13.5px] text-slate-700">
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <div className="font-medium">Feedback Visibility Policy</div>
              <ul className="mt-2 list-disc pl-4 text-sm">
                <li>Feedback will not be deleted from the system.</li>
                <li>
                  Citizens will see: &quot;This feedback has been hidden due to policy violation.&quot;
                </li>
                <li>Original content preserved for accountability.</li>
                <li>Action is audit-logged with your identity and justification.</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>
              Moderation Reason <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Explain why this feedback violates community guidelines or content policy..."
              className="min-h-[120px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Violation Category</Label>
            <Select value={violationCategory} onValueChange={onViolationCategoryChange}>
              <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                <SelectValue placeholder="Select Violation" />
              </SelectTrigger>
              <SelectContent>
                {violationOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            Audit Logging: All actions performed in this workflow case are automatically logged with timestamps, user information, and justification for compliance purposes.
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Button className="w-56" disabled={!isValid} onClick={onConfirm}>
              Hide Feedback
            </Button>
            <Button
              variant="outline"
              className="w-56"
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

