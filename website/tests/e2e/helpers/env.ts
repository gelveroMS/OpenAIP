import fs from "node:fs";
import path from "node:path";

export type RoleKey = "citizen" | "barangay" | "city" | "admin";

export type ProjectName =
  | "chromium-desktop"
  | "firefox-desktop"
  | "pixel5-mobile"
  | "iphone13-mobile";

const SCENARIO_ENV_BY_PROJECT: Record<ProjectName, string> = {
  "chromium-desktop": "E2E_SCENARIO_CHROMIUM",
  "firefox-desktop": "E2E_SCENARIO_FIREFOX",
  "pixel5-mobile": "E2E_SCENARIO_PIXEL5",
  "iphone13-mobile": "E2E_SCENARIO_IPHONE13",
};

const PDF_ENV_BY_PROJECT: Record<ProjectName, string> = {
  "chromium-desktop": "E2E_AIP_PDF_PATH_CHROMIUM",
  "firefox-desktop": "E2E_AIP_PDF_PATH_FIREFOX",
  "pixel5-mobile": "E2E_AIP_PDF_PATH_PIXEL5",
  "iphone13-mobile": "E2E_AIP_PDF_PATH_IPHONE13",
};

const ROLE_ENV: Record<RoleKey, { email: string; password: string }> = {
  citizen: {
    email: "E2E_CITIZEN_EMAIL",
    password: "E2E_CITIZEN_PASSWORD",
  },
  barangay: {
    email: "E2E_BARANGAY_EMAIL",
    password: "E2E_BARANGAY_PASSWORD",
  },
  city: {
    email: "E2E_CITY_EMAIL",
    password: "E2E_CITY_PASSWORD",
  },
  admin: {
    email: "E2E_ADMIN_EMAIL",
    password: "E2E_ADMIN_PASSWORD",
  },
};

function isWebsiteRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "playwright.config.ts")) &&
    fs.existsSync(path.join(candidate, "tests", "e2e"))
  );
}

function resolveWebsiteRoot(): string {
  const cwd = process.cwd();
  if (isWebsiteRoot(cwd)) return cwd;

  const nestedWebsite = path.resolve(cwd, "website");
  if (isWebsiteRoot(nestedWebsite)) return nestedWebsite;

  // Keep fallback deterministic even if command is launched from an unexpected directory.
  return cwd;
}

const WEBSITE_ROOT = resolveWebsiteRoot();

function normalizeEnvValue(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireEnv(name: string): string {
  const value = normalizeEnvValue(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getE2EBaseUrl(): string {
  return normalizeEnvValue("E2E_BASE_URL") ?? "http://localhost:3000";
}

export function isE2EAipResetEnabled(): boolean {
  return normalizeEnvValue("E2E_AIP_RESET_ENABLED")?.toLowerCase() === "true";
}

export function getE2EResetToken(): string | null {
  return normalizeEnvValue("E2E_AIP_RESET_TOKEN");
}

export function getE2EResetEndpoint(): string {
  return normalizeEnvValue("E2E_AIP_RESET_ENDPOINT") ?? "/api/internal/e2e/reset-aip";
}

export function getStorageStateDir(): string {
  const configured = normalizeEnvValue("E2E_STORAGE_STATE_DIR") ?? ".playwright/.auth";
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(WEBSITE_ROOT, configured);
}

export function getStorageStatePath(role: RoleKey): string {
  return path.join(getStorageStateDir(), `${role}.json`);
}

export function getRoleCredentials(role: RoleKey): { email: string; password: string } {
  const env = ROLE_ENV[role];
  return {
    email: requireEnv(env.email),
    password: requireEnv(env.password),
  };
}

export function asProjectName(name: string): ProjectName {
  if (!(name in SCENARIO_ENV_BY_PROJECT)) {
    throw new Error(`Unsupported Playwright project name: ${name}`);
  }
  return name as ProjectName;
}

export function getScenarioPathForProject(name: string): string {
  const projectName = asProjectName(name);
  const envName = SCENARIO_ENV_BY_PROJECT[projectName];
  const raw = requireEnv(envName);
  return path.isAbsolute(raw) ? raw : path.resolve(WEBSITE_ROOT, raw);
}

export function getPdfPathForProject(name: string): string {
  const projectName = asProjectName(name);
  const envName = PDF_ENV_BY_PROJECT[projectName];
  const raw = requireEnv(envName);
  return path.isAbsolute(raw) ? raw : path.resolve(WEBSITE_ROOT, raw);
}
