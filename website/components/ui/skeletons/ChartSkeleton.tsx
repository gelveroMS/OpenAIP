import { cn } from "@/lib/ui/utils";

type ChartSkeletonProps = {
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
};

export default function ChartSkeleton({
  className,
  headerClassName,
  bodyClassName,
}: ChartSkeletonProps) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5", className)}>
      <div className={cn("h-4 w-32 animate-pulse rounded-full bg-slate-200", headerClassName)} />
      <div className="mt-5 space-y-4">
        <div className={cn("h-48 animate-pulse rounded-2xl bg-slate-100", bodyClassName)} />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <span className="h-2 animate-pulse rounded-full bg-slate-200" />
          <span className="h-2 animate-pulse rounded-full bg-slate-200" />
          <span className="h-2 animate-pulse rounded-full bg-slate-200" />
          <span className="hidden h-2 animate-pulse rounded-full bg-slate-200 sm:block" />
        </div>
      </div>
    </div>
  );
}
