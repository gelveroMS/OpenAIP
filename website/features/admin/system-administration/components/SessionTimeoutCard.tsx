"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Timer } from "lucide-react";
import type { SessionTimeoutPolicy } from "@/lib/repos/system-administration/types";

export default function SessionTimeoutCard({
  policy,
  onChange,
}: {
  policy: SessionTimeoutPolicy;
  onChange: (next: SessionTimeoutPolicy) => void;
}) {
  const update = (partial: Partial<SessionTimeoutPolicy>) => onChange({ ...policy, ...partial });

  return (
    <Card className="border-slate-200">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-[15px]">Session Timeout</CardTitle>
            <div className="text-[12px] text-slate-500">Configure auto-logout timing</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Timeout Value</div>
          <Input
            type="number"
            min={1}
            value={policy.timeoutValue}
            onChange={(event) => update({ timeoutValue: Number(event.target.value) })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Time Unit</div>
          <Select
            value={policy.timeUnit}
            onValueChange={(value) =>
              update({ timeUnit: value as SessionTimeoutPolicy["timeUnit"] })
            }
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Warning Minutes Before Auto-Logout</div>
          <Input
            type="number"
            min={0}
            value={policy.warningMinutes}
            onChange={(event) => update({ warningMinutes: Number(event.target.value) })}
            className="h-10"
          />
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
          Current Setting: {policy.timeoutValue} {policy.timeUnit}. Users will be automatically logged
          out after {policy.timeoutValue} {policy.timeUnit} of inactivity. They will receive a warning{" "}
          {policy.warningMinutes} minutes before logout.
        </div>
      </CardContent>
    </Card>
  );
}

