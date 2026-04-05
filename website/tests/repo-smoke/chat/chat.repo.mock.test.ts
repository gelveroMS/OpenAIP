import {
  __resetMockChatState,
  __unsafeAddMessage,
  createMockChatRepo,
} from "@/lib/repos/chat/repo.mock";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runChatRepoTests() {
  __resetMockChatState();

  const repo = createMockChatRepo();
  const session = await repo.createSession("u1");

  let threw = false;
  try {
    await __unsafeAddMessage(repo, session.id, "assistant", "hello");
  } catch (error) {
    threw = (error as Error).message === "INVALID_ROLE";
  }
  assert(threw, "Expected INVALID_ROLE when adding non-user role");

  await repo.appendUserMessage(session.id, "first");
  const afterFirstMessage = await repo.listSessions("u1");
  const firstSession = afterFirstMessage.find((item) => item.id === session.id) ?? null;
  assert(Boolean(firstSession?.title), "Expected untitled session to auto-title after first message");
  const generatedTitle = firstSession?.title ?? null;

  await repo.appendUserMessage(session.id, "second");
  const afterSecondMessage = await repo.listSessions("u1");
  const secondSession = afterSecondMessage.find((item) => item.id === session.id) ?? null;
  assert(secondSession?.title === generatedTitle, "Expected auto-generated title to stay stable");

  const messages = await repo.listMessages(session.id);
  assert(messages.length === 2, "Expected 2 messages");
  assert(messages[0].content === "first", "Expected insertion order preserved");
  assert(messages[1].content === "second", "Expected insertion order preserved");
  assert(messages.every((m) => m.role === "user"), "Expected user-only roles");

  const repo2 = createMockChatRepo();
  const s1 = await repo2.createSession("u1");
  await repo2.createSession("u2");
  await repo2.renameSession(s1.id, "Road Works FY 2026");
  await repo2.appendUserMessage(s1.id, "Show me line items for drainage");

  const sessions = await repo2.listSessions("u1");
  assert(sessions.every((s) => s.userId === "u1"), "Expected only u1 sessions");
  assert(sessions.some((s) => s.id === s1.id), "Expected u1 session returned");

  const titleSearch = await repo2.listSessions("u1", { query: "road works" });
  assert(titleSearch.length === 1 && titleSearch[0]?.id === s1.id, "Expected title query to match");

  const contentSearch = await repo2.listSessions("u1", { query: "drainage" });
  assert(contentSearch.length === 1 && contentSearch[0]?.id === s1.id, "Expected content query to match");

  const deleted = await repo2.deleteSession(s1.id);
  assert(deleted, "Expected deleteSession to return true for existing session");
  const afterDelete = await repo2.listSessions("u1", { query: "road works" });
  assert(afterDelete.length === 0, "Expected deleted session not to be returned");
}

