"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { AipHeader } from "../types";
import { peso } from "../utils";


export function AipUploaderInfo({ aip }: { aip: AipHeader }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="px-6">
        <h3 className="text-lg font-semibold text-slate-900">Uploader Information</h3>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-28">Name:</dt>
            <dd className="text-slate-800">{aip.uploader.name}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-slate-500 w-28">Role:</dt>
            <dd className="text-slate-800">{aip.uploader.role}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-slate-500 w-28">Upload Date:</dt>
            <dd className="text-slate-800">{aip.uploader.uploadDate}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-slate-500 w-28">Budget Allocated:</dt>
            <dd className="text-slate-800 font-semibold text-[#022437]">
              {peso(aip.uploader.budgetAllocated)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
