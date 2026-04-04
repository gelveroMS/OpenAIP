import { getCommentRepo } from "@/lib/repos/feedback/repo";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runCommentRepoSelectorTests() {
  const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const oldUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;

  try {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";
    const localRepo = getCommentRepo();
    const threads = await localRepo.listThreadsForInbox({ lguId: "lgu_001" });
    assert(Array.isArray(threads), "Expected mock repo to return threads in local mode");

    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    process.env.NEXT_PUBLIC_USE_MOCKS = "false";
    const stagingRepo = getCommentRepo();
    assert(
      typeof stagingRepo.listThreadsForInbox === "function" &&
        typeof stagingRepo.getThread === "function" &&
        typeof stagingRepo.listMessages === "function" &&
        typeof stagingRepo.addReply === "function",
      "Expected staging/no-mock selector to return a concrete comment repo adapter"
    );
  } finally {
    process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
    process.env.NEXT_PUBLIC_USE_MOCKS = oldUseMocks;
  }
}

