import { Calendar, FileText } from 'lucide-react';
import { BreadcrumbNav } from '@/components/layout/breadcrumb-nav';
import { Badge } from '@/components/ui/badge';
import type { AipDetails } from '@/features/citizen/aips/types';
import { formatCurrency, formatPublishedDate } from '@/features/citizen/aips/data/aips.data';

export default function AipDetailsHeader({ aip }: { aip: AipDetails }) {
  return (
    <section className="space-y-3 md:space-y-4 overflow-x-hidden">
      <BreadcrumbNav items={[{ label: 'AIPs', href: '/aips' }, { label: 'View Details' }]} />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#cae4f6]/90 p-1.5 sm:p-2">
              <FileText className="h-4.5 w-4.5 text-[#1d5f89] sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 space-y-2 md:space-y-3">
              <div>
                <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem] md:text-3xl">{aip.title}</h1>
                <p className="mt-1 break-words text-base text-slate-600 md:text-lg">{aip.subtitle}</p>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-xs text-slate-600 sm:text-sm">
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Published {formatPublishedDate(aip.publishedAt)}
                </span>
                <span className="break-words">Budget: {formatCurrency(aip.budgetTotal)}</span>
                <Badge className="bg-[#5ba6cb] text-white">{aip.projectsCount} Projects</Badge>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
