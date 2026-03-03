import "server-only";

import { DBV2_SECTOR_CODES, getSectorLabel, type DashboardSectorCode } from "@/lib/constants/dashboard";
import {
  createFeedbackCategorySummary,
  isFeedbackCategorySummaryKey,
  type FeedbackCategorySummaryItem,
} from "@/lib/constants/feedback-category-summary";
import type {
  LandingContentQuery,
  LandingContentResult,
  LandingContentVM,
  LandingScopeType,
  ProjectCardVM,
} from "@/lib/domain/landing-content";
import { toProjectCoverProxyUrl } from "@/lib/projects/media";
import {
  getTypedAppSetting,
  type CitizenDashboardContentValue,
  type CitizenDashboardScopePinValue,
} from "@/lib/settings/app-settings";
import { supabaseServer } from "@/lib/supabase/server";
import type { LandingContentRepo } from "./repo";

type ScopeRow = {
  id: string;
  psgc_code: string;
  name: string;
  is_active: boolean;
};

type FiscalYearRow = {
  id: string;
  fiscal_year: number;
};

type AipPickRow = {
  id: string;
  published_at: string | null;
  updated_at: string;
};

type ScopeProjectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  program_project_description: string;
  category: "health" | "infrastructure" | "other";
  sector_code: string;
  total: number | null;
  implementing_agency: string | null;
  expected_output: string | null;
  source_of_funds: string | null;
  image_url: string | null;
};

type ProjectLinkRow = {
  id: string;
  aip_id: string;
};

type FeedbackRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  parent_feedback_id: string | null;
  kind: string;
  source: "human" | "ai";
  author_id: string | null;
  created_at: string;
};

type ResolvedScopePin = {
  markerId: string;
  scopeType: LandingScopeType;
  scopeId: string | null;
  scopePsgc: string;
  label: string;
  lat: number;
  lng: number;
  kind?: string;
  resolvedName: string | null;
};

type ScopeYearMetrics = {
  totalBudget: number;
  projectCount: number;
  sectorTotals: Record<DashboardSectorCode, number>;
  healthProjects: ScopeProjectRow[];
  infraProjects: ScopeProjectRow[];
};

type FeedbackMetrics = {
  months: string[];
  series: Array<{ key: string; label: string; points: number[] }>;
  categorySummary: FeedbackCategorySummaryItem[];
  responseRate: number;
  avgResponseTimeDays: number;
  activeUsers: number;
};

const FALLBACK_PROJECT_IMAGE = "/brand/logo3.svg";
const SUPABASE_PAGE_SIZE = 1_000;

const FEEDBACK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] as const;

const CITIZEN_FEEDBACK_KIND_SET = new Set(["question", "suggestion", "concern", "commend"]);

const SECTOR_KEY_BY_CODE: Record<DashboardSectorCode, string> = {
  "1000": "general",
  "3000": "social",
  "8000": "economic",
  "9000": "other",
};

const DEFAULT_CITIZEN_DASHBOARD_CONTENT: CitizenDashboardContentValue = {
  defaultCityPsgc: "043404",
  defaultZoom: 13,
  cityPin: {
    scopeType: "city",
    scopePsgc: "043404",
    label: "City of Cabuyao",
    lat: 14.272577955015906,
    lng: 121.12205388675164,
    kind: "main",
  },
  barangayPins: [
    {
      scopeType: "barangay",
      scopePsgc: "043404002",
      label: "Brgy. Banay-banay",
      lat: 14.255193089069097,
      lng: 121.12779746799986,
      kind: "secondary",
    },
    {
      scopeType: "barangay",
      scopePsgc: "043404013",
      label: "Brgy. Pulo",
      lat: 14.249207085376085,
      lng: 121.1320126110115,
      kind: "secondary",
    },
    {
      scopeType: "barangay",
      scopePsgc: "043404015",
      label: "Brgy. San Isidro",
      lat: 14.242162608340106,
      lng: 121.14395166755374,
      kind: "secondary",
    },
    {
      scopeType: "barangay",
      scopePsgc: "043404009",
      label: "Brgy. Mamatid",
      lat: 14.237320473882946,
      lng: 121.15088301850722,
      kind: "secondary",
    },
  ],
  hero: {
    title: "Know Where Every Peso Goes.",
    subtitle:
      "Explore the Annual Investment Plan through clear budget breakdowns, sector allocations, and funded projects - presented with transparency and accountability.",
    ctaLabel: "Explore the AIP",
    ctaHref: "/aips",
  },
  manifesto: {
    eyebrow: "Public. Clear. Accountable.",
    lines: ["Every allocation.", "Every project.", "Every peso."],
    subtext: "Because public funds deserve public clarity.",
  },
  feedback: {
    title: "Your Voice Matters.",
    subtitle: "Track feedback trends and response performance to ensure continued accountability.",
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

function cloneFallbackSettings(): CitizenDashboardContentValue {
  return structuredClone(DEFAULT_CITIZEN_DASHBOARD_CONTENT);
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizePsgc(value: unknown, fallback: string): string {
  const text = normalizeString(value, fallback);
  return /^[0-9]{6,9}$/.test(text) ? text : fallback;
}

function normalizeHref(value: unknown, fallback: string): string {
  const candidate = normalizeString(value, fallback);
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  return candidate;
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function normalizeTextArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeScopeType(value: unknown, fallback: LandingScopeType): LandingScopeType {
  return value === "city" || value === "barangay" ? value : fallback;
}

function normalizePinKind(
  value: unknown,
  fallback: "main" | "secondary"
): "main" | "secondary" {
  return value === "main" || value === "secondary" ? value : fallback;
}

function normalizeScopePin(
  value: unknown,
  fallback: CitizenDashboardScopePinValue
): CitizenDashboardScopePinValue {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const row = value as Record<string, unknown>;
  const scopeType = normalizeScopeType(row.scopeType, fallback.scopeType);
  return {
    scopeType,
    scopePsgc: normalizePsgc(row.scopePsgc, fallback.scopePsgc),
    label: normalizeString(row.label, fallback.label),
    lat: normalizeNumber(row.lat, fallback.lat),
    lng: normalizeNumber(row.lng, fallback.lng),
    kind: normalizePinKind(
      row.kind,
      fallback.kind ?? (scopeType === "city" ? "main" : "secondary")
    ),
  };
}

function normalizeCitizenDashboardContent(
  value: CitizenDashboardContentValue | null | undefined
): CitizenDashboardContentValue {
  const fallback = cloneFallbackSettings();
  const source = value ?? fallback;

  const cityPin = normalizeScopePin(source.cityPin, fallback.cityPin);
  const barangayPinRows = Array.isArray(source.barangayPins) ? source.barangayPins : [];
  const defaultBarangayPins = fallback.barangayPins;
  const normalizedBarangayPins = barangayPinRows
    .map((pin, index) =>
      normalizeScopePin(pin, defaultBarangayPins[index % defaultBarangayPins.length])
    )
    .filter((pin) => pin.scopeType === "barangay");

  return {
    defaultCityPsgc: normalizePsgc(source.defaultCityPsgc, fallback.defaultCityPsgc),
    defaultZoom: normalizeNumber(source.defaultZoom, fallback.defaultZoom),
    cityPin: {
      ...cityPin,
      scopeType: "city",
      kind: normalizePinKind(cityPin.kind, "main"),
    },
    barangayPins:
      normalizedBarangayPins.length > 0
        ? normalizedBarangayPins.map((pin) => ({
            ...pin,
            scopeType: "barangay",
            kind: normalizePinKind(pin.kind, "secondary"),
          }))
        : [...fallback.barangayPins],
    hero: {
      title: normalizeString(source.hero?.title, fallback.hero.title),
      subtitle: normalizeString(source.hero?.subtitle, fallback.hero.subtitle),
      ctaLabel: normalizeString(source.hero?.ctaLabel, fallback.hero.ctaLabel),
      ctaHref: normalizeHref(source.hero?.ctaHref, fallback.hero.ctaHref),
    },
    manifesto: {
      eyebrow: normalizeString(source.manifesto?.eyebrow, fallback.manifesto.eyebrow),
      lines: normalizeTextArray(source.manifesto?.lines, fallback.manifesto.lines),
      subtext: normalizeString(source.manifesto?.subtext, fallback.manifesto.subtext),
    },
    feedback: {
      title: normalizeString(source.feedback?.title, fallback.feedback.title),
      subtitle: normalizeString(source.feedback?.subtitle, fallback.feedback.subtitle),
    },
    chatPreview: {
      pillLabel: normalizeString(source.chatPreview?.pillLabel, fallback.chatPreview.pillLabel),
      title: normalizeString(source.chatPreview?.title, fallback.chatPreview.title),
      subtitle: normalizeString(source.chatPreview?.subtitle, fallback.chatPreview.subtitle),
      assistantName: normalizeString(
        source.chatPreview?.assistantName,
        fallback.chatPreview.assistantName
      ),
      assistantStatus: normalizeString(
        source.chatPreview?.assistantStatus,
        fallback.chatPreview.assistantStatus
      ),
      userPrompt: normalizeString(source.chatPreview?.userPrompt, fallback.chatPreview.userPrompt),
      assistantIntro: normalizeString(
        source.chatPreview?.assistantIntro,
        fallback.chatPreview.assistantIntro
      ),
      assistantBullets: normalizeTextArray(
        source.chatPreview?.assistantBullets,
        fallback.chatPreview.assistantBullets
      ),
      suggestedPrompts: normalizeTextArray(
        source.chatPreview?.suggestedPrompts,
        fallback.chatPreview.suggestedPrompts
      ),
      ctaLabel: normalizeString(source.chatPreview?.ctaLabel, fallback.chatPreview.ctaLabel),
      ctaHref: normalizeHref(source.chatPreview?.ctaHref, fallback.chatPreview.ctaHref),
    },
    finalCta: {
      title: normalizeString(source.finalCta?.title, fallback.finalCta.title),
      subtitle: normalizeString(source.finalCta?.subtitle, fallback.finalCta.subtitle),
      ctaLabel: normalizeString(source.finalCta?.ctaLabel, fallback.finalCta.ctaLabel),
      ctaHref: normalizeHref(source.finalCta?.ctaHref, fallback.finalCta.ctaHref),
    },
  };
}

async function getCitizenDashboardContentSetting(): Promise<CitizenDashboardContentValue> {
  try {
    const setting = await getTypedAppSetting("content.citizen_dashboard");
    return normalizeCitizenDashboardContent(setting);
  } catch {
    return cloneFallbackSettings();
  }
}

function dedupePins(pins: CitizenDashboardScopePinValue[]): CitizenDashboardScopePinValue[] {
  const deduped: CitizenDashboardScopePinValue[] = [];
  const seen = new Set<string>();

  for (const pin of pins) {
    const key = `${pin.scopeType}:${pin.scopePsgc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(pin);
  }

  return deduped;
}

function buildConfiguredPins(content: CitizenDashboardContentValue): CitizenDashboardScopePinValue[] {
  const ordered = [content.cityPin, ...content.barangayPins].map((pin, index) => ({
    ...pin,
    kind:
      pin.kind ??
      (index === 0 && pin.scopeType === "city" ? "main" : "secondary"),
  }));

  return dedupePins(ordered);
}

function markerIdOf(pin: CitizenDashboardScopePinValue): string {
  return `mk-${pin.scopeType}-${pin.scopePsgc}`;
}

function toScopeKey(scopeType: LandingScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

async function resolveConfiguredPins(
  pins: CitizenDashboardScopePinValue[]
): Promise<ResolvedScopePin[]> {
  const client = await supabaseServer();
  const cityPsgcs = pins
    .filter((pin) => pin.scopeType === "city")
    .map((pin) => pin.scopePsgc);
  const barangayPsgcs = pins
    .filter((pin) => pin.scopeType === "barangay")
    .map((pin) => pin.scopePsgc);

  let cityRows: ScopeRow[] = [];
  if (cityPsgcs.length > 0) {
    const { data, error } = await client
      .from("cities")
      .select("id,psgc_code,name,is_active")
      .in("psgc_code", cityPsgcs)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    cityRows = (data ?? []) as ScopeRow[];
  }

  let barangayRows: ScopeRow[] = [];
  if (barangayPsgcs.length > 0) {
    const { data, error } = await client
      .from("barangays")
      .select("id,psgc_code,name,is_active")
      .in("psgc_code", barangayPsgcs)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    barangayRows = (data ?? []) as ScopeRow[];
  }

  const cityByPsgc = new Map(cityRows.map((row) => [row.psgc_code, row]));
  const barangayByPsgc = new Map(barangayRows.map((row) => [row.psgc_code, row]));

  return pins.map((pin) => {
    const row =
      pin.scopeType === "city"
        ? cityByPsgc.get(pin.scopePsgc) ?? null
        : barangayByPsgc.get(pin.scopePsgc) ?? null;

    return {
      markerId: markerIdOf(pin),
      scopeType: pin.scopeType,
      scopeId: row?.id ?? null,
      scopePsgc: pin.scopePsgc,
      label: pin.label,
      lat: pin.lat,
      lng: pin.lng,
      kind: pin.kind,
      resolvedName: row?.name ?? null,
    };
  });
}

function normalizeQuery(input?: LandingContentQuery): {
  requestedScopeType: LandingScopeType | null;
  requestedScopeId: string | null;
  requestedFiscalYear: number | null;
} {
  const requestedScopeType =
    input?.scopeType === "city" || input?.scopeType === "barangay"
      ? input.scopeType
      : null;
  const requestedScopeId =
    typeof input?.scopeId === "string" && input.scopeId.trim().length > 0
      ? input.scopeId.trim()
      : null;
  const requestedFiscalYear =
    typeof input?.fiscalYear === "number" &&
    Number.isInteger(input.fiscalYear) &&
    input.fiscalYear >= 2000 &&
    input.fiscalYear <= 2100
      ? input.fiscalYear
      : null;

  return {
    requestedScopeType,
    requestedScopeId,
    requestedFiscalYear,
  };
}

function selectScopePin(input: {
  pins: ResolvedScopePin[];
  requestedScopeType: LandingScopeType | null;
  requestedScopeId: string | null;
  defaultCityPsgc: string;
}): {
  selectedPin: ResolvedScopePin | null;
  scopeFallbackApplied: boolean;
} {
  const selectablePins = input.pins.filter((pin) => typeof pin.scopeId === "string");
  const requestedValid =
    input.requestedScopeType !== null &&
    input.requestedScopeId !== null &&
    selectablePins.some(
      (pin) => pin.scopeType === input.requestedScopeType && pin.scopeId === input.requestedScopeId
    );
  const requestedPin = requestedValid
    ?
        selectablePins.find(
          (pin) =>
            pin.scopeType === input.requestedScopeType && pin.scopeId === input.requestedScopeId
        ) ?? null
    : null;

  const defaultPin =
    selectablePins.find(
      (pin) => pin.scopeType === "city" && pin.scopePsgc === input.defaultCityPsgc
    ) ??
    selectablePins.find((pin) => pin.scopeType === "city") ??
    selectablePins[0] ??
    null;

  const selectedPin = requestedPin ?? defaultPin;
  const scopeRequested =
    input.requestedScopeType !== null || input.requestedScopeId !== null;
  const scopeFallbackApplied = scopeRequested && !requestedPin;

  return { selectedPin, scopeFallbackApplied };
}

function scopeColumnOf(scopeType: LandingScopeType): "city_id" | "barangay_id" {
  return scopeType === "city" ? "city_id" : "barangay_id";
}

async function listAvailableFiscalYears(
  scopeType: LandingScopeType,
  scopeId: string | null
): Promise<number[]> {
  if (!scopeId) return [];
  const client = await supabaseServer();
  const scopeColumn = scopeColumnOf(scopeType);
  const { data, error } = await client
    .from("aips")
    .select("id,fiscal_year")
    .eq("status", "published")
    .eq(scopeColumn, scopeId)
    .order("fiscal_year", { ascending: false });

  if (error) throw new Error(error.message);

  const seen = new Set<number>();
  for (const row of (data ?? []) as FiscalYearRow[]) {
    seen.add(row.fiscal_year);
  }

  return Array.from(seen).sort((left, right) => right - left);
}

async function getPublishedAipIdByScopeYear(input: {
  scopeType: LandingScopeType;
  scopeId: string;
  fiscalYear: number;
}): Promise<string | null> {
  const client = await supabaseServer();
  const scopeColumn = scopeColumnOf(input.scopeType);
  const { data, error } = await client
    .from("aips")
    .select("id,published_at,updated_at")
    .eq("status", "published")
    .eq(scopeColumn, input.scopeId)
    .eq("fiscal_year", input.fiscalYear)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const row = ((data ?? []) as AipPickRow[])[0] ?? null;
  return row?.id ?? null;
}

function resolveFiscalYear(input: {
  requestedFiscalYear: number;
  availableFiscalYears: number[];
}): {
  resolvedFiscalYear: number;
  fiscalFallbackApplied: boolean;
  hasDataForResolvedYear: boolean;
} {
  if (input.availableFiscalYears.includes(input.requestedFiscalYear)) {
    return {
      resolvedFiscalYear: input.requestedFiscalYear,
      fiscalFallbackApplied: false,
      hasDataForResolvedYear: true,
    };
  }

  const priorYear = input.availableFiscalYears.find(
    (year) => year < input.requestedFiscalYear
  );

  if (typeof priorYear === "number") {
    return {
      resolvedFiscalYear: priorYear,
      fiscalFallbackApplied: true,
      hasDataForResolvedYear: true,
    };
  }

  return {
    resolvedFiscalYear: input.requestedFiscalYear,
    fiscalFallbackApplied: false,
    hasDataForResolvedYear: false,
  };
}

function toAmount(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

function toDashboardSectorCode(value: string): DashboardSectorCode | null {
  if (DBV2_SECTOR_CODES.includes(value as DashboardSectorCode)) {
    return value as DashboardSectorCode;
  }
  return null;
}

async function listScopeProjectsByFiscalYear(input: {
  scopeType: LandingScopeType;
  scopeId: string;
  fiscalYear: number;
}): Promise<ScopeProjectRow[]> {
  const client = await supabaseServer();
  const scopeColumn = scopeColumnOf(input.scopeType);
  const rows: ScopeProjectRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await client
      .from("projects")
      .select(
        "id,aip_id,aip_ref_code,program_project_description,category,sector_code,total,implementing_agency,expected_output,source_of_funds,image_url,aips!inner(id)"
      )
      .eq("aips.status", "published")
      .eq("aips.fiscal_year", input.fiscalYear)
      .eq(`aips.${scopeColumn}`, input.scopeId)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as ScopeProjectRow[];
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

function summarizeScopeYearMetrics(projects: ScopeProjectRow[]): ScopeYearMetrics {
  const sectorTotals: Record<DashboardSectorCode, number> = {
    "1000": 0,
    "3000": 0,
    "8000": 0,
    "9000": 0,
  };

  let totalBudget = 0;
  for (const row of projects) {
    const amount = toAmount(row.total);
    totalBudget += amount;
    const code = toDashboardSectorCode(row.sector_code);
    if (code) {
      sectorTotals[code] += amount;
    }
  }

  const healthProjects = projects
    .filter((row) => row.category === "health")
    .sort((left, right) => toAmount(right.total) - toAmount(left.total));
  const infraProjects = projects
    .filter((row) => row.category === "infrastructure")
    .sort((left, right) => toAmount(right.total) - toAmount(left.total));

  return {
    totalBudget,
    projectCount: projects.length,
    sectorTotals,
    healthProjects,
    infraProjects,
  };
}

function compactNumber(value: number): string {
  const fixed =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatCompactPeso(value: number): string {
  if (value >= 1_000_000_000) {
    return `PHP ${compactNumber(value / 1_000_000_000)}B`;
  }
  if (value >= 1_000_000) {
    return `PHP ${compactNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `PHP ${compactNumber(value / 1_000)}K`;
  }
  return `PHP ${Math.round(value).toLocaleString("en-PH")}`;
}

function buildDeltaLabel(input: {
  currentValue: number;
  previousValue: number;
  previousFiscalYear: number;
}): string | undefined {
  if (input.previousValue <= 0) return undefined;
  const deltaPct = ((input.currentValue - input.previousValue) / input.previousValue) * 100;
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(1)}% vs FY ${input.previousFiscalYear}`;
}

function buildProjectDeltaLabel(input: {
  currentValue: number;
  previousValue: number;
  previousFiscalYear: number;
}): string | undefined {
  const delta = input.currentValue - input.previousValue;
  if (delta === 0) {
    return `Same with FY ${input.previousFiscalYear}`;
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} vs FY ${input.previousFiscalYear}`;
}

function projectSubtitleOf(project: ScopeProjectRow): string {
  const expected = project.expected_output?.trim() ?? "";
  if (expected.length > 0) return expected;
  const agency = project.implementing_agency?.trim() ?? "";
  if (agency.length > 0) return agency;
  const fund = project.source_of_funds?.trim() ?? "";
  if (fund.length > 0) return fund;
  return "Program delivery details are available in the full AIP document.";
}

function toProjectCards(input: {
  projects: ScopeProjectRow[];
  tagLabel: string;
}): ProjectCardVM[] {
  return input.projects.slice(0, 6).map((project) => {
    const imageSrc =
      typeof project.image_url === "string" && project.image_url.trim().length > 0
        ? toProjectCoverProxyUrl(project.id)
        : FALLBACK_PROJECT_IMAGE;

    const budget = toAmount(project.total);
    return {
      id: project.id,
      title: project.program_project_description || project.aip_ref_code,
      subtitle: projectSubtitleOf(project),
      tagLabel: input.tagLabel,
      budget,
      budgetLabel: formatCompactPeso(budget),
      imageSrc,
      meta: [project.aip_ref_code],
    };
  });
}

async function listMarkerBudgetsByYear(
  pins: ResolvedScopePin[],
  fiscalYear: number
): Promise<Map<string, number>> {
  const selectablePins = pins.filter((pin) => typeof pin.scopeId === "string");
  const budgetEntries = await Promise.all(
    selectablePins.map(async (pin) => {
      const scopeId = pin.scopeId as string;
      const projects = await listScopeProjectsByFiscalYear({
        scopeType: pin.scopeType,
        scopeId,
        fiscalYear,
      });
      const totalBudget = projects.reduce((sum, row) => sum + toAmount(row.total), 0);
      return [toScopeKey(pin.scopeType, scopeId), totalBudget] as const;
    })
  );

  return new Map(budgetEntries);
}

async function listScopeAipsByYears(input: {
  scopeType: LandingScopeType;
  scopeId: string;
  fiscalYears: number[];
}): Promise<Array<{ id: string; fiscal_year: number }>> {
  if (input.fiscalYears.length === 0) return [];

  const client = await supabaseServer();
  const scopeColumn = scopeColumnOf(input.scopeType);
  const { data, error } = await client
    .from("aips")
    .select("id,fiscal_year")
    .eq("status", "published")
    .eq(scopeColumn, input.scopeId)
    .in("fiscal_year", input.fiscalYears);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; fiscal_year: number }>;
}

async function listProjectLinksByAipIds(aipIds: string[]): Promise<ProjectLinkRow[]> {
  if (aipIds.length === 0) return [];

  const client = await supabaseServer();
  const { data, error } = await client
    .from("projects")
    .select("id,aip_id")
    .in("aip_id", aipIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectLinkRow[];
}

async function listFeedbackRowsByTargets(input: {
  aipIds: string[];
  projectIds: string[];
}): Promise<FeedbackRow[]> {
  const client = await supabaseServer();
  const rows: FeedbackRow[] = [];

  if (input.aipIds.length > 0) {
    const { data, error } = await client
      .from("feedback")
      .select("id,target_type,aip_id,project_id,parent_feedback_id,kind,source,author_id,created_at")
      .eq("target_type", "aip")
      .in("aip_id", input.aipIds);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as FeedbackRow[]));
  }

  if (input.projectIds.length > 0) {
    const { data, error } = await client
      .from("feedback")
      .select("id,target_type,aip_id,project_id,parent_feedback_id,kind,source,author_id,created_at")
      .eq("target_type", "project")
      .in("project_id", input.projectIds);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as FeedbackRow[]));
  }

  return rows;
}

function buildFeedbackMetrics(input: {
  feedbackRows: FeedbackRow[];
  selectedFiscalYear: number;
  previousFiscalYear: number;
  fiscalYearByAipId: Map<string, number>;
  aipIdByProjectId: Map<string, string>;
}): FeedbackMetrics {
  const currentSeries = [0, 0, 0, 0, 0, 0];
  const priorSeries = [0, 0, 0, 0, 0, 0];
  const lguReplyDateByParentId = new Map<string, Date>();
  const categoryCounts: Partial<Record<FeedbackCategorySummaryItem["key"], number>> = {};

  const fiscalYearByFeedbackId = new Map<string, number>();
  for (const row of input.feedbackRows) {
    let fiscalYear: number | null = null;
    if (row.target_type === "aip" && row.aip_id) {
      fiscalYear = input.fiscalYearByAipId.get(row.aip_id) ?? null;
    } else if (row.target_type === "project" && row.project_id) {
      const aipId = input.aipIdByProjectId.get(row.project_id) ?? null;
      if (aipId) {
        fiscalYear = input.fiscalYearByAipId.get(aipId) ?? null;
      }
    }

    if (typeof fiscalYear === "number") {
      fiscalYearByFeedbackId.set(row.id, fiscalYear);
    }

    if (row.parent_feedback_id && row.kind === "lgu_note" && fiscalYear !== null) {
      const replyDate = new Date(row.created_at);
      if (Number.isNaN(replyDate.getTime())) continue;
      const existing = lguReplyDateByParentId.get(row.parent_feedback_id);
      if (!existing || replyDate.getTime() < existing.getTime()) {
        lguReplyDateByParentId.set(row.parent_feedback_id, replyDate);
      }
    }
  }

  const currentRootCitizenRows: FeedbackRow[] = [];
  const activeCitizenAuthors = new Set<string>();

  for (const row of input.feedbackRows) {
    const fiscalYear = fiscalYearByFeedbackId.get(row.id);
    if (typeof fiscalYear !== "number") continue;

    const isCitizenKind = row.source === "human" && CITIZEN_FEEDBACK_KIND_SET.has(row.kind);
    if (!isCitizenKind) continue;

    if (fiscalYear === input.selectedFiscalYear && row.author_id) {
      activeCitizenAuthors.add(row.author_id);
    }

    if (row.parent_feedback_id !== null) continue;
    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    const monthIndex = createdAt.getUTCMonth();
    if (monthIndex < 0 || monthIndex >= FEEDBACK_MONTHS.length) continue;

    if (fiscalYear === input.selectedFiscalYear) {
      currentSeries[monthIndex] += 1;
      if (isFeedbackCategorySummaryKey(row.kind)) {
        categoryCounts[row.kind] = (categoryCounts[row.kind] ?? 0) + 1;
      }
      currentRootCitizenRows.push(row);
    } else if (fiscalYear === input.previousFiscalYear) {
      priorSeries[monthIndex] += 1;
    }
  }

  let respondedCount = 0;
  let totalResponseDays = 0;
  for (const root of currentRootCitizenRows) {
    const replyDate = lguReplyDateByParentId.get(root.id);
    if (!replyDate) continue;
    const rootDate = new Date(root.created_at);
    if (Number.isNaN(rootDate.getTime())) continue;
    const diffDays = Math.max(0, (replyDate.getTime() - rootDate.getTime()) / 86_400_000);
    respondedCount += 1;
    totalResponseDays += diffDays;
  }

  const responseRate =
    currentRootCitizenRows.length > 0
      ? Math.round((respondedCount / currentRootCitizenRows.length) * 100)
      : 0;
  const avgResponseTimeDays = respondedCount > 0 ? Number((totalResponseDays / respondedCount).toFixed(1)) : 0;

  return {
    months: [...FEEDBACK_MONTHS],
    series: [
      {
        key: String(input.previousFiscalYear),
        label: String(input.previousFiscalYear),
        points: priorSeries,
      },
      {
        key: String(input.selectedFiscalYear),
        label: String(input.selectedFiscalYear),
        points: currentSeries,
      },
    ],
    categorySummary: createFeedbackCategorySummary(categoryCounts),
    responseRate,
    avgResponseTimeDays,
    activeUsers: activeCitizenAuthors.size,
  };
}

async function computeFeedbackMetrics(input: {
  scopeType: LandingScopeType;
  scopeId: string;
  selectedFiscalYear: number;
}): Promise<FeedbackMetrics> {
  const previousFiscalYear = input.selectedFiscalYear - 1;
  const targetFiscalYears = [input.selectedFiscalYear, previousFiscalYear];
  const scopedAips = await listScopeAipsByYears({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    fiscalYears: targetFiscalYears,
  });

  const fiscalYearByAipId = new Map(scopedAips.map((row) => [row.id, row.fiscal_year]));
  const aipIds = scopedAips.map((row) => row.id);
  const projectLinks = await listProjectLinksByAipIds(aipIds);
  const aipIdByProjectId = new Map(projectLinks.map((row) => [row.id, row.aip_id]));

  const feedbackRows = await listFeedbackRowsByTargets({
    aipIds,
    projectIds: projectLinks.map((row) => row.id),
  });

  return buildFeedbackMetrics({
    feedbackRows,
    selectedFiscalYear: input.selectedFiscalYear,
    previousFiscalYear,
    fiscalYearByAipId,
    aipIdByProjectId,
  });
}

function buildEmptyMetrics(): ScopeYearMetrics {
  return {
    totalBudget: 0,
    projectCount: 0,
    sectorTotals: {
      "1000": 0,
      "3000": 0,
      "8000": 0,
      "9000": 0,
    },
    healthProjects: [],
    infraProjects: [],
  };
}

function toScopeLabel(scopeType: LandingScopeType): string {
  return scopeType === "city" ? "City" : "Barangay";
}

export function createSupabaseLandingContentRepo(): LandingContentRepo {
  return {
    async getLandingContent(input?: LandingContentQuery): Promise<LandingContentResult> {
      const content = await getCitizenDashboardContentSetting();
      const configuredPins = buildConfiguredPins(content);
      const resolvedPins = await resolveConfiguredPins(configuredPins);

      const normalizedQuery = normalizeQuery(input);
      const selectedScope = selectScopePin({
        pins: resolvedPins,
        requestedScopeType: normalizedQuery.requestedScopeType,
        requestedScopeId: normalizedQuery.requestedScopeId,
        defaultCityPsgc: content.defaultCityPsgc,
      });

      const requestedFiscalYear = normalizedQuery.requestedFiscalYear ?? new Date().getFullYear();
      const selectedPin = selectedScope.selectedPin;
      const resolvedScopeType = selectedPin?.scopeType ?? "city";
      const resolvedScopeId = selectedPin?.scopeId ?? "";
      const resolvedScopePsgc = selectedPin?.scopePsgc ?? content.defaultCityPsgc;
      const currentFiscalYear = new Date().getFullYear();

      const availableFiscalYears =
        selectedPin && selectedPin.scopeId
          ? await listAvailableFiscalYears(selectedPin.scopeType, selectedPin.scopeId)
          : [];

      const fiscalResolution = resolveFiscalYear({
        requestedFiscalYear,
        availableFiscalYears,
      });

      const hasData =
        Boolean(selectedPin && selectedPin.scopeId) && fiscalResolution.hasDataForResolvedYear;
      const resolvedFiscalYear = fiscalResolution.resolvedFiscalYear;
      const previousPublishedFiscalYear = availableFiscalYears.find(
        (year) => year < resolvedFiscalYear
      );
      const currentYearAipId =
        selectedPin?.scopeId
          ? await getPublishedAipIdByScopeYear({
              scopeType: selectedPin.scopeType,
              scopeId: selectedPin.scopeId,
              fiscalYear: currentFiscalYear,
            })
          : null;

      const currentMetrics =
        hasData && selectedPin?.scopeId
          ? summarizeScopeYearMetrics(
              await listScopeProjectsByFiscalYear({
                scopeType: selectedPin.scopeType,
                scopeId: selectedPin.scopeId,
                fiscalYear: resolvedFiscalYear,
              })
            )
          : buildEmptyMetrics();

      const previousMetrics =
        hasData && selectedPin?.scopeId && typeof previousPublishedFiscalYear === "number"
          ? summarizeScopeYearMetrics(
              await listScopeProjectsByFiscalYear({
                scopeType: selectedPin.scopeType,
                scopeId: selectedPin.scopeId,
                fiscalYear: previousPublishedFiscalYear,
              })
            )
          : null;

      const markerBudgetByScope = await listMarkerBudgetsByYear(
        resolvedPins,
        resolvedFiscalYear
      );

      const feedbackMetrics =
        hasData && selectedPin?.scopeId
          ? await computeFeedbackMetrics({
              scopeType: selectedPin.scopeType,
              scopeId: selectedPin.scopeId,
              selectedFiscalYear: resolvedFiscalYear,
            })
          : {
              months: [...FEEDBACK_MONTHS],
              series: [
                {
                  key: String(resolvedFiscalYear - 1),
                  label: String(resolvedFiscalYear - 1),
                  points: [0, 0, 0, 0, 0, 0],
                },
                {
                  key: String(resolvedFiscalYear),
                  label: String(resolvedFiscalYear),
                  points: [0, 0, 0, 0, 0, 0],
                },
              ],
              categorySummary: createFeedbackCategorySummary({}),
              responseRate: 0,
              avgResponseTimeDays: 0,
              activeUsers: 0,
            };

      const mapCenterPin = selectedPin ??
        resolvedPins[0] ?? {
          markerId: "mk-city-default",
          scopeType: "city" as const,
          scopeId: null,
          scopePsgc: content.defaultCityPsgc,
          label: content.cityPin.label,
          lat: content.cityPin.lat,
          lng: content.cityPin.lng,
          kind: "main",
          resolvedName: null,
        };

      const selectedScopeIdForMap = selectedPin?.scopeId ?? null;
      const selectedScopeTypeForMap = selectedPin?.scopeType ?? null;

      const mapMarkers = resolvedPins.map((pin) => {
        const isSelectable = typeof pin.scopeId === "string";
        const isSelected =
          Boolean(selectedScopeIdForMap) &&
          selectedScopeTypeForMap === pin.scopeType &&
          selectedScopeIdForMap === pin.scopeId;
        const markerBudget =
          isSelectable && pin.scopeId
            ? markerBudgetByScope.get(toScopeKey(pin.scopeType, pin.scopeId)) ?? 0
            : 0;

        return {
          id: pin.markerId,
          label: pin.label,
          lat: pin.lat,
          lng: pin.lng,
          kind: pin.kind,
          valueLabel: markerBudget > 0 ? formatCompactPeso(markerBudget) : "No data",
          scopeType: pin.scopeType,
          scopeId: pin.scopeId ?? undefined,
          scopePsgc: pin.scopePsgc,
          isSelectable,
          isSelected,
        };
      });

      const distributionSectors = DBV2_SECTOR_CODES.map((code) => {
        const amount = currentMetrics.sectorTotals[code];
        const percent =
          currentMetrics.totalBudget > 0
            ? Number(((amount / currentMetrics.totalBudget) * 100).toFixed(1))
            : 0;
        return {
          key: SECTOR_KEY_BY_CODE[code],
          label: getSectorLabel(code),
          amount,
          percent,
        };
      });

      const budgetDeltaLabel =
        previousMetrics && typeof previousPublishedFiscalYear === "number"
          ? buildDeltaLabel({
              currentValue: currentMetrics.totalBudget,
              previousValue: previousMetrics.totalBudget,
              previousFiscalYear: previousPublishedFiscalYear,
            })
          : undefined;

      const projectDeltaLabel =
        previousMetrics && typeof previousPublishedFiscalYear === "number"
          ? buildProjectDeltaLabel({
              currentValue: currentMetrics.projectCount,
              previousValue: previousMetrics.projectCount,
              previousFiscalYear: previousPublishedFiscalYear,
            })
          : undefined;

      const lguName = selectedPin?.label ?? mapCenterPin.label ?? "City of Cabuyao";
      const scopeLabel = toScopeLabel(resolvedScopeType);

      const healthTotalBudget = currentMetrics.healthProjects.reduce(
        (sum, row) => sum + toAmount(row.total),
        0
      );
      const infraTotalBudget = currentMetrics.infraProjects.reduce(
        (sum, row) => sum + toAmount(row.total),
        0
      );

      const vm: LandingContentVM = {
        hero: {
          title: content.hero.title,
          subtitle: content.hero.subtitle,
          ctaLabel: content.hero.ctaLabel,
          ctaHrefOrAction: { type: "href", value: content.hero.ctaHref },
        },
        manifesto: {
          eyebrow: content.manifesto.eyebrow,
          lines: content.manifesto.lines,
          subtext: content.manifesto.subtext,
        },
        lguOverview: {
          lguName,
          scopeLabel,
          fiscalYearLabel: `FY ${resolvedFiscalYear}`,
          totalBudget: currentMetrics.totalBudget,
          budgetDeltaLabel,
          projectCount: currentMetrics.projectCount,
          projectDeltaLabel,
          aipStatus: hasData ? "Published" : "No published AIP",
          activeUsers: feedbackMetrics.activeUsers,
          map: {
            center: { lat: mapCenterPin.lat, lng: mapCenterPin.lng },
            zoom: content.defaultZoom,
            selectedFiscalYear: resolvedFiscalYear,
            markers: mapMarkers,
          },
        },
        distribution: {
          total: currentMetrics.totalBudget,
          unitLabel: "PHP",
          sectors: distributionSectors,
        },
        healthHighlights: {
          categoryKey: "health",
          heading: "Health Projects",
          description:
            "Strengthening healthcare access through facility improvements, equipment funding, and community health programs.",
          primaryKpiLabel: "Total Healthcare Budget",
          primaryKpiValue: healthTotalBudget,
          secondaryKpiLabel: "Total Projects",
          secondaryKpiValue: currentMetrics.healthProjects.length,
          totalBudget: healthTotalBudget,
          projects: toProjectCards({
            projects: currentMetrics.healthProjects,
            tagLabel: "Health",
          }),
        },
        infraHighlights: {
          categoryKey: "infrastructure",
          heading: "Infrastructure Development",
          description:
            "Building roads, public facilities, and essential systems that support growth and daily life.",
          primaryKpiLabel: "Total Infrastructure Budget",
          primaryKpiValue: infraTotalBudget,
          secondaryKpiLabel: "Total Projects",
          secondaryKpiValue: currentMetrics.infraProjects.length,
          totalBudget: infraTotalBudget,
          projects: toProjectCards({
            projects: currentMetrics.infraProjects,
            tagLabel: "Infrastructure",
          }),
        },
        feedback: {
          title: content.feedback.title,
          subtitle: content.feedback.subtitle,
          months: feedbackMetrics.months,
          series: feedbackMetrics.series,
          categorySummary: feedbackMetrics.categorySummary,
          responseRate: feedbackMetrics.responseRate,
          avgResponseTimeDays: feedbackMetrics.avgResponseTimeDays,
        },
        chatPreview: {
          pillLabel: content.chatPreview.pillLabel,
          title: content.chatPreview.title,
          subtitle: content.chatPreview.subtitle,
          assistantName: content.chatPreview.assistantName,
          assistantStatus: content.chatPreview.assistantStatus,
          userPrompt: content.chatPreview.userPrompt,
          assistantIntro: content.chatPreview.assistantIntro,
          assistantBullets: content.chatPreview.assistantBullets,
          suggestedPrompts: content.chatPreview.suggestedPrompts,
          ctaLabel: content.chatPreview.ctaLabel,
          ctaHref: content.chatPreview.ctaHref,
        },
        finalCta: {
          title: content.finalCta.title,
          subtitle: content.finalCta.subtitle,
          ctaLabel: content.finalCta.ctaLabel,
          ctaHref: currentYearAipId ? `/aips/${encodeURIComponent(currentYearAipId)}` : undefined,
        },
      };

      const fallbackApplied =
        selectedScope.scopeFallbackApplied || fiscalResolution.fiscalFallbackApplied;

      return {
        vm,
        meta: {
          hasData,
          availableFiscalYears,
          selection: {
            requestedScopeType: normalizedQuery.requestedScopeType,
            requestedScopeId: normalizedQuery.requestedScopeId,
            requestedFiscalYear: normalizedQuery.requestedFiscalYear,
            resolvedScopeType,
            resolvedScopeId,
            resolvedScopePsgc,
            resolvedFiscalYear,
            fallbackApplied,
          },
        },
      };
    },
  };
}
