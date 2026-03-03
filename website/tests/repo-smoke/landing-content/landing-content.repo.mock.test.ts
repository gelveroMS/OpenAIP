import { createMockLandingContentRepo } from "@/lib/repos/landing-content/repo.mock";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runLandingContentRepoMockTests() {
  const repo = createMockLandingContentRepo();
  const result = await repo.getLandingContent();
  const vm = result.vm;

  assert(!!vm.hero?.title, "Expected hero title");
  assert(!!vm.manifesto?.lines?.length, "Expected manifesto lines");
  assert(!!vm.lguOverview?.lguName, "Expected LGU overview");
  assert(vm.distribution.sectors.length >= 4, "Expected at least 4 sector rows");
  assert(!!vm.healthHighlights.primaryKpiLabel, "Expected health primary KPI label");
  assert(vm.healthHighlights.primaryKpiValue > 0, "Expected health primary KPI value");
  assert(
    vm.healthHighlights.projects.every((project) => project.imageSrc.startsWith("/citizen-dashboard/")),
    "Expected health projects imageSrc to use citizen dashboard assets"
  );
  assert(vm.healthHighlights.projects.length >= 5, "Expected at least 5 health projects");
  assert(!!vm.infraHighlights.primaryKpiLabel, "Expected infrastructure primary KPI label");
  assert(vm.infraHighlights.primaryKpiValue > 0, "Expected infrastructure primary KPI value");
  assert(
    vm.infraHighlights.projects.every((project) => project.imageSrc.startsWith("/citizen-dashboard/")),
    "Expected infrastructure projects imageSrc to use citizen dashboard assets"
  );
  assert(vm.infraHighlights.projects.length >= 5, "Expected at least 5 infrastructure projects");
  assert(vm.feedback.months.length === 6, "Expected exactly 6 feedback month labels");
  assert(vm.feedback.series.length === 2, "Expected exactly 2 feedback series");
  assert(
    vm.feedback.series.every((series) => series.points.length === 6),
    "Expected each feedback series to contain exactly 6 points"
  );
  assert(vm.feedback.responseRate === 94, "Expected feedback response rate to be 94");
  assert(vm.feedback.avgResponseTimeDays === 2.3, "Expected average response time to be 2.3 days");
  assert(vm.feedback.categorySummary.length === 4, "Expected 4 feedback category summary rows");
  assert(
    vm.feedback.categorySummary.map((item) => item.key).join(",") ===
      "commend,suggestion,concern,question",
    "Expected feedback category summary rows in fixed display order"
  );
  assert(!!vm.chatPreview.pillLabel, "Expected chat preview pill label");
  assert(!!vm.chatPreview.title, "Expected chat preview title");
  assert(!!vm.chatPreview.subtitle, "Expected chat preview subtitle");
  assert(!!vm.chatPreview.assistantName, "Expected chat preview assistant name");
  assert(!!vm.chatPreview.assistantStatus, "Expected chat preview assistant status");
  assert(!!vm.chatPreview.userPrompt, "Expected chat preview user prompt");
  assert(!!vm.chatPreview.assistantIntro, "Expected chat preview assistant intro");
  assert(
    vm.chatPreview.assistantBullets.length === 0,
    "Expected assistant bullets to be empty for paragraph-style assistant response"
  );
  assert(vm.chatPreview.suggestedPrompts.length >= 3, "Expected at least 3 suggested prompts");
  assert(!!vm.chatPreview.ctaLabel, "Expected chat preview CTA label");
  assert(vm.finalCta.title === "Governance Made Visible.", "Expected final CTA title");
  assert(vm.finalCta.subtitle === "Stay informed. Stay engaged. Stay empowered.", "Expected final CTA subtitle");
  assert(vm.finalCta.ctaLabel === "View Full AIP", "Expected final CTA button label");
  assert(vm.finalCta.ctaHref === "/aips", "Expected final CTA route");
  assert(!!result.meta.selection.resolvedScopeId, "Expected resolved scope id in metadata");
  assert(Number.isInteger(result.meta.selection.resolvedFiscalYear), "Expected resolved fiscal year metadata");

  const switched = await repo.getLandingContent({
    scopeType: "barangay",
    scopeId: "mock-barangay-mamatid",
    fiscalYear: 2026,
  });
  assert(
    switched.meta.selection.resolvedScopeType === "barangay",
    "Expected valid barangay scope query to switch scope"
  );

  const normalized = await repo.getLandingContent({
    scopeType: "barangay",
    scopeId: "invalid-scope-id",
    fiscalYear: 2026,
  });
  assert(
    normalized.meta.selection.resolvedScopeId === "mock-city-cabuyao",
    "Expected invalid scope query to normalize to default city scope"
  );

  const noData = await repo.getLandingContent({
    scopeType: "barangay",
    scopeId: "mock-barangay-pulo",
    fiscalYear: 2024,
  });
  assert(noData.meta.hasData === false, "Expected no-data state for unsupported fiscal year");
}
