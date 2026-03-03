import { cn } from "@/lib/ui/utils";

type KpiSkeletonProps = {
  className?: string;
};

export default function KpiSkeleton({ className }: KpiSkeletonProps) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5", className)}>
      <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-4 h-8 w-20 animate-pulse rounded-full bg-slate-300" />
      <div className="mt-5 h-3 w-32 animate-pulse rounded-full bg-slate-200" />
    </div>
  );
}
