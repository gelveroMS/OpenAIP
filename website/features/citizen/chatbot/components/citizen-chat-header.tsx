import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CitizenChatHeader({
  assistantName = "OpenAIP AI Assistant",
  onOpenConversations,
  showConversationsButton = true,
}: {
  assistantName?: string;
  onOpenConversations?: () => void;
  showConversationsButton?: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 bg-[#D3DBE0]/95 px-2 py-1.5 backdrop-blur sm:px-3 sm:py-2">
      <div className="flex items-center gap-2 border-b border-slate-400/80 pb-2 sm:gap-3 sm:pb-2.5">
        {showConversationsButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl text-[#00384B] hover:bg-white/60 md:hidden"
            onClick={onOpenConversations}
            aria-label="Open conversations"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}
        <h2 className="truncate text-xl font-semibold leading-tight tracking-tight text-[#00384B] sm:text-2xl md:text-[30px] md:leading-none">
          {assistantName}
        </h2>
      </div>
    </div>
  );
}
