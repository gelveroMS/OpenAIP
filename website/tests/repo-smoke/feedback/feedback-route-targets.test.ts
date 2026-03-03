import nextConfig from "@/next.config";
import { BARANGAY_NAV, CITY_NAV } from "@/constants/lgu-nav";
import { buildDashboardVm } from "@/features/dashboard/utils/dashboard-selectors";
import type { DashboardData } from "@/features/dashboard/types/dashboard-types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function findFeedbackHref(nav: Array<{ label: string; href: string }>): string | null {
  return nav.find((item) => item.label === "Feedback")?.href ?? null;
}

function createDashboardData(scope: "barangay" | "city"): DashboardData {
  return {
    scope,
    scopeId: scope === "city" ? "city_001" : "barangay_001",
    selectedFiscalYear: 2026,
    selectedAip: null,
    availableFiscalYears: [2026],
    allAips: [],
    projects: [],
    sectors: [],
    latestRuns: [],
    reviews: [],
    feedback: [
      {
        id: "feedback_001",
        targetType: "project",
        aipId: null,
        projectId: "project_001",
        parentFeedbackId: null,
        kind: "question",
        body: "Any update?",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    ],
    projectUpdateLogs: [],
  };
}

export async function runFeedbackRouteTargetTests() {
  assert(
    findFeedbackHref(BARANGAY_NAV) === "/barangay/feedback",
    "Expected barangay Feedback nav route to target /barangay/feedback."
  );
  assert(
    findFeedbackHref(CITY_NAV) === "/city/feedback",
    "Expected city Feedback nav route to target /city/feedback."
  );

  const barangayVm = buildDashboardVm({
    data: createDashboardData("barangay"),
    query: "",
    tableQuery: "",
    tableCategory: "all",
    tableSector: "all",
  });
  const cityVm = buildDashboardVm({
    data: createDashboardData("city"),
    query: "",
    tableQuery: "",
    tableCategory: "all",
    tableSector: "all",
  });

  assert(
    barangayVm.feedbackCategorySummary.length === 4,
    "Expected barangay dashboard feedback category summary to contain four rows."
  );
  assert(
    cityVm.feedbackCategorySummary.length === 4,
    "Expected city dashboard feedback category summary to contain four rows."
  );

  const barangayAwaitingReply = barangayVm.workingOnItems.find(
    (item) => item.id === "awaiting_reply"
  );
  const cityAwaitingReply = cityVm.workingOnItems.find((item) => item.id === "awaiting_reply");

  assert(
    barangayAwaitingReply?.href === "/barangay/feedback",
    "Expected barangay dashboard CTA to target /barangay/feedback."
  );
  assert(
    cityAwaitingReply?.href === "/city/feedback",
    "Expected city dashboard CTA to target /city/feedback."
  );

  const redirects =
    typeof nextConfig.redirects === "function" ? await nextConfig.redirects() : [];

  assert(
    redirects.some(
      (entry) =>
        entry.source === "/barangay/comments" &&
        entry.destination === "/barangay/feedback" &&
        entry.permanent === false
    ),
    "Expected redirect from /barangay/comments to /barangay/feedback."
  );
  assert(
    redirects.some(
      (entry) =>
        entry.source === "/city/comments" &&
        entry.destination === "/city/feedback" &&
        entry.permanent === false
    ),
    "Expected redirect from /city/comments to /city/feedback."
  );
}
