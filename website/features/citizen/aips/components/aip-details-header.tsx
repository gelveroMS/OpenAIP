import { Calendar, FileText } from 'lucide-react';
import { BreadcrumbNav } from '@/components/layout/breadcrumb-nav';
import { Badge } from '@/components/ui/badge';
import type { AipDetails } from '@/features/citizen/aips/types';
import { formatCurrency, formatPublishedDate } from '@/features/citizen/aips/data/aips.data';

export default function AipDetailsHeader({ aip }: { aip: AipDetails }) {
  return (
    <section className="space-y-4">
      <BreadcrumbNav items={[{ label: 'AIPs', href: '/aips' }, { label: 'View Details' }]} />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#cae4f6]/90 p-2">
              <FileText className="h-5 w-5 text-[#1d5f89]" />
            </div>
            <div className="space-y-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{aip.title}</h1>
                <p className="mt-1 text-lg text-slate-600">{aip.subtitle}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Published {formatPublishedDate(aip.publishedAt)}
                </span>
                <span>Budget: {formatCurrency(aip.budgetTotal)}</span>
                <Badge className="bg-[#5ba6cb] text-white">{aip.projectsCount} Projects</Badge>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
