"use client";

import { CheckCircle2, Circle } from "lucide-react";
import type { PasswordPolicyRuleStatus } from "@/lib/security/password-policy";

type PasswordPolicyChecklistProps = {
  rules: PasswordPolicyRuleStatus[];
  className?: string;
};

export function PasswordPolicyChecklist({ rules, className }: PasswordPolicyChecklistProps) {
  if (rules.length === 0) return null;

  return (
    <ul className={className ?? "space-y-1"} aria-label="Password requirements">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={`flex items-center gap-2 text-sm ${
            rule.passed ? "text-emerald-700" : "text-slate-600"
          }`}
        >
          {rule.passed ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Circle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}
