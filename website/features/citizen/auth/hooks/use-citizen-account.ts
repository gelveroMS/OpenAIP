"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CitizenAccountProfile } from "@/features/citizen/auth/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addCitizenAuthChangedListener } from "@/features/citizen/auth/utils/auth-sync";

type ProfileApiResponse = {
  ok?: boolean;
  error?: {
    message?: string;
  };
} & Partial<CitizenAccountProfile>;

type ProfileStatusResponse = {
  ok?: boolean;
  isComplete?: boolean;
  userId?: string;
  error?: {
    message?: string;
  };
};

type UseCitizenAccountResult = {
  isLoading: boolean;
  isAuthenticated: boolean;
  profile: CitizenAccountProfile | null;
  error: string | null;
  refresh: () => Promise<void>;
};

function toErrorMessage(payload: ProfileApiResponse | null, fallback: string): string {
  const fromPayload = payload?.error?.message;
  if (typeof fromPayload === "string" && fromPayload.trim().length > 0) {
    return fromPayload;
  }
  return fallback;
}

function isCompleteProfilePayload(payload: ProfileApiResponse | null): payload is CitizenAccountProfile {
  if (!payload || payload.ok !== true) return false;
  return (
    typeof payload.fullName === "string" &&
    typeof payload.email === "string" &&
    typeof payload.firstName === "string" &&
    typeof payload.lastName === "string" &&
    typeof payload.barangay === "string" &&
    typeof payload.city === "string" &&
    typeof payload.province === "string"
  );
}

export function useCitizenAccount(): UseCitizenAccountResult {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profile, setProfile] = useState<CitizenAccountProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRefreshRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRefreshRef.current) {
      return inFlightRefreshRef.current;
    }

    const request = (async () => {
      if (mountedRef.current) {
        setIsLoading(true);
      }

      const statusResponse = await fetch("/profile/status", {
        method: "GET",
        cache: "no-store",
      });
      const statusPayload = (await statusResponse.json().catch(() => null)) as ProfileStatusResponse | null;
      if (!mountedRef.current) return;

      if (statusResponse.status === 401) {
        setIsAuthenticated(false);
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (
        !statusResponse.ok ||
        !statusPayload?.ok ||
        typeof statusPayload.userId !== "string" ||
        !statusPayload.userId.trim().length
      ) {
        setIsAuthenticated(false);
        setProfile(null);
        setError(toErrorMessage(statusPayload as ProfileApiResponse | null, "Unable to load account status."));
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);

      const response = await fetch("/profile/me", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ProfileApiResponse | null;
      if (!mountedRef.current) return;

      if (response.status === 401) {
        setIsAuthenticated(false);
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (!response.ok || !isCompleteProfilePayload(payload)) {
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      setProfile(payload);
      setError(null);
      setIsLoading(false);
    })();

    inFlightRefreshRef.current = request;
    try {
      await request;
    } finally {
      if (inFlightRefreshRef.current === request) {
        inFlightRefreshRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();

    const cleanupAuthChanged = addCitizenAuthChangedListener(() => {
      void refresh();
    });
    const handleFocus = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      void refresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
        return;
      }

      if (!session?.user?.id) {
        setIsAuthenticated(false);
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      void refresh();
    });

    return () => {
      cleanupAuthChanged();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      listener.subscription.unsubscribe();
    };
  }, [refresh, supabase.auth]);

  return {
    isLoading,
    isAuthenticated,
    profile,
    error,
    refresh,
  };
}
