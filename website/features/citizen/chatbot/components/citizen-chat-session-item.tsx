"use client";

import { useRef, useState } from "react";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useFinePointer } from "@/lib/ui/use-fine-pointer";
import { cn } from "@/lib/ui/utils";
import type { CitizenChatSessionVM } from "../types/citizen-chatbot.types";

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 200;

export default function CitizenChatSessionItem({
  session,
  onSelect,
  onRename,
  onDelete,
}: {
  session: CitizenChatSessionVM;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const [isBusy, setIsBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const skipBlurSaveRef = useRef(false);
  const isFinePointer = useFinePointer();

  const beginRename = () => {
    setDraftTitle(session.title);
    setRenameError(null);
    setIsEditing(true);
  };

  const cancelRename = () => {
    setRenameError(null);
    setIsEditing(false);
    setDraftTitle(session.title);
  };

  const saveRename = async () => {
    const nextTitle = draftTitle.trim();
    if (nextTitle.length < TITLE_MIN_LENGTH || nextTitle.length > TITLE_MAX_LENGTH) {
      setRenameError(`Title must be ${TITLE_MIN_LENGTH} to ${TITLE_MAX_LENGTH} characters.`);
      return;
    }

    if (nextTitle === session.title.trim()) {
      cancelRename();
      return;
    }

    setIsBusy(true);
    try {
      await onRename(session.id, nextTitle);
      setRenameError(null);
      setIsEditing(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Failed to rename conversation.");
    } finally {
      setIsBusy(false);
    }
  };

  const confirmDelete = async () => {
    setIsBusy(true);
    try {
      await onDelete(session.id);
      setDeleteError(null);
      setIsDeleting(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete conversation.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "group w-full border-l-4 border-transparent bg-white px-4 py-4 text-left transition-all hover:bg-slate-50",
          session.isActive && "border-l-[#022437] bg-[#f5f8fa]"
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <div className="space-y-1">
                <Input
                  value={draftTitle}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                    if (renameError) setRenameError(null);
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
                  autoFocus
                  maxLength={TITLE_MAX_LENGTH}
                  className="h-8 text-xs"
                />
                {renameError ? <p className="text-xs text-rose-600">{renameError}</p> : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="w-full text-left"
              >
                <h3 className="truncate text-sm font-semibold text-slate-900">{session.title}</h3>
              </button>
            )}
          </div>

          {isFinePointer ? (
            <div
              data-testid={`session-actions-inline-${session.id}`}
              className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={beginRename}
                disabled={isBusy}
                aria-label={`Rename ${session.title}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-rose-700 hover:text-rose-700"
                onClick={() => {
                  setDeleteError(null);
                  setIsDeleting(true);
                }}
                disabled={isBusy}
                aria-label={`Delete ${session.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={isBusy}
                  aria-label={`Session actions for ${session.title}`}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onSelect={beginRename} disabled={isBusy}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setDeleteError(null);
                    setIsDeleting(true);
                  }}
                  disabled={isBusy}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Dialog
        open={isDeleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteError(null);
          }
          setIsDeleting(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This will permanently remove <span className="font-medium">{session.title}</span> and its messages.
            </DialogDescription>
            {deleteError ? <p className="text-xs text-rose-600">{deleteError}</p> : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsDeleting(false);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={isBusy}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
