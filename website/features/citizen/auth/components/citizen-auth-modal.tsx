"use client";

import { useEffect, useId, useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import CitizenAuthBrandPanel from "@/features/citizen/auth/components/citizen-auth-brand-panel";
import CitizenAuthSplitShell from "@/features/citizen/auth/components/citizen-auth-split-shell";
import CitizenCompleteProfileStep from "@/features/citizen/auth/components/steps/citizen-complete-profile-step";
import CitizenEmailPasswordStep from "@/features/citizen/auth/components/steps/citizen-email-password-step";
import CitizenVerifyOtpStep from "@/features/citizen/auth/components/steps/citizen-verify-otp-step";
import CitizenWelcomeStep from "@/features/citizen/auth/components/steps/citizen-welcome-step";
import type { CitizenAuthMode, CitizenAuthStep } from "@/features/citizen/auth/types";
import type { CitizenAuthLaunchStep } from "@/features/citizen/auth/utils/auth-query";
import {
  clearReturnToFromSessionStorage,
  isSafeNextPath,
  readReturnToFromSessionStorage,
  setReturnToInSessionStorage,
} from "@/features/citizen/auth/utils/auth-query";
import { emitCitizenAuthChanged } from "@/features/citizen/auth/utils/auth-sync";
import { maskEmail } from "@/features/citizen/auth/utils/mask-email";
import { validatePasswordWithPolicy } from "@/lib/security/password-policy";

type CitizenAuthModalProps = {
  isOpen: boolean;
  mode: CitizenAuthMode | null;
  launchStep: CitizenAuthLaunchStep;
  forceCompleteProfile: boolean;
  nextPath: string | null;
  onClose: () => void;
  onModeChange: (mode: CitizenAuthMode | null) => void;
};

type FlowState = {
  step: CitizenAuthStep;
  mode: CitizenAuthMode;
  forceCompleteProfile: boolean;
};

type FlowAction =
  | {
      type: "OPEN";
      mode: CitizenAuthMode | null;
      launchStep: CitizenAuthLaunchStep;
      forceCompleteProfile: boolean;
    }
  | { type: "CONTINUE_WITH_EMAIL" }
  | { type: "TOGGLE_MODE" }
  | { type: "SIGNUP_SENT_OTP" }
  | { type: "LOGIN_NEEDS_PROFILE" }
  | { type: "VERIFY_NEEDS_PROFILE" }
  | { type: "FORCE_COMPLETE_PROFILE" }
  | { type: "RESET" };

const DEFAULT_FLOW_STATE: FlowState = {
  step: "welcome",
  mode: "login",
  forceCompleteProfile: false,
};

function authFlowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "OPEN": {
      const resolvedMode = action.mode ?? "login";
      if (action.forceCompleteProfile) {
        return {
          step: "complete_profile",
          mode: resolvedMode,
          forceCompleteProfile: true,
        };
      }

      return {
        step: action.launchStep === "email" ? "email_password" : "welcome",
        mode: resolvedMode,
        forceCompleteProfile: false,
      };
    }
    case "CONTINUE_WITH_EMAIL":
      if (state.forceCompleteProfile || state.step !== "welcome") return state;
      return { ...state, step: "email_password" };
    case "TOGGLE_MODE":
      if (
        state.forceCompleteProfile ||
        (state.step !== "email_password" && state.step !== "welcome")
      ) {
        return state;
      }
      return {
        ...state,
        step: "email_password",
        mode: state.mode === "login" ? "signup" : "login",
      };
    case "SIGNUP_SENT_OTP":
      if (state.step !== "email_password" || state.mode !== "signup") return state;
      return { ...state, step: "verify_otp" };
    case "LOGIN_NEEDS_PROFILE":
      if (state.step !== "email_password" || state.mode !== "login") return state;
      return { ...state, step: "complete_profile", forceCompleteProfile: true };
    case "VERIFY_NEEDS_PROFILE":
      if (state.step !== "verify_otp") return state;
      return { ...state, step: "complete_profile", forceCompleteProfile: true };
    case "FORCE_COMPLETE_PROFILE":
      return { ...state, step: "complete_profile", forceCompleteProfile: true };
    case "RESET":
      return DEFAULT_FLOW_STATE;
    default:
      return state;
  }
}

function normalizeField(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type ApiErrorPayload = {
  ok?: false;
  error?: { message?: string };
  message?: string;
};

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as (T & ApiErrorPayload) | null;
  if (!response.ok || payload?.ok === false) {
    const message =
      payload?.error?.message ??
      payload?.message ??
      (response.status === 429
        ? "Too many attempts. Please wait and try again."
        : "Request failed.");
    throw new Error(message);
  }

  if (!payload) {
    throw new Error("Missing response payload.");
  }

  return payload as T;
}

type AuthStepResponse = {
  ok: true;
  next: "complete_profile" | "redirect" | "verify_otp";
  message?: string;
};

type ProvinceRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type CityRow = {
  id: string;
  name: string;
  province_id: string | null;
  is_active: boolean;
};

type MunicipalityRow = {
  id: string;
  name: string;
  province_id: string | null;
  is_active: boolean;
};

type BarangayRow = {
  id: string;
  name: string;
  city_id: string | null;
  municipality_id: string | null;
  is_active: boolean;
};

type ProvinceOption = {
  id: string;
  name: string;
};

type LocalityOption = {
  key: string;
  id: string;
  name: string;
  provinceId: string;
  type: "city" | "municipality";
};

type BarangayOption = {
  id: string;
  name: string;
  localityType: "city" | "municipality";
  localityId: string;
};

export default function CitizenAuthModal({
  isOpen,
  mode,
  launchStep,
  forceCompleteProfile,
  nextPath,
  onClose,
  onModeChange,
}: CitizenAuthModalProps) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const [flow, dispatch] = useReducer(authFlowReducer, DEFAULT_FLOW_STATE);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [passwordPolicy, setPasswordPolicy] = useState<{
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialCharacters: boolean;
  } | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [barangay, setBarangay] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");

  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [geoLoadError, setGeoLoadError] = useState<string | null>(null);
  const [geoLoaded, setGeoLoaded] = useState(false);
  const [provinceOptions, setProvinceOptions] = useState<ProvinceOption[]>([]);
  const [localityOptions, setLocalityOptions] = useState<LocalityOption[]>([]);
  const [barangayOptions, setBarangayOptions] = useState<BarangayOption[]>([]);
  const [selectedProvinceId, setSelectedProvinceId] = useState("");
  const [selectedLocalityKey, setSelectedLocalityKey] = useState("");
  const [selectedBarangayId, setSelectedBarangayId] = useState("");

  useEffect(() => {
    if (!isOpen) {
      dispatch({ type: "RESET" });
      setIsLoading(false);
      setErrorMessage(null);
      setInfoMessage(null);
      return;
    }

    dispatch({
      type: "OPEN",
      mode,
      launchStep,
      forceCompleteProfile,
    });
    setIsLoading(false);
    setErrorMessage(null);
    setInfoMessage(null);
  }, [forceCompleteProfile, isOpen, launchStep, mode]);

  useEffect(() => {
    if (forceCompleteProfile) {
      dispatch({ type: "FORCE_COMPLETE_PROFILE" });
    }
  }, [forceCompleteProfile]);

  useEffect(() => {
    if (isSafeNextPath(nextPath)) {
      setReturnToInSessionStorage(nextPath);
    }
  }, [nextPath]);

  useEffect(() => {
    if (!isOpen || geoLoaded) return;

    let active = true;
    const loadGeoOptions = async () => {
      setIsGeoLoading(true);
      setGeoLoadError(null);

      try {
        const supabase = supabaseBrowser();
        const [provincesResult, citiesResult, municipalitiesResult, barangaysResult] =
          await Promise.all([
            supabase
              .from("provinces")
              .select("id,name,is_active")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            supabase
              .from("cities")
              .select("id,name,province_id,is_active")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            supabase
              .from("municipalities")
              .select("id,name,province_id,is_active")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            supabase
              .from("barangays")
              .select("id,name,city_id,municipality_id,is_active")
              .eq("is_active", true)
              .order("name", { ascending: true }),
          ]);

        if (provincesResult.error) throw new Error(provincesResult.error.message);
        if (citiesResult.error) throw new Error(citiesResult.error.message);
        if (municipalitiesResult.error) throw new Error(municipalitiesResult.error.message);
        if (barangaysResult.error) throw new Error(barangaysResult.error.message);
        if (!active) return;

        const provinces = (provincesResult.data ?? []) as ProvinceRow[];
        const cities = (citiesResult.data ?? []) as CityRow[];
        const municipalities = (municipalitiesResult.data ?? []) as MunicipalityRow[];
        const barangays = (barangaysResult.data ?? []) as BarangayRow[];

        const nextProvinceOptions: ProvinceOption[] = provinces.map((row) => ({
          id: row.id,
          name: row.name,
        }));

        const nextLocalityOptions: LocalityOption[] = [
          ...cities
            .filter((row) => typeof row.province_id === "string" && row.province_id.length > 0)
            .map((row) => ({
              key: `city:${row.id}`,
              id: row.id,
              name: row.name,
              provinceId: row.province_id as string,
              type: "city" as const,
            })),
          ...municipalities
            .filter((row) => typeof row.province_id === "string" && row.province_id.length > 0)
            .map((row) => ({
              key: `municipality:${row.id}`,
              id: row.id,
              name: row.name,
              provinceId: row.province_id as string,
              type: "municipality" as const,
            })),
        ];

        const nextBarangayOptions: BarangayOption[] = barangays
          .map((row) => {
            if (row.city_id) {
              return {
                id: row.id,
                name: row.name,
                localityType: "city" as const,
                localityId: row.city_id,
              };
            }
            if (row.municipality_id) {
              return {
                id: row.id,
                name: row.name,
                localityType: "municipality" as const,
                localityId: row.municipality_id,
              };
            }
            return null;
          })
          .filter((row): row is BarangayOption => row !== null);

        setProvinceOptions(nextProvinceOptions);
        setLocalityOptions(nextLocalityOptions);
        setBarangayOptions(nextBarangayOptions);
        setGeoLoaded(true);
      } catch (error) {
        if (!active) return;
        setGeoLoadError(
          error instanceof Error ? error.message : "Unable to load location options."
        );
      } finally {
        if (active) {
          setIsGeoLoading(false);
        }
      }
    };

    void loadGeoOptions();

    return () => {
      active = false;
    };
  }, [geoLoaded, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadPolicy = async () => {
      try {
        const response = await fetch("/api/system/security-policy", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              securitySettings?: {
                passwordPolicy?: {
                  minLength: number;
                  requireUppercase: boolean;
                  requireLowercase: boolean;
                  requireNumbers: boolean;
                  requireSpecialCharacters: boolean;
                };
              };
            }
          | null;
        if (!active) return;
        if (!response.ok || !payload?.securitySettings?.passwordPolicy) return;
        setPasswordPolicy(payload.securitySettings.passwordPolicy);
      } catch {
        // Ignore policy fetch errors and rely on server-side validation.
      }
    };
    void loadPolicy();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const availableLocalityOptions = useMemo(
    () =>
      localityOptions.filter(
        (option) =>
          selectedProvinceId.length > 0 && option.provinceId === selectedProvinceId
      ),
    [localityOptions, selectedProvinceId]
  );

  const selectedLocality = useMemo(
    () =>
      availableLocalityOptions.find((option) => option.key === selectedLocalityKey) ??
      null,
    [availableLocalityOptions, selectedLocalityKey]
  );

  const availableBarangayOptions = useMemo(() => {
    if (!selectedLocality) return [];
    return barangayOptions.filter(
      (option) =>
        option.localityType === selectedLocality.type &&
        option.localityId === selectedLocality.id
    );
  }, [barangayOptions, selectedLocality]);

  const resolveReturnTo = (): string | null => {
    if (isSafeNextPath(nextPath)) {
      return nextPath;
    }
    return readReturnToFromSessionStorage();
  };

  const closeAndRedirect = (input?: { authChanged?: boolean }) => {
    const target = resolveReturnTo();
    clearReturnToFromSessionStorage();
    if (input?.authChanged) {
      emitCitizenAuthChanged();
      router.refresh();
    }

    if (target) {
      router.replace(target);
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.replace("/");
  };

  const toggleMode = () => {
    if (flow.forceCompleteProfile) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(false);
    const nextMode: CitizenAuthMode = flow.mode === "login" ? "signup" : "login";
    dispatch({ type: "TOGGLE_MODE" });
    onModeChange(nextMode);
  };

  const handleContinueWithEmail = () => {
    setErrorMessage(null);
    setInfoMessage(null);
    dispatch({ type: "CONTINUE_WITH_EMAIL" });
    onModeChange(flow.mode);
  };

  const handleContinueWithGoogle = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(true);
    try {
      const supabase = supabaseBrowser();
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/confirm` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (error) {
        throw error;
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to continue with Google.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailPasswordSubmit = async () => {
    if (!isValidEmail(email) || !password) {
      setErrorMessage("Please enter a valid email and password.");
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(true);

    try {
      if (flow.mode === "signup") {
        if (passwordPolicy) {
          const errors = validatePasswordWithPolicy(password, passwordPolicy);
          if (errors.length > 0) {
            throw new Error(errors[0]);
          }
        }
        await postJson<AuthStepResponse>("/auth/sign-up", {
          email: email.trim().toLowerCase(),
          password,
        });
        setOtpEmail(email.trim().toLowerCase());
        setOtpCode("");
        setInfoMessage("OTP sent to your email.");
        dispatch({ type: "SIGNUP_SENT_OTP" });
        return;
      }

      const response = await postJson<AuthStepResponse>("/auth/sign-in", {
        email: email.trim().toLowerCase(),
        password,
      });

      if (response.next === "complete_profile") {
        dispatch({ type: "LOGIN_NEEDS_PROFILE" });
        return;
      }

      closeAndRedirect({ authChanged: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to continue.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      setErrorMessage("Please enter the 6-digit verification code.");
      return;
    }
    if (!isValidEmail(otpEmail)) {
      setErrorMessage("Sign-up email is missing. Please create your account again.");
      dispatch({ type: "OPEN", mode: "signup", launchStep: "email", forceCompleteProfile: false });
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(true);

    try {
      const response = await postJson<AuthStepResponse>("/auth/verify-otp", {
        email: otpEmail,
        token: otpCode,
      });

      if (response.next === "complete_profile") {
        dispatch({ type: "VERIFY_NEEDS_PROFILE" });
        return;
      }

      closeAndRedirect({ authChanged: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to verify OTP code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isValidEmail(otpEmail)) {
      setErrorMessage("Sign-up email is missing. Please create your account again.");
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(true);
    try {
      const response = await postJson<{ ok: true; message?: string }>("/auth/resend-otp", {
        email: otpEmail,
      });
      setInfoMessage(response.message ?? "A new code has been sent.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to resend OTP code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteProfile = async () => {
    const normalizedFirstName = normalizeField(firstName);
    const normalizedLastName = normalizeField(lastName);
    const normalizedBarangay = normalizeField(barangay);
    const normalizedCity = normalizeField(city);
    const normalizedProvince = normalizeField(province);

    if (
      !normalizedFirstName ||
      !normalizedLastName ||
      !normalizedBarangay ||
      !normalizedCity ||
      !normalizedProvince
    ) {
      setErrorMessage("All profile fields are required.");
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsLoading(true);

    try {
      await postJson<{ ok: true }>("/profile/complete", {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        barangay: normalizedBarangay,
        city: normalizedCity,
        province: normalizedProvince,
      });

      closeAndRedirect({ authChanged: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save profile.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleProvinceChange = (value: string) => {
    setSelectedProvinceId(value);
    setSelectedLocalityKey("");
    setSelectedBarangayId("");
    setCity("");
    setBarangay("");
    const selected = provinceOptions.find((option) => option.id === value) ?? null;
    setProvince(selected?.name ?? "");
  };

  const handleLocalityChange = (value: string) => {
    setSelectedLocalityKey(value);
    setSelectedBarangayId("");
    setBarangay("");
    const selected = availableLocalityOptions.find((option) => option.key === value) ?? null;
    setCity(selected?.name ?? "");
  };

  const handleBarangayChange = (value: string) => {
    setSelectedBarangayId(value);
    const selected = availableBarangayOptions.find((option) => option.id === value) ?? null;
    setBarangay(selected?.name ?? "");
  };

  const formPanel = (() => {
    if (flow.step === "welcome") {
      return (
        <CitizenWelcomeStep
          titleId={titleId}
          descriptionId={descriptionId}
          errorMessage={errorMessage}
          isLoading={isLoading}
          showGoogleButton={process.env.NEXT_PUBLIC_SUPABASE_GOOGLE_ENABLED === "true"}
          onContinueWithEmail={handleContinueWithEmail}
          onContinueWithGoogle={() => {
            void handleContinueWithGoogle();
          }}
        />
      );
    }

    if (flow.step === "email_password") {
      return (
        <CitizenEmailPasswordStep
          titleId={titleId}
          descriptionId={descriptionId}
          mode={flow.mode}
          email={email}
          password={password}
          errorMessage={errorMessage}
          isLoading={isLoading}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={() => {
            void handleEmailPasswordSubmit();
          }}
          onToggleMode={toggleMode}
        />
      );
    }

    if (flow.step === "verify_otp") {
      return (
        <CitizenVerifyOtpStep
          titleId={titleId}
          descriptionId={descriptionId}
          emailMasked={maskEmail(otpEmail)}
          code={otpCode}
          errorMessage={errorMessage}
          infoMessage={infoMessage}
          isLoading={isLoading}
          onCodeChange={setOtpCode}
          onSubmit={() => {
            void handleVerifyOtp();
          }}
          onResendCode={() => {
            void handleResendCode();
          }}
        />
      );
    }

    return (
      <CitizenCompleteProfileStep
        titleId={titleId}
        descriptionId={descriptionId}
        firstName={firstName}
        lastName={lastName}
        provinceId={selectedProvinceId}
        cityOrMunicipalityId={selectedLocalityKey}
        barangayId={selectedBarangayId}
        provinceOptions={provinceOptions.map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        cityOrMunicipalityOptions={availableLocalityOptions.map((option) => ({
          value: option.key,
          label:
            option.type === "city"
              ? `City: ${option.name}`
              : `Municipality: ${option.name}`,
        }))}
        barangayOptions={availableBarangayOptions.map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        isGeoLoading={isGeoLoading}
        geoLoadError={geoLoadError}
        errorMessage={errorMessage}
        isLoading={isLoading}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
        onProvinceChange={handleProvinceChange}
        onCityOrMunicipalityChange={handleLocalityChange}
        onBarangayChange={handleBarangayChange}
        onSubmit={() => {
          void handleCompleteProfile();
        }}
      />
    );
  })();

  return (
    <CitizenAuthSplitShell
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      canClose={!flow.forceCompleteProfile}
      titleId={titleId}
      descriptionId={descriptionId}
      formFirst={flow.step === "welcome" || flow.step === "email_password"}
      formPanel={formPanel}
      brandPanel={
        <CitizenAuthBrandPanel
          variant={flow.mode === "login" ? "signup_cta" : "login_cta"}
          onToggleAuth={toggleMode}
          disableToggle={flow.forceCompleteProfile || flow.step === "complete_profile"}
        />
      }
    />
  );
}
