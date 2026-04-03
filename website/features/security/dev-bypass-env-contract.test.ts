import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppEnv, isMockEnabled } from "@/lib/config/appEnv";
import {
  isDevAuthBypassEnabled,
  isMockModeEnabled,
  isTempAdminBypassEnabled,
} from "@/lib/auth/dev-bypass";

const ORIGINAL_ENV = { ...process.env };

function restoreEnvVar(name: keyof NodeJS.ProcessEnv) {
  const originalValue = ORIGINAL_ENV[name];
  if (typeof originalValue === "string") {
    process.env[name] = originalValue;
    return;
  }
  delete process.env[name];
}

function resetSecurityEnv() {
  restoreEnvVar("NODE_ENV");
  restoreEnvVar("NEXT_PUBLIC_APP_ENV");
  restoreEnvVar("NEXT_PUBLIC_USE_MOCKS");
  restoreEnvVar("DEV_BYPASS_ENABLED");
  restoreEnvVar("DEV_AUTH_BYPASS");
  restoreEnvVar("TEMP_ADMIN_BYPASS_ENABLED");
  restoreEnvVar("USE_MOCKS_LOCAL");
}

describe("A05 env and bypass contract", () => {
  beforeEach(() => {
    resetSecurityEnv();
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.NEXT_PUBLIC_USE_MOCKS;
    delete process.env.DEV_BYPASS_ENABLED;
    delete process.env.DEV_AUTH_BYPASS;
    delete process.env.TEMP_ADMIN_BYPASS_ENABLED;
    delete process.env.USE_MOCKS_LOCAL;
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    resetSecurityEnv();
  });

  it("throws when NEXT_PUBLIC_APP_ENV is missing", () => {
    expect(() => getAppEnv()).toThrow(/Invalid NEXT_PUBLIC_APP_ENV/i);
  });

  it("throws when NEXT_PUBLIC_APP_ENV is invalid", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "qa";
    expect(() => getAppEnv()).toThrow(/Invalid NEXT_PUBLIC_APP_ENV/i);
  });

  it("accepts only local, staging, and prod", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    expect(getAppEnv()).toBe("local");

    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    expect(getAppEnv()).toBe("staging");

    process.env.NEXT_PUBLIC_APP_ENV = "prod";
    expect(getAppEnv()).toBe("prod");
  });

  it("keeps all bypass helpers disabled in production node env", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    process.env.DEV_BYPASS_ENABLED = "true";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.TEMP_ADMIN_BYPASS_ENABLED = "true";
    process.env.USE_MOCKS_LOCAL = "true";

    expect(isDevAuthBypassEnabled()).toBe(false);
    expect(isTempAdminBypassEnabled()).toBe(false);
    expect(isMockModeEnabled()).toBe(false);
  });

  it("keeps all bypass helpers disabled outside local app env", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    process.env.DEV_BYPASS_ENABLED = "true";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.TEMP_ADMIN_BYPASS_ENABLED = "true";
    process.env.USE_MOCKS_LOCAL = "true";

    expect(isDevAuthBypassEnabled()).toBe(false);
    expect(isTempAdminBypassEnabled()).toBe(false);
    expect(isMockModeEnabled()).toBe(false);
  });

  it("requires global bypass gate plus per-feature flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.TEMP_ADMIN_BYPASS_ENABLED = "true";
    process.env.USE_MOCKS_LOCAL = "true";

    expect(isDevAuthBypassEnabled()).toBe(false);
    expect(isTempAdminBypassEnabled()).toBe(false);
    expect(isMockModeEnabled()).toBe(false);

    process.env.DEV_BYPASS_ENABLED = "true";
    expect(isDevAuthBypassEnabled()).toBe(true);
    expect(isTempAdminBypassEnabled()).toBe(true);
    expect(isMockModeEnabled()).toBe(true);
  });

  it("validates app env before resolving selector mock mode", () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";

    expect(() => isMockEnabled()).toThrow(/Invalid NEXT_PUBLIC_APP_ENV/i);
  });
});
