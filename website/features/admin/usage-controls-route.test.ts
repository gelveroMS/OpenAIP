import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();
const mockMapUserAuditHistory = vi.fn();
const mockSupabaseAdmin = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockDeriveChatbotMetrics = vi.fn(() => ({
  totalRequests: 0,
  errorRate: 0,
  avgDailyRequests: 0,
  periodDays: 14,
  trendTotalRequestsPct: 0,
  trendErrorRatePct: 0,
  trendAvgDailyPct: 0,
}));

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/repos/usage-controls/mappers/usage-controls.mapper", () => ({
  deriveChatbotMetrics: (...args: unknown[]) => mockDeriveChatbotMetrics(...args),
  mapFlaggedUsers: vi.fn(() => []),
  mapUserAuditHistory: (...args: unknown[]) => mockMapUserAuditHistory(...args),
}));

vi.mock("@/lib/settings/app-settings", () => ({
  clearBlockedUser: vi.fn(),
  getTypedAppSetting: (...args: unknown[]) => mockGetTypedAppSetting(...args),
  isSettingsStoreUnavailableError: vi.fn(() => false),
  setBlockedUser: vi.fn(),
  setTypedAppSetting: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

function createAdminClient() {
  return {
    from: (table: string) => {
      if (table === "activity_log") {
        return {
          select: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        };
      }

      return {
        select: async () => ({ data: [], error: null }),
      };
    },
  };
}

describe("GET /api/admin/usage-controls user audit pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetActorContext.mockResolvedValue({ role: "admin", userId: "admin-1" });
    mockSupabaseAdmin.mockReturnValue(createAdminClient());
    mockGetTypedAppSetting.mockImplementation(async (key: string) => {
      if (key === "controls.comment_rate_limit") {
        return {
          maxComments: 5,
          timeWindow: "hour",
          updatedAt: "2026-03-01T00:00:00.000Z",
          updatedBy: "Admin",
        };
      }
      if (key === "controls.chatbot_rate_limit") {
        return {
          maxRequests: 20,
          timeWindow: "per_hour",
          updatedAt: "2026-03-01T00:00:00.000Z",
          updatedBy: "Admin",
        };
      }
      if (key === "controls.blocked_users") {
        return {};
      }
      return null;
    });
  });

  it("returns paged user-audit payload with offset/limit/hasNext", async () => {
    const allEntries = Array.from({ length: 25 }, (_, idx) => ({
      id: `entry-${idx + 1}`,
      title: "Audit",
      timestamp: `2026-02-${String(idx + 1).padStart(2, "0")}T00:00:00.000Z`,
      performedBy: "Admin",
      status: "Active",
    }));
    mockMapUserAuditHistory.mockReturnValue(allEntries);

    const { GET } = await import("@/app/api/admin/usage-controls/route");
    const response = await GET(
      new Request("http://localhost/api/admin/usage-controls?userId=user-1&offset=10&limit=10")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(25);
    expect(body.offset).toBe(10);
    expect(body.limit).toBe(10);
    expect(body.hasNext).toBe(true);
    expect(body.entries).toHaveLength(10);
    expect(body.entries[0]?.id).toBe("entry-11");
  });

  it("caps user-audit limit at 50", async () => {
    const allEntries = Array.from({ length: 120 }, (_, idx) => ({
      id: `entry-${idx + 1}`,
      title: "Audit",
      timestamp: `2026-02-${String((idx % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      performedBy: "Admin",
      status: "Active",
    }));
    mockMapUserAuditHistory.mockReturnValue(allEntries);

    const { GET } = await import("@/app/api/admin/usage-controls/route");
    const response = await GET(
      new Request("http://localhost/api/admin/usage-controls?userId=user-1&offset=20&limit=999")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.limit).toBe(50);
    expect(body.entries).toHaveLength(50);
    expect(body.hasNext).toBe(true);
  });

  it("uses dashboard date range query for chatbot metrics window", async () => {
    const { GET } = await import("@/app/api/admin/usage-controls/route");
    const response = await GET(
      new Request("http://localhost/api/admin/usage-controls?from=2026-02-01&to=2026-02-28")
    );

    expect(response.status).toBe(200);
    expect(mockDeriveChatbotMetrics).toHaveBeenCalledTimes(1);
    expect(mockDeriveChatbotMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-02-01",
        dateTo: "2026-02-28",
      })
    );
  });
});
