import DonutCard, { type DonutSectorItem } from "./donut-card";
import LineTrendsCard, { type SectorTrendPoint } from "./line-trends-card";

type ChartsGridProps = {
  fiscalYear: number;
  totalBudget: number;
  sectors: DonutSectorItem[];
  trendSubtitle: string;
  trendData: SectorTrendPoint[];
};

export default function ChartsGrid({
  fiscalYear,
  totalBudget,
  sectors,
  trendSubtitle,
  trendData,
}: ChartsGridProps) {
  return (
    <section className="mx-auto max-w-6xl px-3 pb-4 pt-6 sm:px-4 md:px-6 md:pt-10 md:pb-5">
      <div className="grid gap-4 md:gap-6 lg:grid-cols-[0.95fr_1.35fr]">
        <DonutCard fiscalYear={fiscalYear} totalBudget={totalBudget} sectors={sectors} />
        <LineTrendsCard subtitle={trendSubtitle} data={trendData} />
      </div>
    </section>
  );
}
