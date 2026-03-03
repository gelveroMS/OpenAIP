import type {
  LandingContentQuery,
  LandingContentResult,
  LandingContentVM,
  LandingScopeType,
  ProjectCardVM,
} from "@/lib/domain/landing-content";
import { createFeedbackCategorySummary } from "@/lib/constants/feedback-category-summary";
import type { LandingContentRepo } from "./repo";

const MOCK_SCOPE_IDS = {
  city: "mock-city-cabuyao",
  banayBanay: "mock-barangay-banay-banay",
  pulo: "mock-barangay-pulo",
  sanIsidro: "mock-barangay-san-isidro",
  mamatid: "mock-barangay-mamatid",
} as const;

const CURRENT_FISCAL_YEAR = 2026;

const BASE_MARKERS = [
  {
    id: "mk-main",
    label: "City of Cabuyao",
    lat: 14.272577955015906,
    lng: 121.12205388675164,
    kind: "main",
    scopeType: "city" as const,
    scopeId: MOCK_SCOPE_IDS.city,
    scopePsgc: "043404",
  },
  {
    id: "mk-1",
    label: "Brgy. Banay-banay",
    lat: 14.255193089069097,
    lng: 121.12779746799986,
    kind: "secondary",
    scopeType: "barangay" as const,
    scopeId: MOCK_SCOPE_IDS.banayBanay,
    scopePsgc: "043404002",
  },
  {
    id: "mk-2",
    label: "Brgy. Pulo",
    lat: 14.249207085376085,
    lng: 121.1320126110115,
    kind: "secondary",
    scopeType: "barangay" as const,
    scopeId: MOCK_SCOPE_IDS.pulo,
    scopePsgc: "043404013",
  },
  {
    id: "mk-3",
    label: "Brgy. San Isidro",
    lat: 14.242162608340106,
    lng: 121.14395166755374,
    kind: "secondary",
    scopeType: "barangay" as const,
    scopeId: MOCK_SCOPE_IDS.sanIsidro,
    scopePsgc: "043404015",
  },
  {
    id: "mk-4",
    label: "Brgy. Mamatid",
    lat: 14.237320473882946,
    lng: 121.15088301850722,
    kind: "secondary",
    scopeType: "barangay" as const,
    scopeId: MOCK_SCOPE_IDS.mamatid,
    scopePsgc: "043404009",
  },
] as const;

type ScopeProfile = {
  scopeType: LandingScopeType;
  scopeId: string;
  scopePsgc: string;
  lguName: string;
  scopeLabel: string;
  totalBudget: number;
  projectCount: number;
  activeUsers: number;
};

const SCOPE_PROFILES_BY_ID: Record<string, ScopeProfile> = {
  [MOCK_SCOPE_IDS.city]: {
    scopeType: "city",
    scopeId: MOCK_SCOPE_IDS.city,
    scopePsgc: "043404",
    lguName: "City of Cabuyao",
    scopeLabel: "City",
    totalBudget: 1_200_000_000,
    projectCount: 124,
    activeUsers: 2_430,
  },
  [MOCK_SCOPE_IDS.banayBanay]: {
    scopeType: "barangay",
    scopeId: MOCK_SCOPE_IDS.banayBanay,
    scopePsgc: "043404002",
    lguName: "Brgy. Banay-banay",
    scopeLabel: "Barangay",
    totalBudget: 320_000_000,
    projectCount: 42,
    activeUsers: 610,
  },
  [MOCK_SCOPE_IDS.pulo]: {
    scopeType: "barangay",
    scopeId: MOCK_SCOPE_IDS.pulo,
    scopePsgc: "043404013",
    lguName: "Brgy. Pulo",
    scopeLabel: "Barangay",
    totalBudget: 280_000_000,
    projectCount: 39,
    activeUsers: 540,
  },
  [MOCK_SCOPE_IDS.sanIsidro]: {
    scopeType: "barangay",
    scopeId: MOCK_SCOPE_IDS.sanIsidro,
    scopePsgc: "043404015",
    lguName: "Brgy. San Isidro",
    scopeLabel: "Barangay",
    totalBudget: 190_000_000,
    projectCount: 26,
    activeUsers: 410,
  },
  [MOCK_SCOPE_IDS.mamatid]: {
    scopeType: "barangay",
    scopeId: MOCK_SCOPE_IDS.mamatid,
    scopePsgc: "043404009",
    lguName: "Brgy. Mamatid",
    scopeLabel: "Barangay",
    totalBudget: 160_000_000,
    projectCount: 21,
    activeUsers: 370,
  },
};

const BUDGET_BY_SCOPE_BY_YEAR: Record<number, Record<string, number>> = {
  2026: {
    [MOCK_SCOPE_IDS.city]: 1_200_000_000,
    [MOCK_SCOPE_IDS.banayBanay]: 320_000_000,
    [MOCK_SCOPE_IDS.pulo]: 280_000_000,
    [MOCK_SCOPE_IDS.sanIsidro]: 190_000_000,
    [MOCK_SCOPE_IDS.mamatid]: 160_000_000,
  },
  2025: {
    [MOCK_SCOPE_IDS.city]: 1_110_000_000,
    [MOCK_SCOPE_IDS.banayBanay]: 300_000_000,
    [MOCK_SCOPE_IDS.pulo]: 260_000_000,
    [MOCK_SCOPE_IDS.sanIsidro]: 170_000_000,
    [MOCK_SCOPE_IDS.mamatid]: 145_000_000,
  },
};

function formatCompactPeso(value: number): string {
  if (value >= 1_000_000_000) {
    return `PHP ${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (value >= 1_000_000) {
    return `PHP ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `PHP ${Math.round(value).toLocaleString("en-PH")}`;
}

function buildHealthProjects(): ProjectCardVM[] {
  return [
    {
      id: "health-001",
      title: "Community Health Center Expansion",
      subtitle: "Expansion of existing health facility to serve more residents.",
      tagLabel: "Health",
      budget: 45_000_000,
      imageSrc: "/citizen-dashboard/flag.jpg",
    },
    {
      id: "health-002",
      title: "Maternal and Child Wellness Network",
      subtitle: "Prenatal diagnostics, nutrition counseling, and postnatal home visits.",
      tagLabel: "Health",
      budget: 12_400_000,
      imageSrc: "/citizen-dashboard/city.png",
    },
    {
      id: "health-003",
      title: "Barangay Vaccination Cold Chain Upgrade",
      subtitle: "New vaccine storage units and transport coolers for rural health stations.",
      tagLabel: "Health",
      budget: 9_800_000,
      imageSrc: "/citizen-dashboard/school.png",
    },
    {
      id: "health-004",
      title: "Mobile Clinic Fleet Modernization",
      subtitle: "Retrofit mobile units with telemedicine stations for remote consultations.",
      tagLabel: "Health",
      budget: 7_600_000,
      imageSrc: "/citizen-dashboard/blue-rectangle.png",
    },
    {
      id: "health-005",
      title: "School Health and Nutrition Monitoring",
      subtitle: "Regular screenings and referral support for at-risk learners.",
      tagLabel: "Health",
      budget: 5_300_000,
      imageSrc: "/citizen-dashboard/navy-rectangle.png",
    },
    {
      id: "health-006",
      title: "Emergency Medical Stockpile Program",
      subtitle: "Citywide emergency medicine buffer for surge response readiness.",
      tagLabel: "Health",
      budget: 4_900_000,
      imageSrc: "/citizen-dashboard/gradient.png",
    },
  ];
}

function buildInfrastructureProjects(): ProjectCardVM[] {
  return [
    {
      id: "infra-001",
      title: "Primary Road Rehabilitation Program",
      subtitle: "Resurfacing and drainage upgrades on major city connectors.",
      tagLabel: "Infrastructure",
      budget: 15_200_000,
      imageSrc: "/citizen-dashboard/city.png",
    },
    {
      id: "infra-002",
      title: "Flood Control and Drainage Expansion",
      subtitle: "Additional culverts and drainage channels for flood-prone barangays.",
      tagLabel: "Infrastructure",
      budget: 12_800_000,
      imageSrc: "/citizen-dashboard/school.png",
    },
    {
      id: "infra-003",
      title: "Public School Facility Retrofit",
      subtitle: "Structural reinforcement and classroom upgrades in public schools.",
      tagLabel: "Infrastructure",
      budget: 11_350_000,
      imageSrc: "/citizen-dashboard/flag.jpg",
    },
    {
      id: "infra-004",
      title: "Waterline Network Extension",
      subtitle: "Pipeline extension to underserved communities and growth areas.",
      tagLabel: "Infrastructure",
      budget: 9_600_000,
      imageSrc: "/citizen-dashboard/blue-rectangle.png",
    },
    {
      id: "infra-005",
      title: "Bridge Reinforcement and Safety Works",
      subtitle: "Structural strengthening and safety rail improvements on city bridges.",
      tagLabel: "Infrastructure",
      budget: 14_750_000,
      imageSrc: "/citizen-dashboard/navy-rectangle.png",
    },
    {
      id: "infra-006",
      title: "Street Lighting Expansion",
      subtitle: "LED streetlight rollout to improve nighttime visibility and safety.",
      tagLabel: "Infrastructure",
      budget: 6_200_000,
      imageSrc: "/citizen-dashboard/gradient.png",
    },
  ];
}

function buildLandingContent(input: {
  profile: ScopeProfile;
  fiscalYear: number;
  hasData: boolean;
}): LandingContentVM {
  const selectedMarker = BASE_MARKERS.find((marker) => marker.scopeId === input.profile.scopeId) ?? BASE_MARKERS[0];
  const markerBudgets = input.hasData ? BUDGET_BY_SCOPE_BY_YEAR[input.fiscalYear] ?? {} : {};

  return {
    hero: {
      title: "Know Where Every Peso Goes.",
      subtitle:
        "Explore the Annual Investment Plan through clear budget breakdowns, sector allocations, and funded projects - presented with transparency and accountability.",
      ctaLabel: "Explore the AIP",
      ctaHrefOrAction: { type: "href", value: "/aips" },
    },
    manifesto: {
      eyebrow: "Public. Clear. Accountable.",
      lines: ["Every allocation.", "Every project.", "Every peso."],
      subtext: "Because public funds deserve public clarity.",
    },
    lguOverview: {
      lguName: input.profile.lguName,
      scopeLabel: input.profile.scopeLabel,
      fiscalYearLabel: `FY ${input.fiscalYear}`,
      totalBudget: input.hasData ? input.profile.totalBudget : 0,
      budgetDeltaLabel: input.hasData ? "+8% vs FY 2025" : undefined,
      projectCount: input.hasData ? input.profile.projectCount : 0,
      projectDeltaLabel: input.hasData ? "+12 vs FY 2025" : undefined,
      aipStatus: input.hasData ? "Published" : "No published AIP",
      activeUsers: input.hasData ? input.profile.activeUsers : 0,
      map: {
        center: { lat: selectedMarker.lat, lng: selectedMarker.lng },
        zoom: 13,
        selectedFiscalYear: input.fiscalYear,
        markers: BASE_MARKERS.map((marker) => {
          const markerBudget = markerBudgets[marker.scopeId] ?? 0;
          return {
            id: marker.id,
            label: marker.label,
            lat: marker.lat,
            lng: marker.lng,
            kind: marker.kind,
            valueLabel: markerBudget > 0 ? formatCompactPeso(markerBudget) : "No data",
            scopeType: marker.scopeType,
            scopeId: marker.scopeId,
            scopePsgc: marker.scopePsgc,
            isSelectable: true,
            isSelected: marker.scopeId === input.profile.scopeId,
          };
        }),
      },
    },
    distribution: {
      total: input.hasData ? 412_800_000 : 0,
      unitLabel: "M",
      sectors: [
        { key: "general", label: "General Services", amount: input.hasData ? 120_000_000 : 0, percent: input.hasData ? 29.1 : 0 },
        { key: "social", label: "Social Services", amount: input.hasData ? 150_000_000 : 0, percent: input.hasData ? 36.4 : 0 },
        { key: "economic", label: "Economic Services", amount: input.hasData ? 90_000_000 : 0, percent: input.hasData ? 21.8 : 0 },
        { key: "other", label: "Other Services", amount: input.hasData ? 52_800_000 : 0, percent: input.hasData ? 12.7 : 0 },
      ],
    },
    healthHighlights: {
      categoryKey: "health",
      heading: "Health Projects",
      description:
        "Strengthening healthcare access through facility improvements, equipment funding, and community health programs.",
      primaryKpiLabel: "Total Healthcare Budget",
      primaryKpiValue: input.hasData ? 13_500_000 : 0,
      totalBudget: input.hasData ? 45_500_000 : 0,
      secondaryKpiLabel: "Total Beneficiaries",
      secondaryKpiValue: input.hasData ? 5_400 : 0,
      projects: input.hasData ? buildHealthProjects() : [],
    },
    infraHighlights: {
      categoryKey: "infrastructure",
      heading: "Infrastructure Development",
      description:
        "Building roads, public facilities, and essential systems that support growth and daily life.",
      primaryKpiLabel: "Total Infrastructure Budget",
      primaryKpiValue: input.hasData ? 69_900_000 : 0,
      totalBudget: input.hasData ? 69_900_000 : 0,
      secondaryKpiLabel: "Total Projects",
      secondaryKpiValue: input.hasData ? 36 : 0,
      projects: input.hasData ? buildInfrastructureProjects() : [],
    },
    feedback: {
      title: "Your Voice Matters.",
      subtitle:
        "Track feedback trends and response performance to ensure continued accountability.",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      series: [
        {
          key: String(input.fiscalYear - 1),
          label: String(input.fiscalYear - 1),
          points: input.hasData ? [72, 78, 61, 90, 56, 54] : [0, 0, 0, 0, 0, 0],
        },
        {
          key: String(input.fiscalYear),
          label: String(input.fiscalYear),
          points: input.hasData ? [102, 172, 86, 124, 82, 140] : [0, 0, 0, 0, 0, 0],
        },
      ],
      categorySummary: createFeedbackCategorySummary(
        input.hasData
          ? {
              commend: 18,
              suggestion: 14,
              concern: 6,
              question: 31,
            }
          : {}
      ),
      responseRate: input.hasData ? 94 : 0,
      avgResponseTimeDays: input.hasData ? 2.3 : 0,
    },
    chatPreview: {
      pillLabel: "AI Assistant",
      title: "Ask Questions, Get Answers",
      subtitle:
        "Don't understand something? Just ask. Our AI chatbot can answer questions about budgets, projects, and programs. It's like having a budget expert available 24/7.",
      assistantName: "Budget Assistant",
      assistantStatus: "Always ready to help",
      userPrompt:
        "Where is our barangay/city budget going this year? What are the biggest projects?",
      assistantIntro:
        "Based on the published AIP, here is the summary of where the budget is going this year, including the total AIP budget, and the biggest projects with their amounts, fund source, timeline, and implementing office:",
      assistantBullets: [],
      suggestedPrompts: [
        "Which health projects have the highest budgets?",
        "Show infrastructure projects and their source of funds.",
        "Compare this year's budget with the previous published year.",
      ],
      ctaLabel: "Open Chatbot",
      ctaHref: "/chatbot",
    },
    finalCta: {
      title: "Governance Made Visible.",
      subtitle: "Stay informed. Stay engaged. Stay empowered.",
      ctaLabel: "View Full AIP",
      ctaHref: "/aips",
    },
  };
}

function buildLandingResult(input?: LandingContentQuery): LandingContentResult {
  const requestedScopeType =
    input?.scopeType === "city" || input?.scopeType === "barangay"
      ? input.scopeType
      : null;
  const requestedScopeId =
    typeof input?.scopeId === "string" && input.scopeId.trim().length > 0
      ? input.scopeId.trim()
      : null;
  const requestedFiscalYear =
    typeof input?.fiscalYear === "number" && Number.isInteger(input.fiscalYear)
      ? input.fiscalYear
      : null;

  const requestedProfile =
    requestedScopeType && requestedScopeId
      ? SCOPE_PROFILES_BY_ID[requestedScopeId] ?? null
      : null;
  const resolvedProfile =
    requestedProfile && requestedProfile.scopeType === requestedScopeType
      ? requestedProfile
      : SCOPE_PROFILES_BY_ID[MOCK_SCOPE_IDS.city];

  const availableFiscalYears = [2026, 2025];
  const baseFiscalYear = requestedFiscalYear ?? CURRENT_FISCAL_YEAR;
  const priorYear = availableFiscalYears.find((year) => year < baseFiscalYear);
  const hasRequestedYear = availableFiscalYears.includes(baseFiscalYear);
  const resolvedFiscalYear = hasRequestedYear
    ? baseFiscalYear
    : typeof priorYear === "number"
      ? priorYear
      : baseFiscalYear;

  const fiscalFallbackApplied = !hasRequestedYear && typeof priorYear === "number";
  const scopeFallbackApplied = Boolean(requestedScopeType || requestedScopeId) && resolvedProfile !== requestedProfile;
  const hasData = hasRequestedYear || fiscalFallbackApplied;

  const vm = buildLandingContent({
    profile: resolvedProfile,
    fiscalYear: resolvedFiscalYear,
    hasData,
  });

  return {
    vm,
    meta: {
      hasData,
      availableFiscalYears,
      selection: {
        requestedScopeType,
        requestedScopeId,
        requestedFiscalYear,
        resolvedScopeType: resolvedProfile.scopeType,
        resolvedScopeId: resolvedProfile.scopeId,
        resolvedScopePsgc: resolvedProfile.scopePsgc,
        resolvedFiscalYear,
        fallbackApplied: scopeFallbackApplied || fiscalFallbackApplied,
      },
    },
  };
}

export function createMockLandingContentRepo(): LandingContentRepo {
  return {
    async getLandingContent(input) {
      return buildLandingResult(input);
    },
  };
}
