"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { AipHeader } from "../types";

export function AipDetailsSummary({
  aip,
}: {
  aip: AipHeader;
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">Summary</h2>
          <p className="mt-2 break-words text-sm leading-7 text-slate-600">
            {aip.summaryText}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
