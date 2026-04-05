import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseCitizenChatRepo } from "@/lib/repos/citizen-chat/repo.supabase";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe("Citizen chat supabase repo adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames a session with update->eq->select->maybeSingle", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "session-1",
        user_id: "citizen-1",
        title: "Updated Title",
        context: {},
        last_message_at: null,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:10:00.000Z",
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update });

    const repo = createSupabaseCitizenChatRepo();
    const renamed = await repo.renameSession("session-1", "Updated Title");

    expect(update).toHaveBeenCalledWith({ title: "Updated Title" });
    expect(eq).toHaveBeenCalledWith("id", "session-1");
    expect(renamed?.title).toBe("Updated Title");
  });

  it("deletes a session with delete->eq and returns boolean by row count", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null, count: 1 });
    const deleteQuery = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ delete: deleteQuery });

    const repo = createSupabaseCitizenChatRepo();
    const deleted = await repo.deleteSession("session-2");

    expect(deleteQuery).toHaveBeenCalledWith({ count: "exact" });
    expect(eq).toHaveBeenCalledWith("id", "session-2");
    expect(deleted).toBe(true);
  });

  it("throws adapter errors from rename", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "update failed" },
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update });

    const repo = createSupabaseCitizenChatRepo();

    await expect(repo.renameSession("session-3", "Title")).rejects.toThrow("update failed");
  });

  it("conditionally stamps an untitled session title after appending a user message", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "msg-1",
        session_id: "session-4",
        role: "user",
        content: "Hello",
        citations: null,
        retrieval_meta: null,
        created_at: "2026-03-01T00:02:00.000Z",
      },
      error: null,
    });
    const selectMessage = vi.fn().mockReturnValue({ single });
    const insertMessage = vi.fn().mockReturnValue({ select: selectMessage });

    const is = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ is });
    const updateSession = vi.fn().mockReturnValue({ eq });

    mockFrom.mockImplementation((table: string) => {
      if (table === "chat_messages") {
        return { insert: insertMessage };
      }
      if (table === "chat_sessions") {
        return { update: updateSession };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const repo = createSupabaseCitizenChatRepo();
    await repo.appendUserMessage("session-4", "Hello");

    expect(updateSession).toHaveBeenCalledWith({ title: "March 1, 2026 8:02 AM" });
    expect(eq).toHaveBeenCalledWith("id", "session-4");
    expect(is).toHaveBeenCalledWith("title", null);
  });
});
