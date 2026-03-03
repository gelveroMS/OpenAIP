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
import { MessageSquare } from "lucide-react";
import type { RateLimitSettingsVM } from "@/lib/repos/usage-controls/types";

export default function CommentRateLimitsCard({
  settings,
  loading,
  onSave,
}: {
  settings: RateLimitSettingsVM | null;
  loading: boolean;
  onSave: (input: { maxComments: number; timeWindow: "hour" | "day" }) => Promise<void>;
}) {
  const [maxComments, setMaxComments] = useState(settings?.maxComments ?? 5);
  const [timeWindow, setTimeWindow] = useState<"hour" | "day">(
    settings?.timeWindow ?? "hour"
  );
  const [saved, setSaved] = useState(false);
  const isValid = Number.isFinite(maxComments) && maxComments >= 1;
  const hasChanges = useMemo(() => {
    if (!settings) return false;
    return settings.maxComments !== maxComments || settings.timeWindow !== timeWindow;
  }, [maxComments, settings, timeWindow]);
  const canSave = !loading && isValid && hasChanges;

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({ maxComments, timeWindow });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-[15px]">Feedback Submission Limits</CardTitle>
            <div className="text-[12px] text-slate-500">
              Control how frequently users can submit feedback
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Max Feedback</div>
            <Input
              type="number"
              min={1}
              value={maxComments}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setMaxComments(Number.isFinite(parsed) ? parsed : 0);
              }}
              className="h-10"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Time Window</div>
            <Select
              value={timeWindow}
              onValueChange={(value) => setTimeWindow(value as "hour" | "day")}
              disabled={loading}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Per hour</SelectItem>
                <SelectItem value="day">Per day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[12px] text-slate-600">
          <div className="font-medium">
            Current limit: {maxComments} feedback entries per {timeWindow}
          </div>
          Users exceeding this limit will be temporarily rate-limited and may be flagged for review.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="bg-[#0E5D6F] text-white hover:bg-[#0E5D6F]/90"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save Feedback Rate Limits
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
