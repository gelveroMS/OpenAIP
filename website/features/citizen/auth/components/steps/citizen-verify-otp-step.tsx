"use client";

import { Button } from "@/components/ui/button";
import CitizenAuthHeader from "@/features/citizen/auth/components/citizen-auth-header";
import CitizenOtpInput from "@/features/citizen/auth/components/citizen-otp-input";

type CitizenVerifyOtpStepProps = {
  titleId: string;
  descriptionId: string;
  emailMasked: string;
  code: string;
  errorMessage: string | null;
  infoMessage?: string | null;
  isLoading: boolean;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  onResendCode: () => void;
};

export default function CitizenVerifyOtpStep({
  titleId,
  descriptionId,
  emailMasked,
  code,
  errorMessage,
  infoMessage = null,
  isLoading,
  onCodeChange,
  onSubmit,
  onResendCode,
}: CitizenVerifyOtpStepProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white px-5 py-6 sm:px-6 sm:py-7 md:p-10">
      <div className="m-auto w-full max-w-[380px] space-y-6 md:max-w-md md:space-y-8">
        <CitizenAuthHeader
          titleId={titleId}
          descriptionId={descriptionId}
          title="Verify Your Email"
          description={`We've sent a verification code to ${emailMasked}. Enter the code below to continue.`}
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-5 md:space-y-6"
        >
          <CitizenOtpInput value={code} onChange={onCodeChange} disabled={isLoading} />

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          ) : null}

          {!errorMessage && infoMessage ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {infoMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full rounded-xl bg-[#022E45] text-base font-semibold text-white hover:bg-[#01304A] focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            disabled={isLoading}
          >
            {isLoading ? "Verifying..." : "Continue"}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={onResendCode}
              className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              disabled={isLoading}
            >
              Resend code
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
