import { getDashboardRepo } from "@/lib/repos/dashboard/repo.server";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runDashboardRepoSelectorTests() {
  const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const oldUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;

  try {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";

    const localRepo = getDashboardRepo();
    const localData = await localRepo.getDashboardDataByScope({
      scope: "barangay",
      scopeId: "barangay_001",
      requestedFiscalYear: 2026,
    });
    assert(
      localData.scope === "barangay",
      "Expected mock dashboard repo to return barangay scope data."
    );
    assert(Array.isArray(localData.allAips), "Expected mock dashboard repo to return AIP rows.");

    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    process.env.NEXT_PUBLIC_USE_MOCKS = "false";

    const stagingRepo = getDashboardRepo();
    assert(
      typeof stagingRepo.getDashboardDataByScope === "function" &&
        typeof stagingRepo.createDraftAip === "function" &&
        typeof stagingRepo.replyToFeedback === "function",
      "Expected staging/no-mock selector to return a concrete dashboard repo adapter."
    );
  } finally {
    process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
    process.env.NEXT_PUBLIC_USE_MOCKS = oldUseMocks;
  }
}
