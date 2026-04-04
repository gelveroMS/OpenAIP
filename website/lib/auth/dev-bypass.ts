import "server-only";

import { getAppEnv } from "@/lib/config/appEnv";

type DevBypassServerFlag =
  | "DEV_BYPASS_ENABLED"
  | "DEV_AUTH_BYPASS"
  | "TEMP_ADMIN_BYPASS_ENABLED"
  | "USE_MOCKS_LOCAL";

function readServerFlag(name: DevBypassServerFlag): boolean {
  return process.env[name] === "true";
}

function isLocalBypassContext(): boolean {
  return process.env.NODE_ENV === "development" && getAppEnv() === "local";
}

function isBypassGateEnabled(): boolean {
  return isLocalBypassContext() && readServerFlag("DEV_BYPASS_ENABLED");
}

export function isDevAuthBypassEnabled(): boolean {
  return isBypassGateEnabled() && readServerFlag("DEV_AUTH_BYPASS");
}

export function isTempAdminBypassEnabled(): boolean {
  return isBypassGateEnabled() && readServerFlag("TEMP_ADMIN_BYPASS_ENABLED");
}

export function isMockModeEnabled(): boolean {
  return isBypassGateEnabled() && readServerFlag("USE_MOCKS_LOCAL");
}

