"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GUIDELINES = [
  {
    title: "Attendance Sheets",
    description: "Contains signatures and personal attendance records",
  },
  {
    title: "Government IDs & Signatures",
    description: "ID numbers, photos, signatures visible in documents",
  },
  {
    title: "Beneficiary Personal Info",
    description: "Names with addresses, phone numbers, financial details",
  },
  {
    title: "Inappropriate Images",
    description: "Medical records, sensitive documents, improper content",
  },
];

const ACTIONS = [
  "Hide if content clearly violates privacy or contains sensitive data",
  "Unhide once compliance issues are resolved and restoration is approved",
];

export default function SensitiveGuidelinesPanel() {
  return (
    <Card className="border-slate-200">
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-slate-600" />
        <CardTitle className="text-[15px]">Sensitive Content Guidelines</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-[13.5px] text-slate-600">
        <div className="space-y-3">
          {GUIDELINES.map((item) => (
            <div key={item.title} className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
              <div>
                <div className="font-medium text-slate-900">{item.title}</div>
                <div className="text-xs text-slate-500">{item.description}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 pt-3">
          <div className="text-sm font-medium text-slate-900">Recommended Actions</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
            {ACTIONS.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          Remember: Content is never permanently deleted. All actions are logged for accountability.
        </div>
      </CardContent>
    </Card>
  );
}
