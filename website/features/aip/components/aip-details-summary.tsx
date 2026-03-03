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
      <CardContent className="px-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Summary</h2>
          <p className="mt-2 text-sm text-slate-600">{aip.summaryText}</p>
        </div>
      </CardContent>
    </Card>
  );
}
