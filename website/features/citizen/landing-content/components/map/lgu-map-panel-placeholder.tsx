import Image from "next/image";
import { cn } from "@/lib/ui/utils";

type LguMapPanelPlaceholderProps = {
  className?: string;
};

export default function LguMapPanelPlaceholder({
  className,
}: LguMapPanelPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border border-slate-200 bg-[linear-gradient(180deg,#F7FAFC,#EAF1F6)]",
        className
      )}
      role="status"
      aria-label="Map loading placeholder"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full border-2 border-[#144679]/15 border-t-[#144679] animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <Image
            src="/brand/logo3.svg"
            alt=""
            width={36}
            height={36}
            className="relative z-10 h-9 w-9"
          />
        </div>
      </div>
      <div className="absolute left-3 top-3 rounded-md border border-dashed border-slate-300 bg-white/80 px-2.5 py-1 text-xs text-slate-500">
        Map Preview
      </div>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#0E7490]/15 px-2.5 py-1 text-xs font-medium text-[#0E5D6F]">
          Main marker
        </span>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">
          Barangay markers
        </span>
      </div>
    </div>
  );
}
