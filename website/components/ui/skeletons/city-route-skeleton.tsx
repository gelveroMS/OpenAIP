import DashboardSkeleton from "@/components/ui/skeletons/DashboardSkeleton";

export type CityRouteSkeletonVariant =
  | "dashboard"
  | "list"
  | "table"
  | "chat"
  | "detail";

function GenericHeader() {
  return (
    <div className="space-y-3">
      <div className="h-7 w-56 max-w-full animate-pulse rounded-full bg-slate-200" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded-full bg-slate-100" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <GenericHeader />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`city-list-loader-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="h-5 w-64 max-w-full animate-pulse rounded-full bg-slate-200" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-slate-100" />
            <div className="mt-2 h-4 w-5/6 animate-pulse rounded-full bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <GenericHeader />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_180px_minmax(0,1fr)]">
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={`city-table-loader-${index}`} className="mt-3 h-8 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" role="status" aria-live="polite" aria-busy="true">
      <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 lg:block">
        <div className="h-8 w-40 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-10 animate-pulse rounded-lg bg-slate-100" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={`city-chat-list-loader-${index}`} className="mt-3 h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="h-8 w-44 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 space-y-3">
          <div className="h-16 w-[70%] animate-pulse rounded-xl bg-slate-100" />
          <div className="ml-auto h-16 w-[64%] animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 w-[74%] animate-pulse rounded-xl bg-slate-100" />
        </div>
        <div className="mt-4 h-12 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <div className="h-4 w-56 max-w-full animate-pulse rounded-full bg-slate-200" />
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="h-8 w-80 max-w-full animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-44 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="h-7 w-48 max-w-full animate-pulse rounded-full bg-slate-200" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`city-detail-loader-${index}`} className="mt-3 h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

export default function CityRouteSkeleton({
  variant,
}: {
  variant: CityRouteSkeletonVariant;
}) {
  if (variant === "dashboard") {
    return <DashboardSkeleton variant="city" />;
  }
  if (variant === "chat") {
    return <ChatSkeleton />;
  }
  if (variant === "table") {
    return <TableSkeleton />;
  }
  if (variant === "detail") {
    return <DetailSkeleton />;
  }
  return <ListSkeleton />;
}
