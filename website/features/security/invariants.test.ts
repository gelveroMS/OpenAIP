import { describe, expect, it } from "vitest";
import {
  InvariantError,
  assertDraftAccessDeniedForAnonOrCitizen,
  assertPrivilegedWriteAccess,
  assertPublishedOnlyUnlessScopedStaffAdmin,
} from "@/lib/security/invariants";

function expectInvariantStatus(fn: () => void, status: 401 | 403): void {
  try {
    fn();
    throw new Error("Expected invariant error.");
  } catch (error) {
    expect(error).toBeInstanceOf(InvariantError);
    expect((error as InvariantError).status).toBe(status);
  }
}

describe("security invariants", () => {
  it("loads in test runtime even with window defined", async () => {
    const mod = await import("@/lib/security/invariants");
    expect(typeof mod.assertInvariant).toBe("function");
  });

  it("allows published reads for anonymous callers", () => {
    expect(() =>
      assertPublishedOnlyUnlessScopedStaffAdmin({
        actor: null,
        isPublished: true,
        resourceScopeKind: "barangay",
        resourceScopeId: "brgy-1",
      })
    ).not.toThrow();
  });

  it("denies unpublished reads for anonymous and citizen actors by default", () => {
    expectInvariantStatus(() => {
      assertDraftAccessDeniedForAnonOrCitizen({
        actor: null,
        isPublished: false,
      });
    }, 401);

    expectInvariantStatus(() => {
      assertDraftAccessDeniedForAnonOrCitizen({
        actor: {
          role: "citizen",
          scope: { kind: "barangay", id: "brgy-1" },
        },
        isPublished: false,
      });
    }, 403);
  });

  it("allows scoped staff/admin for unpublished reads when scope matches", () => {
    expect(() =>
      assertPublishedOnlyUnlessScopedStaffAdmin({
        actor: {
          role: "barangay_official",
          scope: { kind: "barangay", id: "brgy-1" },
        },
        isPublished: false,
        resourceScopeKind: "barangay",
        resourceScopeId: "brgy-1",
      })
    ).not.toThrow();

    expect(() =>
      assertPublishedOnlyUnlessScopedStaffAdmin({
        actor: {
          role: "admin",
          scope: { kind: "none", id: null },
        },
        isPublished: false,
        resourceScopeKind: "city",
        resourceScopeId: "city-1",
      })
    ).not.toThrow();
  });

  it("enforces privileged write allowlists and scope requirements", () => {
    expectInvariantStatus(() => {
      assertPrivilegedWriteAccess({
        actor: null,
        allowlistedRoles: ["city_official"],
      });
    }, 401);

    expectInvariantStatus(() => {
      assertPrivilegedWriteAccess({
        actor: { role: "citizen", scope: { kind: "barangay", id: "brgy-1" } },
        allowlistedRoles: ["city_official"],
      });
    }, 403);

    expectInvariantStatus(() => {
      assertPrivilegedWriteAccess({
        actor: { role: "city_official", scope: { kind: "barangay", id: "brgy-1" } },
        allowlistedRoles: ["city_official"],
        scopeByRole: { city_official: "city" },
      });
    }, 403);

    expectInvariantStatus(() => {
      assertPrivilegedWriteAccess({
        actor: { role: "city_official", scope: { kind: "city", id: null } },
        allowlistedRoles: ["city_official"],
        scopeByRole: { city_official: "city" },
        requireScopeId: true,
      });
    }, 403);

    expect(
      assertPrivilegedWriteAccess({
        actor: { role: "city_official", scope: { kind: "city", id: "city-1" } },
        allowlistedRoles: ["city_official"],
        scopeByRole: { city_official: "city" },
        requireScopeId: true,
      })
    ).toEqual({
      role: "city_official",
      scopeKind: "city",
      scopeId: "city-1",
    });
  });
});
