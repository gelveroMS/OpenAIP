export type AppEnv = "local" | "staging" | "prod";

const APP_ENV_VALUES = ["local", "staging", "prod"] as const;

export function getAppEnv(): AppEnv {
  const raw = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (raw === "local" || raw === "staging" || raw === "prod") {
    return raw;
  }

  const allowed = APP_ENV_VALUES.join("|");
  throw new Error(
    `Invalid NEXT_PUBLIC_APP_ENV value "${raw ?? "<missing>"}". Expected one of: ${allowed}.`
  );
}

export function isMockEnabled(): boolean {
  // Always validate NEXT_PUBLIC_APP_ENV before selecting runtime mode.
  getAppEnv();
  return process.env.NEXT_PUBLIC_USE_MOCKS === "true";
}
