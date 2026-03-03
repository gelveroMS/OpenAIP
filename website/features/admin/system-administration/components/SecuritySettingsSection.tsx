"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SecuritySettings } from "@/lib/repos/system-administration/types";
import PasswordPolicyCard from "./PasswordPolicyCard";
import SessionTimeoutCard from "./SessionTimeoutCard";
import LoginAttemptLimitsCard from "./LoginAttemptLimitsCard";
import ConfirmSecuritySettingsModal from "./ConfirmSecuritySettingsModal";

export default function SecuritySettingsSection({
  settings,
  loading,
  onSave,
}: {
  settings: SecuritySettings;
  loading: boolean;
  onSave: (next: SecuritySettings) => Promise<void>;
}) {
  const [passwordPolicy, setPasswordPolicy] = useState(settings.passwordPolicy);
  const [sessionTimeout, setSessionTimeout] = useState(settings.sessionTimeout);
  const [loginAttemptLimits, setLoginAttemptLimits] = useState(settings.loginAttemptLimits);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const localSettings: SecuritySettings = useMemo(
    () => ({
      passwordPolicy,
      sessionTimeout,
      loginAttemptLimits,
    }),
    [passwordPolicy, sessionTimeout, loginAttemptLimits]
  );

  const timeoutMinutes =
    sessionTimeout.timeUnit === "minutes"
      ? sessionTimeout.timeoutValue
      : sessionTimeout.timeUnit === "hours"
        ? sessionTimeout.timeoutValue * 60
        : sessionTimeout.timeoutValue * 24 * 60;

  const isValid =
    passwordPolicy.minLength >= 6 &&
    sessionTimeout.timeoutValue >= 1 &&
    sessionTimeout.warningMinutes >= 0 &&
    sessionTimeout.warningMinutes < timeoutMinutes &&
    loginAttemptLimits.maxAttempts >= 1 &&
    loginAttemptLimits.lockoutDuration >= 1;
  const hasChanges = JSON.stringify(localSettings) !== JSON.stringify(settings);

  const handleConfirm = async () => {
    await onSave(localSettings);
    setConfirmOpen(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[15px] font-semibold text-slate-900">Security Settings</div>
        <div className="text-[13.5px] text-slate-500">
          Configure authentication and session security policies for all system users.
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <PasswordPolicyCard policy={passwordPolicy} onChange={setPasswordPolicy} />
        <SessionTimeoutCard policy={sessionTimeout} onChange={setSessionTimeout} />
        <LoginAttemptLimitsCard policy={loginAttemptLimits} onChange={setLoginAttemptLimits} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="bg-[#0E5D6F] text-white hover:bg-[#0E5D6F]/90"
          onClick={() => setConfirmOpen(true)}
          disabled={!isValid || !hasChanges || loading}
        >
          Save Security Settings
        </Button>
      </div>

      <div className="rounded-lg bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
        Audit Logging: All security setting changes are logged with administrator identity, timestamp,
        and previous values for compliance and security auditing.
      </div>

      <ConfirmSecuritySettingsModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleConfirm}
        confirmDisabled={!isValid || !hasChanges || loading}
      />
    </div>
  );
}

