import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAccountsRepo } from "@/lib/repos/accounts/repo.supabase";

const mockSupabaseServer = vi.fn();
const mockSupabaseAdmin = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

type DeleteScenarioOptions = {
  actorId?: string | null;
  targetId?: string;
  targetRole?: "admin" | "barangay_official";
  targetIsActive?: boolean;
  activeAdminCount?: number;
  blockers?: Array<{ blocker: string; row_count: number }>;
  preflightError?: string | null;
};

function setupDeleteScenario(options: DeleteScenarioOptions = {}) {
  const targetId = options.targetId ?? "target-user-id";
  const actorId = options.actorId ?? "actor-user-id";
  const target = {
    id: targetId,
    role: options.targetRole ?? "barangay_official",
    is_active: options.targetIsActive ?? true,
    email: "target@example.com",
    city_id: null,
    municipality_id: null,
    barangay_id: "barangay-1",
  };

  const getUser = vi
    .fn()
    .mockResolvedValue(
      actorId
        ? { data: { user: { id: actorId } }, error: null }
        : { data: { user: null }, error: null }
    );
  const resolveTargetMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: target, error: null });
  const resolveActorMaybeSingle = vi.fn().mockResolvedValue({
    data: { full_name: "Admin User", email: "admin@example.com" },
    error: null,
  });
  const activeAdminCountQuery = vi
    .fn()
    .mockResolvedValue({ count: options.activeAdminCount ?? 2, error: null });
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteQuery = vi.fn().mockReturnValue({ eq: deleteEq });

  const select = vi.fn(
    (columns: string, opts?: { count?: string; head?: boolean }) => {
      if (
        columns === "id,role,is_active,email,city_id,municipality_id,barangay_id"
      ) {
        return {
          eq: vi.fn().mockReturnValue({ maybeSingle: resolveTargetMaybeSingle }),
        };
      }

      if (columns === "full_name,email") {
        return {
          eq: vi.fn().mockReturnValue({ maybeSingle: resolveActorMaybeSingle }),
        };
      }

      if (columns === "id" && opts?.count === "exact" && opts?.head === true) {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => activeAdminCountQuery()),
          }),
        };
      }

      throw new Error(`Unexpected select call in test: ${columns}`);
    }
  );

  const from = vi.fn().mockImplementation((table: string) => {
    if (table !== "profiles") {
      throw new Error(`Unexpected from() table in test: ${table}`);
    }
    return {
      select,
      delete: deleteQuery,
    };
  });

  const serverRpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const serverClient = {
    auth: { getUser },
    from,
    rpc: serverRpc,
  };

  const preflightRpc = vi
    .fn()
    .mockImplementation((fnName: string, args: Record<string, unknown>) => {
      if (fnName !== "get_profile_delete_blockers") {
        return Promise.resolve({ data: null, error: { message: "Unexpected RPC" } });
      }
      if (args.p_profile_id !== targetId) {
        return Promise.resolve({
          data: null,
          error: { message: "Unexpected p_profile_id." },
        });
      }
      if (options.preflightError) {
        return Promise.resolve({
          data: null,
          error: { message: options.preflightError },
        });
      }
      return Promise.resolve({
        data: options.blockers ?? [],
        error: null,
      });
    });
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const adminClient = {
    rpc: preflightRpc,
    auth: {
      admin: {
        deleteUser,
      },
    },
  };

  mockSupabaseServer.mockReturnValue(serverClient);
  mockSupabaseAdmin.mockReturnValue(adminClient);

  return {
    targetId,
    preflightRpc,
    deleteUser,
    deleteEq,
    activeAdminCountQuery,
  };
}

describe("createSupabaseAccountsRepo.deleteAccount preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects before delete when preflight blockers exist", async () => {
    const scenario = setupDeleteScenario({
      blockers: [
        { blocker: "uploaded_files", row_count: 2 },
        { blocker: "aip_reviews", row_count: 1 },
      ],
    });

    const repo = createSupabaseAccountsRepo();

    let message = "";
    await repo.deleteAccount(scenario.targetId).catch((error) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).toContain("Cannot delete account because dependent records exist:");
    expect(message).toContain("uploaded files (2)");
    expect(message).toContain("AIP reviews (1)");

    expect(scenario.preflightRpc).toHaveBeenCalledWith(
      "get_profile_delete_blockers",
      { p_profile_id: scenario.targetId }
    );
    expect(scenario.deleteUser).not.toHaveBeenCalled();
    expect(scenario.deleteEq).not.toHaveBeenCalled();
  });

  it("proceeds with auth and profile delete when preflight is clear", async () => {
    const scenario = setupDeleteScenario({ blockers: [] });
    const repo = createSupabaseAccountsRepo();

    await expect(repo.deleteAccount(scenario.targetId)).resolves.toBeUndefined();

    expect(scenario.preflightRpc).toHaveBeenCalledWith(
      "get_profile_delete_blockers",
      { p_profile_id: scenario.targetId }
    );
    expect(scenario.deleteUser).toHaveBeenCalledWith(scenario.targetId);
    expect(scenario.deleteEq).toHaveBeenCalledWith("id", scenario.targetId);
  });

  it("fails before any delete when preflight RPC errors", async () => {
    const scenario = setupDeleteScenario({ preflightError: "Preflight RPC failed." });
    const repo = createSupabaseAccountsRepo();

    await expect(repo.deleteAccount(scenario.targetId)).rejects.toThrow(
      "Preflight RPC failed."
    );

    expect(scenario.deleteUser).not.toHaveBeenCalled();
    expect(scenario.deleteEq).not.toHaveBeenCalled();
  });

  it("keeps self-delete guard before preflight", async () => {
    const scenario = setupDeleteScenario({
      actorId: "same-user-id",
      targetId: "same-user-id",
    });
    const repo = createSupabaseAccountsRepo();

    await expect(repo.deleteAccount("same-user-id")).rejects.toThrow(
      "You cannot delete your own account."
    );

    expect(scenario.preflightRpc).not.toHaveBeenCalled();
    expect(scenario.deleteUser).not.toHaveBeenCalled();
    expect(scenario.deleteEq).not.toHaveBeenCalled();
  });

  it("keeps last-active-admin guard before preflight", async () => {
    const scenario = setupDeleteScenario({
      targetRole: "admin",
      targetIsActive: true,
      activeAdminCount: 1,
    });
    const repo = createSupabaseAccountsRepo();

    await expect(repo.deleteAccount(scenario.targetId)).rejects.toThrow(
      "Cannot modify the last active admin account."
    );

    expect(scenario.activeAdminCountQuery).toHaveBeenCalled();
    expect(scenario.preflightRpc).not.toHaveBeenCalled();
    expect(scenario.deleteUser).not.toHaveBeenCalled();
    expect(scenario.deleteEq).not.toHaveBeenCalled();
  });
});
