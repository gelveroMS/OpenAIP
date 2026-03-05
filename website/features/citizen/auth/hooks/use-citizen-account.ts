"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CitizenAccountProfile } from "@/features/citizen/auth/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addCitizenAuthChangedListener } from "@/features/citizen/auth/utils/auth-sync";
import {
  getCitizenProfileStatus,
  invalidateCitizenProfileStatusCache,
} from "@/features/citizen/auth/utils/profile-status-client";

type ProfileApiResponse = {
  ok?: boolean;
  error?: {
    message?: string;
  };
} & Partial<CitizenAccountProfile>;

type UseCitizenAccountResult = {
  isLoading: boolean;
  isAuthenticated: boolean;
  profile: CitizenAccountProfile | null;
  error: string | null;
  refresh: () => Promise<void>;
};

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

  const refreshInternal = useCallback(async (force = false) => {
    if (inFlightRefreshRef.current) {
      return inFlightRefreshRef.current;
    }

    const request = (async () => {
      if (mountedRef.current) {
        setIsLoading(true);
      }

      const statusResult = await getCitizenProfileStatus({ force });
      if (!mountedRef.current) return;

      if (statusResult.kind === "anonymous") {
        setIsAuthenticated(false);
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (statusResult.kind === "error") {
        setIsAuthenticated(false);
        setProfile(null);
        setError(statusResult.message);
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

  const refresh = useCallback(async () => {
    await refreshInternal(false);
  }, [refreshInternal]);

  useEffect(() => {
    void refreshInternal(false);

    const cleanupAuthChanged = addCitizenAuthChangedListener(() => {
      invalidateCitizenProfileStatusCache();
      void refreshInternal(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
        return;
      }

      invalidateCitizenProfileStatusCache();

      if (!session?.user?.id) {
        setIsAuthenticated(false);
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      void refreshInternal(true);
    });

    return () => {
      cleanupAuthChanged();
      listener.subscription.unsubscribe();
    };
  }, [refreshInternal, supabase.auth]);

  return {
    isLoading,
    isAuthenticated,
    profile,
    error,
    refresh,
  };
}
