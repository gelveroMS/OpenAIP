import "server-only";

import type { RoleType } from "@/lib/contracts/databasev2";

const nodeEnv = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
if (typeof window !== "undefined" && nodeEnv !== "test") {
  throw new Error("Security invariants are server-only and cannot run in the browser.");
}

type InvariantStatus = 400 | 401 | 403;

export type InvariantScopeKind = "none" | "barangay" | "city" | "municipality";

type InvariantActorLike = {
  role?: unknown;
  scope?: {
    kind?: unknown;
    id?: unknown;
  } | null;
  lgu_scope?: unknown;
  lgu_id?: unknown;
  scopeKind?: unknown;
  scopeId?: unknown;
};

type ScopeByRole = Partial<Record<RoleType, InvariantScopeKind>>;

export type NormalizedInvariantActor = {
  role: RoleType;
  scopeKind: InvariantScopeKind;
  scopeId: string | null;
};

export class InvariantError extends Error {
  readonly status: InvariantStatus;

  constructor(status: InvariantStatus, message: string) {
    super(message);
    this.status = status;
  }
}

export function isInvariantError(error: unknown): error is InvariantError {
  return error instanceof InvariantError;
}

export function assertInvariant(
  condition: unknown,
  status: InvariantStatus,
  message: string
): asserts condition {
  if (!condition) {
    throw new InvariantError(status, message);
  }
}

function isRoleType(value: unknown): value is RoleType {
  return (
    value === "citizen" ||
    value === "barangay_official" ||
    value === "city_official" ||
    value === "municipal_official" ||
    value === "admin"
  );
}

function normalizeScopeKind(value: unknown): InvariantScopeKind {
  if (value === "barangay") return "barangay";
  if (value === "city") return "city";
  if (value === "municipality") return "municipality";
  return "none";
}

function normalizeScopeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeInvariantActor(
  actor: InvariantActorLike | null | undefined
): NormalizedInvariantActor | null {
  if (!actor || typeof actor !== "object") return null;

  const role = actor.role;
  if (!isRoleType(role)) return null;

  const scopeKindRaw =
    actor.scopeKind ?? actor.scope?.kind ?? actor.lgu_scope ?? null;
  const scopeIdRaw =
    actor.scopeId ?? actor.scope?.id ?? actor.lgu_id ?? null;

  return {
    role,
    scopeKind: normalizeScopeKind(scopeKindRaw),
    scopeId: normalizeScopeId(scopeIdRaw),
  };
}

export function assertActorPresent<T>(
  actor: T | null | undefined,
  message = "Unauthorized."
): asserts actor is T {
  assertInvariant(!!actor, 401, message);
}

export function assertActorRole(
  actor: { role: RoleType } | null | undefined,
  allowedRoles: RoleType[],
  message = "Unauthorized."
): void {
  assertActorPresent(actor, message);
  assertInvariant(allowedRoles.includes(actor.role), 403, message);
}

export function assertNonEmptyString(
  value: unknown,
  message: string
): asserts value is string {
  assertInvariant(typeof value === "string" && value.trim().length > 0, 400, message);
}

export function assertPositiveInteger(
  value: unknown,
  message: string
): asserts value is number {
  assertInvariant(Number.isInteger(value) && Number(value) > 0, 400, message);
}

export function assertPrivilegedWriteAccess(input: {
  actor: InvariantActorLike | null | undefined;
  allowlistedRoles: RoleType[];
  scopeByRole?: ScopeByRole;
  requireScopeId?: boolean;
  message?: string;
}): NormalizedInvariantActor {
  const message = input.message ?? "Unauthorized.";
  const actor = normalizeInvariantActor(input.actor);
  assertActorPresent(actor, message);
  assertInvariant(input.allowlistedRoles.includes(actor.role), 403, message);

  const expectedScopeKind = input.scopeByRole?.[actor.role];
  if (expectedScopeKind) {
    assertInvariant(actor.scopeKind === expectedScopeKind, 403, message);
  }

  if (input.requireScopeId) {
    assertInvariant(!!actor.scopeId, 403, message);
  }

  return actor;
}

export function assertDraftAccessDeniedForAnonOrCitizen(input: {
  actor: InvariantActorLike | null | undefined;
  isPublished: boolean;
  message?: string;
}): NormalizedInvariantActor | null {
  if (input.isPublished) {
    return normalizeInvariantActor(input.actor);
  }

  const message = input.message ?? "Unauthorized.";
  const actor = normalizeInvariantActor(input.actor);
  assertActorPresent(actor, message);
  assertInvariant(actor.role !== "citizen", 403, message);
  return actor;
}

export function assertScopedStaffOrAdminAccess(input: {
  actor: InvariantActorLike | null | undefined;
  resourceScopeKind: InvariantScopeKind;
  resourceScopeId: string | null | undefined;
  message?: string;
}): NormalizedInvariantActor {
  const message = input.message ?? "Unauthorized.";
  const actor = normalizeInvariantActor(input.actor);
  assertActorPresent(actor, message);

  if (actor.role === "admin") {
    return actor;
  }

  const isScopedStaff =
    actor.role === "barangay_official" ||
    actor.role === "city_official" ||
    actor.role === "municipal_official";
  assertInvariant(isScopedStaff, 403, message);

  const resourceScopeKind = normalizeScopeKind(input.resourceScopeKind);
  const resourceScopeId = normalizeScopeId(input.resourceScopeId);
  assertInvariant(resourceScopeKind !== "none" && !!resourceScopeId, 403, message);
  assertInvariant(
    actor.scopeKind === resourceScopeKind && actor.scopeId === resourceScopeId,
    403,
    message
  );

  return actor;
}

export function assertPublishedOnlyUnlessScopedStaffAdmin(input: {
  actor: InvariantActorLike | null | undefined;
  isPublished: boolean;
  resourceScopeKind: InvariantScopeKind;
  resourceScopeId: string | null | undefined;
  message?: string;
}): void {
  if (input.isPublished) {
    return;
  }

  assertDraftAccessDeniedForAnonOrCitizen({
    actor: input.actor,
    isPublished: false,
    message: input.message,
  });

  assertScopedStaffOrAdminAccess({
    actor: input.actor,
    resourceScopeKind: input.resourceScopeKind,
    resourceScopeId: input.resourceScopeId,
    message: input.message,
  });
}
