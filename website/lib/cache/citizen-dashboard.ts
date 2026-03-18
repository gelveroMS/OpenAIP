export const CITIZEN_DASHBOARD_REVALIDATE_SECONDS = 300;
export const CITIZEN_DASHBOARD_PROJECTS_REVALIDATE_SECONDS = 120;

export const CITIZEN_DASHBOARD_CACHE_TAGS = {
  landingContent: "citizen-dashboard:landing-content",
  budgetFilters: "citizen-dashboard:budget-filters",
  budgetSummary: "citizen-dashboard:budget-summary",
  budgetProjects: "citizen-dashboard:budget-projects",
} as const;
