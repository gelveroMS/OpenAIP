import Link from 'next/link';
import { Calendar, FileText, Eye, WalletCards } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AipListItem } from '@/features/citizen/aips/types';
import { formatCurrency, formatPublishedDate } from '@/features/citizen/aips/data/aips.data';

export default function AipListCard({ item }: { item: AipListItem }) {
  return (
    <Link href={`/aips/${item.id}`} className="block">
      <Card data-testid={`citizen-aip-card-${item.id}`} className="border-slate-200 bg-white transition-shadow hover:shadow-md">
        <CardContent className="px-3 py-3 sm:px-5 md:py-6">
          <div className="flex flex-col gap-3 md:min-h-[170px] md:flex-row md:items-stretch md:justify-between md:gap-6">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#0E7490] md:h-5 md:w-5" />
                <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold leading-tight text-slate-900 md:text-xl">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs leading-6 text-slate-600 md:pr-4 md:text-sm md:leading-7">
                    {item.description}
                  </p>
                </div>
              </div>

              <div className="ml-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 md:ml-8 md:text-sm">
                <div className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>Fiscal Year {item.fiscalYear}</span>
                </div>
                <div className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>Published {formatPublishedDate(item.publishedAt)}</span>
                </div>
              </div>

              <div className="ml-0 flex min-w-0 flex-wrap items-center gap-2 md:ml-8 md:gap-x-10">
                <Badge variant="secondary" className="min-w-0 max-w-full rounded-full text-slate-700">
                  <WalletCards className="mr-2 h-3 w-3 shrink-0" />
                  Budget: {formatCurrency(item.budgetTotal)}
                </Badge>
                <Badge className="rounded-full bg-[#5ba6cb] text-white">{item.projectsCount} Projects</Badge>
              </div>
            </div>

            <div className="md:flex md:shrink-0 md:items-end md:pl-2">
              <span className="inline-flex md:mt-auto">
                <Button
                  type="button"
                  data-testid={`citizen-aip-view-details-${item.id}`}
                  className="h-9 rounded-lg bg-[#03455f] px-3.5 text-sm text-white hover:bg-[#02384d] md:h-10 md:px-4"
                  tabIndex={-1}
                >
                  <Eye className="h-4 w-4" />
                  View Details
                </Button>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
