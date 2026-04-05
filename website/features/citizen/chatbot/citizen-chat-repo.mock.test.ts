import { beforeEach, describe, expect, it } from "vitest";
import { __resetMockCitizenChatState, createMockCitizenChatRepo } from "@/lib/repos/citizen-chat/repo.mock";
import { vi } from "vitest";

describe("Citizen chat mock repo", () => {
  beforeEach(() => {
    __resetMockCitizenChatState();
  });

  it("renames sessions and keeps latest-updated ordering", async () => {
    vi.useFakeTimers();
    const repo = createMockCitizenChatRepo();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    const first = await repo.createSession("citizen-1", { title: "First" });
    vi.setSystemTime(new Date("2026-03-01T00:01:00.000Z"));
    const second = await repo.createSession("citizen-1", { title: "Second" });
    vi.setSystemTime(new Date("2026-03-01T00:02:00.000Z"));

    const renamed = await repo.renameSession(first.id, "Renamed First");
    const sessions = await repo.listSessions("citizen-1");

    expect(renamed?.title).toBe("Renamed First");
    expect(sessions[0]?.id).toBe(first.id);
    expect(sessions[1]?.id).toBe(second.id);
    vi.useRealTimers();
  });

  it("deletes sessions and cascades message cleanup in mock store", async () => {
    const repo = createMockCitizenChatRepo();
    const session = await repo.createSession("citizen-1", { title: "To Delete" });
    await repo.appendUserMessage(session.id, "Hello");

    const deleted = await repo.deleteSession(session.id);
    const sessionsAfterDelete = await repo.listSessions("citizen-1");
    const messagesAfterDelete = await repo.listMessages(session.id);
    const deletedAgain = await repo.deleteSession(session.id);

    expect(deleted).toBe(true);
    expect(sessionsAfterDelete).toHaveLength(0);
    expect(messagesAfterDelete).toHaveLength(0);
    expect(deletedAgain).toBe(false);
  });

  it("auto-titles an untitled session on first message and keeps it stable after", async () => {
    vi.useFakeTimers();
    const repo = createMockCitizenChatRepo();

    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    const session = await repo.createSession("citizen-1", { context: {} });

    vi.setSystemTime(new Date("2026-03-01T00:01:00.000Z"));
    await repo.appendUserMessage(session.id, "First message");

    const firstPass = await repo.listSessions("citizen-1");
    const firstTitle = firstPass[0]?.title ?? null;
    expect(firstTitle).toBe("March 1, 2026 8:01 AM");

    vi.setSystemTime(new Date("2026-03-01T00:05:00.000Z"));
    await repo.appendUserMessage(session.id, "Second message");

    const secondPass = await repo.listSessions("citizen-1");
    expect(secondPass[0]?.title).toBe(firstTitle);
    vi.useRealTimers();
  });
});
