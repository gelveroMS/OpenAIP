type ProfileStatusPayload = {
  ok?: boolean;
  isComplete?: boolean;
  userId?: string;
  isBlocked?: boolean;
  blockedUntil?: string | null;
  blockedReason?: string | null;
  error?: {
    message?: string;
  };
};

type CitizenProfileStatusAuthenticated = {
  kind: "authenticated";
  userId: string;
  isComplete: boolean;
  isBlocked: boolean;
  blockedUntil: string | null;
  blockedReason: string | null;
};

type CitizenProfileStatusAnonymous = {
  kind: "anonymous";
};

type CitizenProfileStatusError = {
  kind: "error";
  message: string;
};

export type CitizenProfileStatusResult =
  | CitizenProfileStatusAuthenticated
  | CitizenProfileStatusAnonymous
  | CitizenProfileStatusError;

const PASSIVE_REUSE_WINDOW_MS = 800;
const DEFAULT_ERROR_MESSAGE = "Unable to load profile status.";

let inFlightRequest: Promise<CitizenProfileStatusResult> | null = null;
let lastResolvedNonAuth: CitizenProfileStatusResult | null = null;
let lastResolvedAt = 0;
let cacheGeneration = 0;

function normalizeMessage(payload: ProfileStatusPayload | null, fallback: string): string {
  const value = payload?.error?.message;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function canReuseNonAuthResult(): boolean {
  if (!lastResolvedNonAuth) return false;
  return Date.now() - lastResolvedAt <= PASSIVE_REUSE_WINDOW_MS;
}

async function fetchCitizenProfileStatus(): Promise<CitizenProfileStatusResult> {
  const response = await fetch("/profile/status", {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as ProfileStatusPayload | null;

  if (response.status === 401) {
    return { kind: "anonymous" };
  }

  if (
    !response.ok ||
    payload?.ok !== true ||
    typeof payload.userId !== "string" ||
    !payload.userId.trim().length
  ) {
    return {
      kind: "error",
      message: normalizeMessage(payload, DEFAULT_ERROR_MESSAGE),
    };
  }

  return {
    kind: "authenticated",
    userId: payload.userId,
    isComplete: payload.isComplete === true,
    isBlocked: payload.isBlocked === true,
    blockedUntil: typeof payload.blockedUntil === "string" ? payload.blockedUntil : null,
    blockedReason:
      typeof payload.blockedReason === "string" && payload.blockedReason.trim().length > 0
        ? payload.blockedReason.trim()
        : null,
  };
}

export function invalidateCitizenProfileStatusCache(): void {
  cacheGeneration += 1;
  inFlightRequest = null;
  lastResolvedNonAuth = null;
  lastResolvedAt = 0;
}

export function getCitizenProfileStatus(options?: {
  force?: boolean;
}): Promise<CitizenProfileStatusResult> {
  if (inFlightRequest) {
    return inFlightRequest;
  }

  if (options?.force !== true && canReuseNonAuthResult()) {
    return Promise.resolve(lastResolvedNonAuth as CitizenProfileStatusResult);
  }

  const generation = cacheGeneration;
  const request = fetchCitizenProfileStatus().then((result) => {
    if (cacheGeneration !== generation) {
      return result;
    }

    if (result.kind === "authenticated") {
      invalidateCitizenProfileStatusCache();
      return result;
    }

    lastResolvedNonAuth = result;
    lastResolvedAt = Date.now();
    return result;
  });

  const trackedRequest = request.finally(() => {
    if (inFlightRequest === trackedRequest) {
      inFlightRequest = null;
    }
  });
  inFlightRequest = trackedRequest;

  return trackedRequest;
}
