import type { UsageControlsRepo } from "./types";

type UsageControlsStateResponse = {
  rateLimitSettings: Awaited<ReturnType<UsageControlsRepo["getRateLimitSettings"]>>;
  flaggedUsers: Awaited<ReturnType<UsageControlsRepo["listFlaggedUsers"]>>;
  chatbotMetrics: Awaited<ReturnType<UsageControlsRepo["getChatbotMetrics"]>>;
  chatbotRateLimitPolicy: Awaited<
    ReturnType<UsageControlsRepo["getChatbotRateLimitPolicy"]>
  >;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? "Usage controls request failed.");
  }
  return payload;
}

async function getState(input?: {
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<UsageControlsStateResponse> {
  const params = new URLSearchParams();
  if (input?.dateFrom) params.set("from", input.dateFrom);
  if (input?.dateTo) params.set("to", input.dateTo);
  const query = params.toString();
  const response = await fetch(`/api/admin/usage-controls${query ? `?${query}` : ""}`, {
    method: "GET",
    cache: "no-store",
  });
  return readJson<UsageControlsStateResponse>(response);
}

async function postAction<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/admin/usage-controls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return readJson<T>(response);
}

export function createSupabaseUsageControlsRepo(): UsageControlsRepo {
  return {
    async getRateLimitSettings() {
      const state = await getState();
      return state.rateLimitSettings;
    },
    async updateRateLimitSettings(input) {
      const result = await postAction<{
        rateLimitSettings: Awaited<ReturnType<UsageControlsRepo["getRateLimitSettings"]>>;
      }>("update_rate_limit", input);
      return result.rateLimitSettings;
    },
    async listFlaggedUsers() {
      const state = await getState();
      return state.flaggedUsers;
    },
    async getChatbotMetrics(input) {
      const state = await getState(input);
      return state.chatbotMetrics;
    },
    async getChatbotRateLimitPolicy() {
      const state = await getState();
      return state.chatbotRateLimitPolicy;
    },
    async updateChatbotRateLimitPolicy(input) {
      const result = await postAction<{
        chatbotRateLimitPolicy: Awaited<
          ReturnType<UsageControlsRepo["getChatbotRateLimitPolicy"]>
        >;
      }>("update_chatbot_rate_limit", input);
      return result.chatbotRateLimitPolicy;
    },
    async getUserAuditHistory(input) {
      const offset = Math.max(0, input.offset ?? 0);
      const limit = Math.max(1, input.limit ?? 2);
      const response = await fetch(
        `/api/admin/usage-controls?userId=${encodeURIComponent(input.userId)}&offset=${offset}&limit=${limit}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const payload = await readJson<{
        entries: Awaited<ReturnType<UsageControlsRepo["getUserAuditHistory"]>>["entries"];
        total: number;
        offset: number;
        limit: number;
        hasNext: boolean;
      }>(response);
      return payload;
    },
    async temporarilyBlockUser(input) {
      await postAction("block_user", input);
    },
    async unblockUser(input) {
      await postAction("unblock_user", input);
    },
  };
}
