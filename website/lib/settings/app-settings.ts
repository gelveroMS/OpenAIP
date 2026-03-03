import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type CommentRateLimitSetting = {
  maxComments: number;
  timeWindow: "hour" | "day";
  updatedAt?: string;
  updatedBy?: string | null;
};

export type ChatbotRateLimitSetting = {
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
  updatedAt?: string;
  updatedBy?: string | null;
};

export type SecuritySettingsValue = {
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialCharacters: boolean;
  };
  sessionTimeout: {
    timeoutValue: number;
    timeUnit: "minutes" | "hours" | "days";
    warningMinutes: number;
  };
  loginAttemptLimits: {
    maxAttempts: number;
    lockoutDuration: number;
    lockoutUnit: "minutes" | "hours";
  };
};

export type SystemBannerDraftValue = {
  title?: string | null;
  message: string;
  severity: "Info" | "Warning" | "Critical";
  startAt?: string | null;
  endAt?: string | null;
};

export type SystemBannerPublishedValue = SystemBannerDraftValue & {
  publishedAt: string;
};

export type LoginAttemptStateEntryValue = {
  failedCount: number;
  firstFailedAt: string | null;
  lastFailedAt: string | null;
  lockedUntil: string | null;
  updatedAt: string;
};

export type LoginAttemptStateValue = Record<string, LoginAttemptStateEntryValue>;

export type BlockedUserSetting = {
  blockedUntil: string;
  reason: string;
  updatedAt: string;
  updatedBy?: string | null;
};

export type BlockedUsersSetting = Record<string, BlockedUserSetting>;

export type CitizenAboutUsReferenceDocStorageValue = {
  id: string;
  title: string;
  source: string;
  kind: "storage";
  bucketId: string;
  objectName: string;
};

export type CitizenAboutUsReferenceDocExternalValue = {
  id: string;
  title: string;
  source: string;
  kind: "external";
  externalUrl: string;
};

export type CitizenAboutUsReferenceDocValue =
  | CitizenAboutUsReferenceDocStorageValue
  | CitizenAboutUsReferenceDocExternalValue;

export type CitizenAboutUsQuickLinkValue = {
  id: string;
  href: string;
};

export type CitizenAboutUsContentValue = {
  referenceDocs: CitizenAboutUsReferenceDocValue[];
  quickLinks: CitizenAboutUsQuickLinkValue[];
};

export type CitizenDashboardScopePinValue = {
  scopeType: "city" | "barangay";
  scopePsgc: string;
  label: string;
  lat: number;
  lng: number;
  kind?: "main" | "secondary";
};

export type CitizenDashboardContentValue = {
  defaultCityPsgc: string;
  defaultZoom: number;
  cityPin: CitizenDashboardScopePinValue;
  barangayPins: CitizenDashboardScopePinValue[];
  hero: {
    title: string;
    subtitle: string;
    ctaLabel: string;
    ctaHref: string;
  };
  manifesto: {
    eyebrow: string;
    lines: string[];
    subtext: string;
  };
  feedback: {
    title: string;
    subtitle: string;
  };
  chatPreview: {
    pillLabel: string;
    title: string;
    subtitle: string;
    assistantName: string;
    assistantStatus: string;
    userPrompt: string;
    assistantIntro: string;
    assistantBullets: string[];
    suggestedPrompts: string[];
    ctaLabel: string;
    ctaHref: string;
  };
  finalCta: {
    title: string;
    subtitle: string;
    ctaLabel: string;
    ctaHref: string;
  };
};

export type AppSettingsMap = {
  "controls.comment_rate_limit": CommentRateLimitSetting;
  "controls.chatbot_rate_limit": ChatbotRateLimitSetting;
  "controls.blocked_users": BlockedUsersSetting;
  "system.security_settings": SecuritySettingsValue;
  "system.banner_draft": SystemBannerDraftValue;
  "system.banner_published": SystemBannerPublishedValue | null;
  "system.login_attempt_state": LoginAttemptStateValue;
  "content.citizen_about_us": CitizenAboutUsContentValue;
  "content.citizen_dashboard": CitizenDashboardContentValue;
};

const DEFAULT_SETTINGS: AppSettingsMap = {
  "controls.comment_rate_limit": {
    maxComments: 5,
    timeWindow: "hour",
  },
  "controls.chatbot_rate_limit": {
    maxRequests: 20,
    timeWindow: "per_hour",
  },
  "controls.blocked_users": {},
  "system.security_settings": {
    passwordPolicy: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialCharacters: true,
    },
    sessionTimeout: {
      timeoutValue: 30,
      timeUnit: "minutes",
      warningMinutes: 5,
    },
    loginAttemptLimits: {
      maxAttempts: 5,
      lockoutDuration: 30,
      lockoutUnit: "minutes",
    },
  },
  "system.banner_draft": {
    title: null,
    message: "",
    severity: "Info",
    startAt: null,
    endAt: null,
  },
  "system.banner_published": null,
  "system.login_attempt_state": {},
  "content.citizen_about_us": {
    referenceDocs: [
      {
        id: "dbm_primer_cover",
        title: "DBM Primer Cover (Volume 1)",
        source: "Source: DBM",
        kind: "storage",
        bucketId: "about-us-docs",
        objectName: "reference/dbm-primer-cover-volume-1.pdf",
      },
      {
        id: "dbm_primer_cover_volume_2",
        title: "DBM Primer Cover (Volume 2)",
        source: "Source: DBM",
        kind: "storage",
        bucketId: "about-us-docs",
        objectName: "reference/dbm-primer-cover-volume-2.pdf",
      },
      {
        id: "ra_7160",
        title: "RA 7160",
        source: "Source: Official Code",
        kind: "storage",
        bucketId: "about-us-docs",
        objectName: "reference/ra-7160.pdf",
      },
      {
        id: "lbm_92_fy_2026",
        title: "LBM No. 92, FY 2026",
        source: "Source: DBM",
        kind: "storage",
        bucketId: "about-us-docs",
        objectName: "reference/lbm-no-92-fy-2026.pdf",
      },
    ],
    quickLinks: [
      { id: "dashboard", href: "/" },
      { id: "budget_allocation", href: "/budget-allocation" },
      { id: "aips", href: "/aips" },
      { id: "projects", href: "/projects" },
    ],
  },
  "content.citizen_dashboard": {
    defaultCityPsgc: "043404",
    defaultZoom: 13,
    cityPin: {
      scopeType: "city",
      scopePsgc: "043404",
      label: "City of Cabuyao",
      lat: 14.272577955015906,
      lng: 121.12205388675164,
      kind: "main",
    },
    barangayPins: [
      {
        scopeType: "barangay",
        scopePsgc: "043404002",
        label: "Brgy. Banay-banay",
        lat: 14.255193089069097,
        lng: 121.12779746799986,
        kind: "secondary",
      },
      {
        scopeType: "barangay",
        scopePsgc: "043404013",
        label: "Brgy. Pulo",
        lat: 14.249207085376085,
        lng: 121.1320126110115,
        kind: "secondary",
      },
      {
        scopeType: "barangay",
        scopePsgc: "043404015",
        label: "Brgy. San Isidro",
        lat: 14.242162608340106,
        lng: 121.14395166755374,
        kind: "secondary",
      },
      {
        scopeType: "barangay",
        scopePsgc: "043404009",
        label: "Brgy. Mamatid",
        lat: 14.237320473882946,
        lng: 121.15088301850722,
        kind: "secondary",
      },
    ],
    hero: {
      title: "Know Where Every Peso Goes.",
      subtitle:
        "Explore the Annual Investment Plan through clear budget breakdowns, sector allocations, and funded projects - presented with transparency and accountability.",
      ctaLabel: "Explore the AIP",
      ctaHref: "/aips",
    },
    manifesto: {
      eyebrow: "Public. Clear. Accountable.",
      lines: ["Every allocation.", "Every project.", "Every peso."],
      subtext: "Because public funds deserve public clarity.",
    },
    feedback: {
      title: "Your Voice Matters.",
      subtitle:
        "Track feedback trends and response performance to ensure continued accountability.",
    },
    chatPreview: {
      pillLabel: "AI Assistant",
      title: "Ask Questions, Get Answers",
      subtitle:
        "Don't understand something? Just ask. Our AI chatbot can answer questions about budgets, projects, and programs. It's like having a budget expert available 24/7.",
      assistantName: "Budget Assistant",
      assistantStatus: "Always ready to help",
      userPrompt:
        "Where is our barangay/city budget going this year? What are the biggest projects?",
      assistantIntro:
        "Based on the published AIP, here is the summary of where the budget is going this year, including the total AIP budget, and the biggest projects with their amounts, fund source, timeline, and implementing office: ...",
      assistantBullets: [],
      suggestedPrompts: [
        "Which health projects have the highest budgets?",
        "Show infrastructure projects and their source of funds.",
        "Compare this year's budget with the previous published year.",
      ],
      ctaLabel: "Open Chatbot",
      ctaHref: "/chatbot",
    },
    finalCta: {
      title: "Governance Made Visible.",
      subtitle: "Stay informed. Stay engaged. Stay empowered.",
      ctaLabel: "View Full AIP",
      ctaHref: "/aips",
    },
  },
};

type SettingsMap = AppSettingsMap;

export type AppSettingKey = keyof SettingsMap;

export const SETTINGS_STORE_UNAVAILABLE_MESSAGE =
  'Settings store unavailable: expose schema "app" in Supabase Data API and ensure app.settings exists with service_role grants.';

const SETTINGS_STORE_UNAVAILABLE_PATTERNS = [
  "pgrst106",
  "invalid schema: app",
  "schema \"app\" does not exist",
  "relation \"app.settings\" does not exist",
  "could not find the table 'app.settings'",
  "permission denied for schema app",
  "permission denied for table settings",
] as const;

let hasLoggedSettingsStoreWarning = false;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function isSettingsStoreUnavailableMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return SETTINGS_STORE_UNAVAILABLE_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

function logSettingsStoreWarning(context: "read" | "write", sourceMessage: string) {
  if (hasLoggedSettingsStoreWarning) return;
  hasLoggedSettingsStoreWarning = true;
  console.warn(
    `[app-settings] ${context} fallback triggered. ${SETTINGS_STORE_UNAVAILABLE_MESSAGE} Source: ${sourceMessage}`
  );
}

export class SettingsStoreUnavailableError extends Error {
  readonly causeMessage: string;

  constructor(causeMessage: string) {
    super(SETTINGS_STORE_UNAVAILABLE_MESSAGE);
    this.name = "SettingsStoreUnavailableError";
    this.causeMessage = causeMessage;
  }
}

export function isSettingsStoreUnavailableError(error: unknown): boolean {
  if (error instanceof SettingsStoreUnavailableError) return true;
  const message = toErrorMessage(error);
  if (!message) return false;
  return (
    message.includes(SETTINGS_STORE_UNAVAILABLE_MESSAGE) ||
    isSettingsStoreUnavailableMessage(message)
  );
}

function cloneDefault<K extends AppSettingKey>(key: K): SettingsMap[K] {
  const value = DEFAULT_SETTINGS[key];
  return structuredClone(value);
}

function safeParseSetting<K extends AppSettingKey>(
  key: K,
  raw: string | null
): SettingsMap[K] {
  if (!raw) return cloneDefault(key);

  try {
    const parsed = JSON.parse(raw) as SettingsMap[K];
    if (parsed === null || parsed === undefined) {
      return cloneDefault(key);
    }
    return parsed;
  } catch {
    return cloneDefault(key);
  }
}

async function readSettingRaw(key: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .schema("app")
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    if (isSettingsStoreUnavailableMessage(error.message)) {
      logSettingsStoreWarning("read", error.message);
      return null;
    }
    throw new Error(error.message);
  }

  return typeof data?.value === "string" ? data.value : null;
}

async function writeSettingRaw(key: string, value: string): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin
    .schema("app")
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    if (isSettingsStoreUnavailableMessage(error.message)) {
      logSettingsStoreWarning("write", error.message);
      throw new SettingsStoreUnavailableError(error.message);
    }
    throw new Error(error.message);
  }
}

export async function getTypedAppSetting<K extends AppSettingKey>(
  key: K
): Promise<SettingsMap[K]> {
  const raw = await readSettingRaw(key);
  return safeParseSetting(key, raw);
}

export async function setTypedAppSetting<K extends AppSettingKey>(
  key: K,
  value: SettingsMap[K]
): Promise<SettingsMap[K]> {
  await writeSettingRaw(key, JSON.stringify(value));
  return value;
}

export async function getBlockedUsersSetting(): Promise<BlockedUsersSetting> {
  return getTypedAppSetting("controls.blocked_users");
}

export async function setBlockedUsersSetting(
  next: BlockedUsersSetting
): Promise<BlockedUsersSetting> {
  return setTypedAppSetting("controls.blocked_users", next);
}

export async function setBlockedUser(input: {
  userId: string;
  blockedUntil: string;
  reason: string;
  updatedBy?: string | null;
  updatedAt?: string;
}): Promise<BlockedUsersSetting> {
  const current = await getBlockedUsersSetting();
  const next: BlockedUsersSetting = {
    ...current,
    [input.userId]: {
      blockedUntil: input.blockedUntil,
      reason: input.reason,
      updatedBy: input.updatedBy ?? null,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    },
  };
  return setBlockedUsersSetting(next);
}

export async function clearBlockedUser(
  userId: string
): Promise<BlockedUsersSetting> {
  const current = await getBlockedUsersSetting();
  const next = { ...current };
  delete next[userId];
  return setBlockedUsersSetting(next);
}

export async function isUserBlocked(userId: string): Promise<boolean> {
  const blocked = await getBlockedUsersSetting();
  const row = blocked[userId];
  if (!row) return false;
  if (!row.blockedUntil) return false;

  const now = new Date().getTime();
  const blockedUntil = new Date(row.blockedUntil).getTime();
  if (!Number.isFinite(blockedUntil)) return false;

  return blockedUntil > now;
}
