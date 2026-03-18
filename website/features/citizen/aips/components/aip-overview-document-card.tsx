import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AipDetails } from '@/features/citizen/aips/types';

export default function AipOverviewDocumentCard({ aip }: { aip: AipDetails }) {
  return (
    <Card data-testid="citizen-aip-overview-card" className="border-slate-200">
      <CardHeader className="px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
        <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
          <FileText className="h-5 w-5 text-slate-600" />
          {aip.title}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-10">
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 text-center sm:min-h-[170px] sm:gap-3">
            <FileText className="h-12 w-12 text-slate-400" />
            <p className="break-all text-sm text-slate-600 sm:text-base">{aip.fileName}</p>
            {aip.pdfUrl ? (
              <Button variant="outline" asChild className="h-9 px-3 text-sm sm:h-10 sm:px-4">
                <a href={aip.pdfUrl} target="_blank" rel="noreferrer">
                  View PDF
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled className="h-9 px-3 text-sm sm:h-10 sm:px-4">
                View PDF
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
