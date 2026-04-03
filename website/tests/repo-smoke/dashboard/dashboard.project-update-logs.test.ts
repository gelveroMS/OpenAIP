import { getDashboardRepo } from "@/lib/repos/dashboard/repo.server";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runDashboardProjectUpdateLogsTests() {
  const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const oldUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;

  try {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";

    const repo = getDashboardRepo();
    const data2026 = await repo.getDashboardDataByScope({
      scope: "barangay",
      scopeId: "barangay_001",
      requestedFiscalYear: 2026,
    });

    const allowedActions = new Set(["project_info_updated", "project_updated"]);
    const projectIdSet = new Set(data2026.projects.map((project) => project.id));

    assert(data2026.projectUpdateLogs.length > 0, "Expected selected AIP to include project update logs.");
    for (const log of data2026.projectUpdateLogs) {
      assert(
        allowedActions.has(log.action),
        `Expected only allowed project update actions, got: ${log.action}`
      );
      assert(
        projectIdSet.has(log.entityId),
        "Expected project update log entity to belong to selected AIP projects."
      );
      assert(
        typeof log.projectRefCode === "string" && log.projectRefCode.length > 0,
        "Expected project update logs to include projectRefCode."
      );
    }
    assert(
      !data2026.projectUpdateLogs.some((log) => log.title === "Non-target action log"),
      "Expected non-target action logs to be excluded."
    );
    assert(
      !data2026.projectUpdateLogs.some((log) => log.title === "Legacy project update"),
      "Expected logs outside selected AIP projects to be excluded."
    );

    const data2025 = await repo.getDashboardDataByScope({
      scope: "barangay",
      scopeId: "barangay_001",
      requestedFiscalYear: 2025,
    });
    assert(
      data2025.projectUpdateLogs.length === 0,
      "Expected no project update logs when selected AIP has no projects."
    );
  } finally {
    process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
    process.env.NEXT_PUBLIC_USE_MOCKS = oldUseMocks;
  }
}

