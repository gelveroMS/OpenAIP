"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/utils";
import type { ChatSessionListItem } from "../types/chat.types";

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 200;

export default function ChatSessionsPanel({
  sessions,
  query,
  isLoading = false,
  onQueryChange,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  compact = false,
}: {
  sessions: ChatSessionListItem[];
  query: string;
  isLoading?: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  compact?: boolean;
}) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const skipBlurSaveRef = useRef(false);

  const beginRename = (session: ChatSessionListItem) => {
    setEditingSessionId(session.id);
    setEditingValue(session.title);
    setEditingError(null);
  };

  const cancelRename = () => {
    setEditingSessionId(null);
    setEditingValue("");
    setEditingError(null);
  };

  const saveRename = async () => {
    if (!editingSessionId) return;
    const nextTitle = editingValue.trim();
    const current = sessions.find((session) => session.id === editingSessionId);
    if (!current) {
      cancelRename();
      return;
    }

    if (nextTitle.length < TITLE_MIN_LENGTH || nextTitle.length > TITLE_MAX_LENGTH) {
      setEditingError(`Title must be ${TITLE_MIN_LENGTH} to ${TITLE_MAX_LENGTH} characters.`);
      return;
    }
    if (nextTitle === current.title.trim()) {
      cancelRename();
      return;
    }

    setBusySessionId(editingSessionId);
    try {
      await onRename(editingSessionId, nextTitle);
      cancelRename();
    } catch (error) {
      setEditingError(error instanceof Error ? error.message : "Failed to rename conversation.");
    } finally {
      setBusySessionId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusySessionId(deleteTarget.id);
    try {
      await onDelete(deleteTarget.id);
      setDeleteError(null);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete conversation.");
    } finally {
      setBusySessionId(null);
    }
  };

  return (
    <>
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border bg-card",
          compact ? "rounded-none shadow-none" : "rounded-2xl shadow-sm"
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between border-b",
            compact ? "px-4 py-3" : "px-5 py-4"
          )}
        >
          <div className="text-base font-semibold">Conversations</div>
          <Button
            className={cn(
              "gap-2 rounded-lg text-xs",
              compact ? "h-9 px-2.5" : "h-8 px-2.5"
            )}
            onClick={onNewChat}
            disabled={isLoading}
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        <div className={cn("shrink-0", compact ? "p-3" : "p-4")}>
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search chats"
              className="h-10 pl-9 text-[13.5px]"
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className={cn("space-y-2", compact ? "px-4 py-3" : "px-5 py-4")}>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`loading-session-${index}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
                  <div className="mt-2 h-3 w-20 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          ) : null}

          {!isLoading &&
            sessions.map((session) => {
              const isEditing = editingSessionId === session.id;
              const isBusy = busySessionId === session.id;

              return (
                <div
                  key={session.id}
                  className={cn(
                    "border-l-2 transition-colors",
                    compact ? "px-4 py-3" : "px-5 py-4",
                    session.isActive ? "border-primary bg-muted/50" : "border-transparent hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-1">
                          <Input
                            value={editingValue}
                            onChange={(event) => {
                              setEditingValue(event.target.value);
                              if (editingError) {
                                setEditingError(null);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveRename();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                skipBlurSaveRef.current = true;
                                cancelRename();
                              }
                            }}
                            onBlur={() => {
                              if (skipBlurSaveRef.current) {
                                skipBlurSaveRef.current = false;
                                return;
                              }
                              void saveRename();
                            }}
                            maxLength={TITLE_MAX_LENGTH}
                            autoFocus
                            className="h-8 text-xs"
                          />
                          {editingError ? (
                            <div className="text-destructive text-[11px]">{editingError}</div>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelect(session.id)}
                          onDoubleClick={() => beginRename(session)}
                          className="w-full min-h-10 text-left"
                        >
                          <div className="truncate text-sm font-semibold">{session.title}</div>
                        </button>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="text-muted-foreground text-[11px]">{session.timeLabel}</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(compact ? "h-8 w-8" : "h-7 w-7")}
                        onClick={() => beginRename(session)}
                        disabled={isBusy}
                        aria-label={`Rename ${session.title}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          compact ? "h-8 w-8 text-rose-700 hover:text-rose-700" : "h-7 w-7 text-rose-700 hover:text-rose-700"
                        )}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(session);
                        }}
                        disabled={isBusy}
                        aria-label={`Delete ${session.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}

          {!isLoading && !sessions.length && (
            <div className={cn("text-muted-foreground text-sm", compact ? "px-4 pb-4" : "px-5 pb-6")}>
              No conversations found.
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This will permanently remove
              {" "}
              <span className="font-medium">{deleteTarget?.title ?? "this chat"}</span>
              {" "}
              and its messages.
            </DialogDescription>
            {deleteError ? <div className="text-destructive text-xs">{deleteError}</div> : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={!deleteTarget || busySessionId === deleteTarget.id}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
