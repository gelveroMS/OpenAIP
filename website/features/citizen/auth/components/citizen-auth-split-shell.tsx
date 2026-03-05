"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";

type CitizenAuthSplitShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
  formPanel: ReactNode;
  brandPanel: ReactNode;
  formFirst?: boolean;
  canClose?: boolean;
};

export default function CitizenAuthSplitShell({
  open,
  onOpenChange,
  titleId,
  descriptionId,
  formPanel,
  brandPanel,
  formFirst = true,
  canClose = true,
}: CitizenAuthSplitShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        overlayClassName="fixed inset-0 z-50 bg-[#001925]/65 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        onEscapeKeyDown={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
        className={cn(
          "w-full border-0 bg-transparent p-0 shadow-none",
          "max-w-[calc(100%-2rem)] sm:max-w-[calc(100%-4rem)] md:max-w-[calc(100%-6rem)] lg:max-w-[calc(100%-8rem)] xl:max-w-[1240px]"
        )}
      >
        <DialogTitle className="sr-only">Citizen Authentication</DialogTitle>
        <DialogDescription className="sr-only">
          Citizen sign in and sign up modal flow.
        </DialogDescription>
        <div className="relative mx-auto h-[min(88vh,720px)] w-full overflow-hidden rounded-2xl shadow-xl">
          {canClose ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-6 top-6 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              aria-label="Close authentication modal"
            >
              <X className="h-6 w-6" />
            </button>
          ) : null}

          <div className="grid h-full md:grid-cols-2">
            <section className={cn("order-1 h-full", formFirst ? "md:order-1" : "md:order-2")}>
              {formPanel}
            </section>
            <section className={cn("order-2 h-full", formFirst ? "md:order-2" : "md:order-1")}>
              {brandPanel}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
