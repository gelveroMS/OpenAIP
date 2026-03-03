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
import { ShieldAlert } from "lucide-react";
import type { LoginAttemptPolicy } from "@/lib/repos/system-administration/types";

export default function LoginAttemptLimitsCard({
  policy,
  onChange,
}: {
  policy: LoginAttemptPolicy;
  onChange: (next: LoginAttemptPolicy) => void;
}) {
  const update = (partial: Partial<LoginAttemptPolicy>) => onChange({ ...policy, ...partial });

  return (
    <Card className="border-slate-200">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-[15px]">Login Attempt Limits</CardTitle>
            <div className="text-[12px] text-slate-500">Prevent brute-force attacks</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Maximum Login Attempts</div>
          <Input
            type="number"
            min={1}
            value={policy.maxAttempts}
            onChange={(event) => update({ maxAttempts: Number(event.target.value) })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Lockout Duration</div>
          <Input
            type="number"
            min={1}
            value={policy.lockoutDuration}
            onChange={(event) => update({ lockoutDuration: Number(event.target.value) })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Lockout Unit</div>
          <Select
            value={policy.lockoutUnit}
            onValueChange={(value) => update({ lockoutUnit: value as LoginAttemptPolicy["lockoutUnit"] })}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
          Current Policy: After {policy.maxAttempts} failed login attempts, accounts will be locked for{" "}
          {policy.lockoutDuration} {policy.lockoutUnit}.
        </div>
      </CardContent>
    </Card>
  );
}

