import ChartSkeleton from "@/components/ui/skeletons/ChartSkeleton";
import KpiSkeleton from "@/components/ui/skeletons/KpiSkeleton";
import { cn } from "@/lib/ui/utils";

export type DashboardSkeletonProps = {
  variant: "citizen" | "city" | "barangay" | "admin";
};

function HeaderBars({
  titleClassName,
  subtitleClassName,
}: {
  titleClassName?: string;
  subtitleClassName?: string;
}) {
  return (
    <div className="space-y-3">
      <div className={cn("h-5 w-40 animate-pulse rounded-full bg-slate-200", titleClassName)} />
      <div className={cn("h-3 w-72 max-w-full animate-pulse rounded-full bg-slate-200", subtitleClassName)} />
    </div>
  );
}

function CitizenDashboardSkeleton() {
  return (
    <div className="min-h-[calc(100vh-4rem)] w-full bg-[#D3DBE0] px-4 py-6 sm:px-6 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-white/60 bg-white/85 p-6">
          <HeaderBars titleClassName="h-6 w-44" subtitleClassName="w-[26rem]" />
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <ChartSkeleton bodyClassName="h-48 sm:h-56" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <KpiSkeleton />
              <KpiSkeleton />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <ChartSkeleton bodyClassName="h-40 sm:h-44" />
          <ChartSkeleton bodyClassName="h-40 sm:h-44" />
          <ChartSkeleton bodyClassName="h-40 sm:h-44" />
        </div>
      </div>
    </div>
  );
}

function CityDashboardSkeleton() {
  return (
    <div className="w-full space-y-6">
      <HeaderBars titleClassName="h-7 w-52" subtitleClassName="w-80" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_1fr]">
        <ChartSkeleton bodyClassName="h-56" />
        <div className="space-y-4">
          <ChartSkeleton bodyClassName="h-24" />
          <ChartSkeleton bodyClassName="h-24" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.95fr_1fr]">
        <ChartSkeleton bodyClassName="h-52" />
        <ChartSkeleton bodyClassName="h-52" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <ChartSkeleton bodyClassName="h-28" />
          <ChartSkeleton bodyClassName="h-44" />
          <ChartSkeleton bodyClassName="h-40" />
        </div>
        <ChartSkeleton bodyClassName="h-[30rem]" />
      </div>
    </div>
  );
}

function BarangayDashboardSkeleton() {
  return (
    <div className="w-full space-y-6">
      <HeaderBars titleClassName="h-7 w-52" subtitleClassName="w-72" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_1fr]">
        <ChartSkeleton bodyClassName="h-56" />
        <div className="space-y-4">
          <ChartSkeleton bodyClassName="h-24" />
          <ChartSkeleton bodyClassName="h-24" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <ChartSkeleton bodyClassName="h-32" />
          <ChartSkeleton bodyClassName="h-40" />
          <ChartSkeleton bodyClassName="h-36" />
        </div>
        <ChartSkeleton bodyClassName="h-[28rem]" />
      </div>
    </div>
  );
}

function AdminDashboardSkeleton() {
  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <HeaderBars titleClassName="h-7 w-36" subtitleClassName="w-72" />
        <div className="h-7 w-24 animate-pulse rounded-full bg-slate-200" />
      </div>

      <div className="rounded-[10px] border border-slate-200 bg-[#F4F6F8] px-8 py-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="h-10 animate-pulse rounded-xl bg-white" />
          <div className="h-10 animate-pulse rounded-xl bg-white" />
          <div className="h-10 animate-pulse rounded-xl bg-white" />
          <div className="h-10 animate-pulse rounded-xl bg-white" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2.1fr_1fr]">
        <ChartSkeleton bodyClassName="h-64" />
        <ChartSkeleton bodyClassName="h-64" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2.1fr_1fr]">
        <div className="space-y-6">
          <ChartSkeleton bodyClassName="h-56" />
          <ChartSkeleton bodyClassName="h-56" />
        </div>
        <div className="space-y-4">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
      </div>
    </div>
  );
}

export default function DashboardSkeleton({ variant }: DashboardSkeletonProps) {
  switch (variant) {
    case "citizen":
      return <CitizenDashboardSkeleton />;
    case "city":
      return <CityDashboardSkeleton />;
    case "barangay":
      return <BarangayDashboardSkeleton />;
    case "admin":
      return <AdminDashboardSkeleton />;
    default:
      return null;
  }
}
