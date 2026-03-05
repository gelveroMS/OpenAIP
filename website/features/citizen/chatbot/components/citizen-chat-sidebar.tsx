import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CitizenChatEmptyConversations from "./citizen-chat-empty-conversations";
import CitizenChatSessionItem from "./citizen-chat-session-item";
import type { CitizenChatSessionVM } from "../types/citizen-chatbot.types";

export default function CitizenChatSidebar({
  canManageConversations,
  query,
  sessions,
  onQueryChange,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: {
  canManageConversations: boolean;
  query: string;
  sessions: CitizenChatSessionVM[];
  onQueryChange: (value: string) => void;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Conversations</h2>
          {canManageConversations ? (
            <Button className="h-10 gap-2 rounded-xl bg-[#022437] px-4 text-white hover:bg-[#011c2a]" onClick={onNewChat}>
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          ) : null}
        </div>

        {canManageConversations ? (
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search chats"
              className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-9 text-sm focus-visible:ring-[#022437]/30"
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length ? (
          sessions.map((session) => (
            <CitizenChatSessionItem
              key={session.id}
              session={session}
              onSelect={onSelectSession}
              onRename={onRenameSession}
              onDelete={onDeleteSession}
            />
          ))
        ) : (
          <div className="p-4">
            <CitizenChatEmptyConversations anonymous={!canManageConversations} />
          </div>
        )}
      </div>
    </aside>
  );
}
