function AipCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="animate-pulse px-5 py-6">
        <div className="flex flex-col gap-4 md:min-h-[170px] md:flex-row md:items-stretch md:justify-between md:gap-6">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-5 w-5 rounded-full bg-slate-200" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="h-6 w-3/5 rounded bg-slate-200" />
                <div className="space-y-2">
                  <div className="h-4 w-full rounded bg-slate-100" />
                  <div className="h-4 w-11/12 rounded bg-slate-100" />
                </div>
              </div>
            </div>

            <div className="ml-8 flex flex-wrap gap-4">
              <div className="h-4 w-36 rounded bg-slate-100" />
              <div className="h-4 w-40 rounded bg-slate-100" />
            </div>

            <div className="ml-8 flex flex-wrap gap-3">
              <div className="h-6 w-44 rounded-full bg-slate-100" />
              <div className="h-6 w-28 rounded-full bg-slate-100" />
            </div>
          </div>

          <div className="md:flex md:shrink-0 md:items-end md:pl-2">
            <div className="h-10 w-28 rounded-lg bg-slate-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CitizenAipsLoading() {
  return (
    <section className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading annual investment plans</span>

      <section className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="relative h-[255px] overflow-hidden border border-[#063d7c] bg-[#6E8FB5]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%),linear-gradient(135deg,#1C4E9C_0%,#0E2B6C_52%,#071B4A_100%)]" />

            <div className="relative z-10 mx-auto flex h-full max-w-6xl animate-pulse flex-col justify-center px-4 text-center sm:px-6 lg:px-8">
              <div className="mx-auto h-12 w-3/5 rounded bg-white/20 md:h-16" />
              <div className="mx-auto mt-5 h-4 w-11/12 max-w-4xl rounded bg-white/15 md:h-5" />
              <div className="mx-auto mt-3 h-4 w-4/5 max-w-3xl rounded bg-white/15 md:h-5" />
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex animate-pulse items-start gap-3">
          <div className="mt-1 h-5 w-5 rounded bg-slate-200" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-72 max-w-full rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-4 w-2/3 rounded bg-amber-100" />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-16 rounded bg-slate-200" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <div className="h-4 w-20 rounded bg-slate-100" />
              <div className="h-11 rounded bg-slate-100" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 rounded bg-slate-100" />
              <div className="h-11 rounded bg-slate-100" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 rounded bg-slate-100" />
              <div className="h-11 rounded bg-slate-100" />
            </div>
          </div>
        </div>
      </div>

      <div className="h-4 w-36 animate-pulse rounded bg-slate-100" />

      <div className="space-y-4">
        <AipCardSkeleton />
        <AipCardSkeleton />
        <AipCardSkeleton />
      </div>
    </section>
  );
}
