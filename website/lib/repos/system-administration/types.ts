import type { ActivityLogRow } from "@/lib/contracts/databasev2";

export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacters: boolean;
};

export type SessionTimeoutPolicy = {
  timeoutValue: number;
  timeUnit: "minutes" | "hours" | "days";
  warningMinutes: number;
};

export type LoginAttemptPolicy = {
  maxAttempts: number;
  lockoutDuration: number;
  lockoutUnit: "minutes" | "hours";
};

export type SecuritySettings = {
  passwordPolicy: PasswordPolicy;
  sessionTimeout: SessionTimeoutPolicy;
  loginAttemptLimits: LoginAttemptPolicy;
};

export type SystemBannerDraft = {
  title?: string | null;
  message: string;
  severity: "Info" | "Warning" | "Critical";
  startAt?: string | null;
  endAt?: string | null;
};

export type SystemBannerPublished = SystemBannerDraft & {
  publishedAt: string;
};

export type SystemAdministrationAuditLog = ActivityLogRow;

export type SystemAdministrationUpdateMeta = {
  performedBy?: string | null;
  performedAt?: string;
  reason?: string | null;
};

export type SystemAdministrationRepo = {
  getSecuritySettings: () => Promise<SecuritySettings>;
  updateSecuritySettings: (
    next: SecuritySettings,
    meta?: SystemAdministrationUpdateMeta
  ) => Promise<SecuritySettings>;
  getSystemBannerDraft: () => Promise<SystemBannerDraft>;
  getSystemBannerPublished: () => Promise<SystemBannerPublished | null>;
  publishSystemBanner: (
    draft: SystemBannerDraft,
    meta?: SystemAdministrationUpdateMeta
  ) => Promise<SystemBannerPublished>;
  unpublishSystemBanner: (
    meta?: SystemAdministrationUpdateMeta
  ) => Promise<{ unpublished: true }>;
  listAuditLogs: () => Promise<SystemAdministrationAuditLog[]>;
};

