/**
 * Upload AIP Dialog Component
 *
 * Modal dialog for uploading new Annual Investment Plan documents.
 */

"use client";

import * as React from "react";
import { X, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UploadResult = {
  aipId: string;
  runId: string;
  status: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (payload: { file: File; year: number }) => Promise<UploadResult>;
  onSuccess?: (payload: UploadResult) => void;
  scope?: "city" | "barangay";
};

const MAX_BYTES = 25 * 1024 * 1024;

function bytesToMbLabel(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return mb.endsWith(".0") ? mb.slice(0, -2) : mb;
}

export function buildUploadAipYears(currentYear = new Date().getFullYear()) {
  return Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);
}

export default function UploadAipDialog({
  open,
  onOpenChange,
  onSubmit,
  onSuccess,
  scope = "barangay",
}: Props) {
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const [file, setFile] = React.useState<File | null>(null);
  const [year, setYear] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const years = React.useMemo(() => buildUploadAipYears(), []);
  const scopeLabel = scope === "city" ? "city" : "barangay";

  function reset() {
    setFile(null);
    setYear("");
    setError("");
    setIsSubmitting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function validate(f: File | null, y: string) {
    if (!f) return "Please upload an AIP PDF file.";
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      return "PDF only. Please upload a .pdf file.";
    }
    if (f.size > MAX_BYTES) {
      return `File too large. Maximum file size is ${bytesToMbLabel(MAX_BYTES)}MB.`;
    }
    if (!y) return "Please select the AIP year.";
    return "";
  }

  function onPickFile(next: File | null) {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    const msg = validate(next, year);
    if (msg && !msg.includes("year")) {
      setFile(null);
      setError(msg);
      return;
    }
    setFile(next);
  }

  async function submit() {
    const msg = validate(file, year);
    if (msg) {
      setError(msg);
      return;
    }

    if (!onSubmit) {
      setError("Upload action is not configured.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      const result = await onSubmit({ file: file!, year: Number(year) });
      onOpenChange(false);
      reset();
      onSuccess?.(result);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to upload AIP."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-[720px] overflow-hidden p-0" showCloseButton={false}>
        <div className="p-8 pb-4">
          <DialogHeader className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-3xl font-bold text-slate-900">Upload AIP</DialogTitle>
                <DialogDescription className="mt-2 text-base text-slate-500">
                  Upload a new Annual Investment Plan document for your {scopeLabel}
                </DialogDescription>
              </div>

              <DialogClose asChild>
                <button
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                  disabled={isSubmitting}
                >
                  <X className="h-5 w-5" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-6 px-8 pb-6">
          <div className="space-y-3">
            <Label className="text-base font-medium text-slate-900">
              AIP Document (PDF only) <span className="text-red-500">*</span>
            </Label>

            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              disabled={isSubmitting}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isSubmitting}
              className={[
                "w-full rounded-xl border-2 border-slate-200 bg-white px-6 py-10 text-center transition",
                "hover:bg-slate-50",
                error && !file ? "border-red-300" : "",
              ].join(" ")}
            >
              <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-slate-200 bg-slate-50">
                  <Upload className="h-7 w-7 text-slate-400" />
                </div>

                {file ? (
                  <>
                    <div className="text-lg font-medium text-slate-700">{file.name}</div>
                    <div className="text-sm text-slate-400">Click to change file</div>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-medium text-slate-700">Click to upload PDF file</div>
                    <div className="text-base text-slate-400">
                      Maximum file size: {bytesToMbLabel(MAX_BYTES)}MB
                    </div>
                  </>
                )}
              </div>
            </button>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-medium text-slate-900">
              AIP Year <span className="text-red-500">*</span>
            </Label>

            <Select
              value={year}
              onValueChange={(v) => {
                setYear(v);
                setError("");
              }}
              disabled={isSubmitting}
            >
              <SelectTrigger className="h-12 border-slate-200 bg-slate-50">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200 px-8 py-5">
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="outline" className="h-11 px-8" disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>

            <Button
              className="h-11 bg-[#022437] px-8 hover:bg-[#022437]/90"
              onClick={submit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Uploading..." : "Upload AIP"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
