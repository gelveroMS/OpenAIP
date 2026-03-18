import { SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CitizenChatComposerMode } from "../types/citizen-chatbot.types";

export default function CitizenChatComposer({
  mode,
  value,
  isSending,
  placeholder,
  disabled,
  onChange,
  onPrimaryAction,
}: {
  mode: CitizenChatComposerMode;
  value: string;
  isSending: boolean;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPrimaryAction: () => void;
}) {
  const isSendMode = mode === "send";
  const primaryLabel =
    mode === "sign_in" ? "Sign In" : mode === "complete_profile" ? "Complete Profile" : "Send";
  const helperText = isSendMode
    ? "Shift+Enter for new line"
    : mode === "sign_in"
      ? "Sign in required to use the AI Assistant."
      : mode === "complete_profile"
        ? "Complete your profile to start chatting."
        : isSending
          ? "Please wait..."
          : "Authentication required";

  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-300/70 bg-[#D3DBE0]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.55rem)] pt-2 backdrop-blur sm:px-5 sm:pt-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3">
        <div className="flex items-end gap-2.5">
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (!isSendMode) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onPrimaryAction();
              }
            }}
            placeholder={placeholder}
            disabled={!isSendMode || disabled}
            aria-label="Chat message input"
            className="min-h-11 max-h-36 resize-none border-0 px-2 py-2 text-sm leading-6 shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            className="h-10 shrink-0 rounded-xl bg-[#022437] px-4 text-white hover:bg-[#011c2a]"
            onClick={onPrimaryAction}
            disabled={isSendMode ? disabled || !value.trim().length : disabled}
          >
            {isSendMode ? <SendHorizonal className="mr-2 h-4 w-4" /> : null}
            {primaryLabel}
          </Button>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-500 sm:mt-2">{helperText}</p>
    </div>
  );
}
