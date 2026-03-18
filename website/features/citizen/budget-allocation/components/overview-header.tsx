type OverviewHeaderProps = {
  title: string;
  subtitle: string;
};

export default function OverviewHeader({ title, subtitle }: OverviewHeaderProps) {
  return (
    <section
      data-testid="citizen-budget-allocation-overview-header"
      className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6"
    >
      <header className="space-y-1.5 text-center md:space-y-2">
        <h2 className="break-words text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
          {title}
        </h2>
        <p className="text-xs text-slate-600 md:text-sm">{subtitle}</p>
      </header>
    </section>
  );
}
