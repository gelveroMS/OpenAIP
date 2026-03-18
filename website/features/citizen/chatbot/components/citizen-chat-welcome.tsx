import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CitizenChatWelcome({
  examples,
  onUseExample,
}: {
  examples: readonly string[];
  onUseExample: (value: string) => void;
}) {
  return (
    <div className="mx-auto mt-2 w-full max-w-3xl rounded-2xl bg-transparent px-1 py-2 text-center sm:mt-4 sm:px-4 sm:py-4">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#022437]/10 text-[#022437] sm:h-11 sm:w-11">
        <Bot className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:mt-3.5 sm:text-2xl">
        Welcome to the OpenAIP AI Assistant
      </h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
        Ask about budgets, sector allocations, and projects. Responses are grounded in published Annual Investment Plan records only.
      </p>

      <p className="mt-4 text-sm font-semibold text-slate-700 sm:mt-5">Example Queries</p>
      <div className="mt-2 grid gap-2">
        {examples.map((example) => (
          <Button
            key={example}
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-start rounded-xl border-slate-200 bg-white px-3 py-2 text-left text-[13px] leading-snug text-slate-700 hover:border-[#022437]/30 sm:text-sm"
            onClick={() => onUseExample(example)}
          >
            {example}
          </Button>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-500 sm:mt-4">Tip: Try specifying fiscal year and scope for faster results.</p>
    </div>
  );
}
