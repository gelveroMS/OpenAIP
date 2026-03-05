import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/formatting";
import type { AipDetailsTableVM, BudgetCategoryKey, AipDetailsTabVM, AipDetailsRowVM } from "@/lib/domain/citizen-budget-allocation";

const tabValue = (key: BudgetCategoryKey) => key;

type AipDetailsSectionProps = {
  vm: AipDetailsTableVM;
  onTabChange: (key: BudgetCategoryKey) => void;
  onSearchChange: (value: string) => void;
  viewAllHref: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export default function AipDetailsSection({ vm, onTabChange, onSearchChange, viewAllHref, page, totalPages, onPageChange }: AipDetailsSectionProps) {
  const hasPagination = totalPages > 0;
  return (
    <section className="mx-auto max-w-6xl px-6 pt-3 pb-12">
      <Card className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5 md:p-6">
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold text-[#022437]">{vm.title}</h3>
            <p className="text-sm text-slate-500">{vm.subtitle}</p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={tabValue(vm.activeTab)} onValueChange={(value) => onTabChange(value as BudgetCategoryKey)}>
              <TabsList className="h-auto rounded-full bg-slate-100 p-1">
                {vm.tabs.map((tab: AipDetailsTabVM) => (
                  <TabsTrigger
                    key={tab.key}
                    value={tabValue(tab.key)}
                    className="rounded-full px-4 py-1.5 text-xs font-medium text-slate-600 data-[state=active]:bg-[#022437] data-[state=active]:text-white data-[state=active]:shadow-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={vm.searchText}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search by project name or keyword"
                className="h-10 rounded-xl border-slate-200 pl-9 focus-visible:ring-cyan-500/40"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-100 hover:bg-slate-100">
                  <TableHead className="text-xs font-semibold text-slate-700">AIP Reference Code</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">Program Description</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-right">Total Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-sm text-slate-500">
                      No projects match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  vm.rows.map((row: AipDetailsRowVM) => (
                    <TableRow key={row.aipRefCode} className="transition-colors hover:bg-slate-50/80">
                      <TableCell className="text-sm text-slate-700">{row.aipRefCode}</TableCell>
                      <TableCell className="text-sm text-slate-700">{row.programDescription}</TableCell>
                      <TableCell className="text-sm text-slate-700 text-right tabular-nums">
                        {formatPeso(row.totalAmount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {hasPagination ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button asChild variant="link" className="text-sm font-semibold text-[#0b5188]">
              <Link href={viewAllHref}>View Full Details of AIP -&gt;</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
