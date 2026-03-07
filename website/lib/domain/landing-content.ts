import type { FeedbackCategorySummaryItem } from "@/lib/constants/feedback-category-summary";

export type LandingCtaTarget =
  | { type: "href"; value: string }
  | { type: "action"; value: string };

export type LandingScopeType = "city" | "barangay";

export type LandingHeroVM = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHrefOrAction: LandingCtaTarget;
};

export type LandingManifestoVM = {
  eyebrow: string;
  lines: string[];
  subtext: string;
};

export type LguOverviewMapMarkerVM = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind?: string;
  valueLabel?: string;
  scopeType?: LandingScopeType;
  scopeId?: string;
  scopePsgc?: string;
  isSelectable?: boolean;
  isSelected?: boolean;
};

export type LguOverviewMapVM = {
  center: { lat: number; lng: number };
  zoom: number;
  selectedFiscalYear?: number;
  markers: LguOverviewMapMarkerVM[];
};

export type LguOverviewVM = {
  lguName: string;
  scopeLabel: string;
  fiscalYearLabel: string;
  totalBudget: number;
  budgetDeltaLabel?: string;
  projectCount: number;
  projectDeltaLabel?: string;
  aipStatus: string;
  citizenCount: number;
  map: LguOverviewMapVM;
};

export type SectorDistributionItemVM = {
  key: string;
  label: string;
  amount: number;
  percent: number;
};

export type SectorDistributionVM = {
  total: number;
  unitLabel?: string;
  sectors: SectorDistributionItemVM[];
};

export type ProjectCardVM = {
  id: string;
  title: string;
  subtitle: string;
  tagLabel: string;
  budget: number;
  budgetLabel?: string;
  imageSrc: string;
  meta?: string[];
};

export type ProjectHighlightVM = {
  heading: string;
  description: string;
  primaryKpiLabel: string;
  primaryKpiValue: number;
  secondaryKpiLabel: string;
  secondaryKpiValue: number;
  projects: ProjectCardVM[];
  categoryKey?: string;
  totalBudget?: number;
};

export type FeedbackSeriesVM = {
  key: "2020" | "2021" | string;
  label: string;
  points: number[];
};

export type FeedbackSnapshotVM = {
  title?: string;
  subtitle?: string;
  months: string[];
  series: FeedbackSeriesVM[];
  categorySummary: FeedbackCategorySummaryItem[];
  responseRate: number;
  avgResponseTimeDays: number;
};

export type ChatPreviewVM = {
  pillLabel: string;
  title: string;
  subtitle: string;
  assistantName: string;
  assistantStatus: string;
  userPrompt: string;
  assistantIntro: string;
  assistantBullets: string[];
  suggestedPrompts: string[];
  ctaLabel: string;
  ctaHref?: string;
};

export type FinalCtaVM = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref?: string;
};

export type LandingContentVM = {
  hero: LandingHeroVM;
  manifesto: LandingManifestoVM;
  lguOverview: LguOverviewVM;
  distribution: SectorDistributionVM;
  healthHighlights: ProjectHighlightVM;
  infraHighlights: ProjectHighlightVM;
  feedback: FeedbackSnapshotVM;
  chatPreview: ChatPreviewVM;
  finalCta: FinalCtaVM;
};

export type LandingContentQuery = {
  scopeType?: LandingScopeType | null;
  scopeId?: string | null;
  fiscalYear?: number | null;
};

export type LandingContentSelectionMeta = {
  requestedScopeType: LandingScopeType | null;
  requestedScopeId: string | null;
  requestedFiscalYear: number | null;
  resolvedScopeType: LandingScopeType;
  resolvedScopeId: string;
  resolvedScopePsgc: string;
  resolvedFiscalYear: number;
  fallbackApplied: boolean;
};

export type LandingContentResultMeta = {
  hasData: boolean;
  selection: LandingContentSelectionMeta;
  availableFiscalYears: number[];
};

export type LandingContentResult = {
  vm: LandingContentVM;
  meta: LandingContentResultMeta;
};
