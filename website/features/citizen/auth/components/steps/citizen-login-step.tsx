"use client";

import { Lock, Mail } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CitizenAuthHeader from "@/features/citizen/auth/components/citizen-auth-header";

type CitizenLoginStepProps = {
  titleId: string;
  descriptionId: string;
  email: string;
  password: string;
  errorMessage: string | null;
  isLoading: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

export default function CitizenLoginStep({
  titleId,
  descriptionId,
  email,
  password,
  errorMessage,
  isLoading,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: CitizenLoginStepProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white px-5 py-6 sm:px-6 sm:py-7 md:p-10">
      <div className="m-auto w-full max-w-[380px] space-y-6 md:max-w-md md:space-y-8">
        <CitizenAuthHeader
          titleId={titleId}
          descriptionId={descriptionId}
          title="Welcome Back!"
          description="Sign in to monitor your LGU's Annual Investment Plan and public fund allocations."
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4 md:space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="citizen-login-email" className="text-sm font-medium text-slate-800">
              Email Address
            </Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="citizen-login-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-xl border-slate-300 bg-white pl-11 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="citizen-login-password"
              className="text-sm font-medium text-slate-800"
            >
              Password
            </Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="citizen-login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                className="h-12 rounded-xl border-slate-300 bg-white pl-11 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
          </div>

          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-[#0B82A1] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            >
              Forgot password?
            </Link>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full rounded-xl bg-[#022E45] text-base font-semibold text-white hover:bg-[#01304A] focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            disabled={isLoading}
          >
            {isLoading ? "Logging in..." : "Log In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
