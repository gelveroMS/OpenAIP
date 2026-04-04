import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { CitizenChatEvidenceItem } from "../types/citizen-chatbot.types";

export default function CitizenChatEvidence({
  evidence,
}: {
  evidence: CitizenChatEvidenceItem[];
}) {
  if (!evidence.length) return null;

  return (
    <details className="group mt-3 rounded-lg bg-slate-50 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-slate-700">
        <span>Evidence ({evidence.length})</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-3 space-y-2">
        {evidence.map((entry) => (
          <article key={entry.id} className="rounded-md bg-white p-3">
            <p className="text-xs font-semibold text-slate-700">{entry.documentLabel}</p>
            {entry.href && entry.linkLabel ? (
              <Link
                href={entry.href}
                className="mt-1 inline-block text-xs text-[#0247A1] underline decoration-[#0247A1]/60 underline-offset-2 hover:decoration-[#0247A1]"
              >
                {entry.linkLabel}
              </Link>
            ) : (
              <p className="mt-1 text-xs text-slate-600">{entry.snippet}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
              {entry.fiscalYear ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{entry.fiscalYear}</span>
              ) : null}
              {entry.pageOrSection ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{entry.pageOrSection}</span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
