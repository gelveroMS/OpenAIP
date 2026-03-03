"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Bot } from "lucide-react";
import type { ChatbotRateLimitPolicy } from "@/lib/repos/usage-controls/types";

const toLabel = (value: "per_hour" | "per_day") => (value === "per_day" ? "Per day" : "Per hour");

export default function ChatbotRateLimitsCard({
  policy,
  loading,
  onSave,
}: {
  policy: ChatbotRateLimitPolicy | null;
  loading: boolean;
  onSave: (input: { maxRequests: number; timeWindow: "per_hour" | "per_day" }) => Promise<void>;
}) {
  const [maxRequests, setMaxRequests] = useState(policy?.maxRequests ?? 20);
  const [timeWindow, setTimeWindow] = useState<"per_hour" | "per_day">(
    policy?.timeWindow ?? "per_hour"
  );
  const [saved, setSaved] = useState(false);
  const isValid = Number.isFinite(maxRequests) && maxRequests >= 1;
  const hasChanges = useMemo(() => {
    if (!policy) return false;
    return policy.maxRequests !== maxRequests || policy.timeWindow !== timeWindow;
  }, [maxRequests, policy, timeWindow]);
  const canSave = !loading && isValid && hasChanges;

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({ maxRequests, timeWindow });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-[15px]">Chatbot Request Limits</CardTitle>
            <div className="text-[12px] text-slate-500">
              Control how frequently users can interact with the chatbot
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Max Chatbot Requests</div>
            <Input
              type="number"
              min={1}
              value={maxRequests}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setMaxRequests(Number.isFinite(parsed) ? parsed : 0);
              }}
              className="h-10"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Time Window</div>
            <Select
              value={timeWindow}
              onValueChange={(value) => setTimeWindow(value as "per_hour" | "per_day")}
              disabled={loading}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_hour">Per hour</SelectItem>
                <SelectItem value="per_day">Per day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[12px] text-slate-600">
          <div className="font-medium">
            Current limit: {maxRequests} requests {toLabel(timeWindow).toLowerCase()}
          </div>
          Users exceeding this limit will receive a rate-limit message and may be flagged for excessive usage.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="bg-[#0E5D6F] text-white hover:bg-[#0E5D6F]/90"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save Chatbot Rate Limits
          </Button>
          {saved && (
            <span className="text-[12px] text-emerald-600">
              Rate limits saved successfully.
            </span>
          )}
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
          Audit Logging: Rate limit changes are logged with administrator identity and timestamp.
        </div>
      </CardContent>
    </Card>
  );
}
