import { Button } from "@/components/ui/button";
import type { CitizenChatFollowUp } from "../types/citizen-chatbot.types";

export default function CitizenChatFollowups({
  followUps,
  onUseFollowUp,
}: {
  followUps: CitizenChatFollowUp[];
  onUseFollowUp: (value: string) => void;
}) {
  if (!followUps.length) return null;

  return (
    <div className="mt-3 grid gap-2">
      {followUps.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant="outline"
          className="h-auto min-h-8 w-full justify-start rounded-xl border-slate-200 bg-white px-3 py-1.5 text-left text-xs leading-snug whitespace-normal break-words text-slate-700 hover:border-[#022437]/40 sm:w-auto sm:max-w-full sm:rounded-full"
          onClick={() => onUseFollowUp(item.label)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
