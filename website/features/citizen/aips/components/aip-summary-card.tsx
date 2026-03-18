import { Card, CardContent } from '@/components/ui/card';
import type { AipDetails } from '@/features/citizen/aips/types';

export default function AipSummaryCard({ aip }: { aip: AipDetails }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-2 px-4 py-4 sm:px-6 sm:py-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">Summary</h2>
          <p className="mt-2 text-sm leading-7 text-slate-700 sm:mt-3 sm:text-base">{aip.summaryText}</p>
        </div>
      </CardContent>
    </Card>
  );
}
