"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import type { AipHeader } from "../types";

export function AipPdfContainer({ aip }: { aip: AipHeader }) {
  return (
    <Card className="border-slate-200">
      <CardHeader>
        <div className="flex items-center gap-2 text-slate-900 text-lg font-bold">
          <FileText className="h-4 w-4 text-slate-500" />
          AIP Document
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="border border-slate-200 rounded-lg bg-slate-50 p-5 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-lg bg-white border border-slate-200 grid place-items-center">
            <FileText className="h-6 w-6 text-slate-400" />
          </div>

          <div className="text-sm text-slate-600">{aip.fileName}</div>

          <Button variant="outline" disabled={!aip.pdfUrl} asChild={!!aip.pdfUrl}>
            {aip.pdfUrl ? (
              <a href={aip.pdfUrl} target="_blank" rel="noreferrer">
                View PDF
              </a>
            ) : (
              <span>View PDF</span>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
