"use client";

import { Lock, Mail } from "lucide-react";
import Link from "next/link";
import { PasswordPolicyChecklist } from "@/components/auth/password-policy-checklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CitizenAuthHeader from "@/features/citizen/auth/components/citizen-auth-header";
import type { CitizenAuthMode } from "@/features/citizen/auth/types";
import type { PasswordPolicyRuleStatus } from "@/lib/security/password-policy";

type CitizenEmailPasswordStepProps = {
  titleId: string;
  descriptionId: string;
  mode: CitizenAuthMode;
  email: string;
  password: string;
  policyRules: PasswordPolicyRuleStatus[];
  errorMessage: string | null;
  isLoading: boolean;
  disableSubmit: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onToggleMode: () => void;
};

export default function CitizenEmailPasswordStep({
  titleId,
  descriptionId,
  mode,
  email,
  password,
  policyRules,
  errorMessage,
  isLoading,
  disableSubmit,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onToggleMode,
}: CitizenEmailPasswordStepProps) {
  const isLogin = mode === "login";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white px-5 py-6 sm:px-6 sm:py-7 md:p-10">
      <div className="m-auto w-full max-w-[380px] space-y-6 md:max-w-md md:space-y-8">
        <CitizenAuthHeader
          titleId={titleId}
          descriptionId={descriptionId}
          title={isLogin ? "Sign in with Email" : "Create Your Account"}
          description={
            isLogin
              ? "Use your email and password to continue."
              : "Use your email and password. You will verify your email with a 6-digit OTP code."
          }
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4 md:space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="citizen-auth-email" className="text-sm font-medium text-slate-800">
              Email Address
            </Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="citizen-auth-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                data-testid="citizen-auth-email-input"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-xl border-slate-300 bg-white pl-11 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="citizen-auth-password" className="text-sm font-medium text-slate-800">
              Password
            </Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="citizen-auth-password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                data-testid="citizen-auth-password-input"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                className="h-12 rounded-xl border-slate-300 bg-white pl-11 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
          </div>
          {!isLogin && policyRules.length > 0 ? (
            <PasswordPolicyChecklist rules={policyRules} className="space-y-1" />
          ) : null}

          {isLogin ? (
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-[#0B82A1] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              >
                Forgot password?
              </Link>
            </div>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              data-testid="citizen-auth-error"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            data-testid="citizen-auth-submit"
            className="h-12 w-full rounded-xl bg-[#022E45] text-base font-semibold text-white hover:bg-[#01304A] focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            disabled={isLoading || disableSubmit}
          >
            {isLoading
              ? isLogin
                ? "Signing in..."
                : "Creating account..."
              : isLogin
                ? "Sign in"
                : "Create account"}
          </Button>

          <div className="text-center text-sm text-slate-600">
            {isLogin ? "Need an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={onToggleMode}
              className="font-medium text-[#0B82A1] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            >
              {isLogin ? "Create account" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
