import { detectAggregationIntent } from "@/lib/chat/aggregation-intent";
import { detectIntent } from "@/lib/chat/intent";
import { extractAipRefCode, isLineItemSpecificQuery } from "@/lib/chat/line-item-routing";

export type MetadataIntentType =
  | "available_years"
  | "sector_list"
  | "fund_source_list"
  | "project_categories"
  | "implementing_agencies"
  | "available_scopes"
  | "none";

export type MetadataIntentResult = {
  intent: MetadataIntentType;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(normalized: string, cues: string[]): boolean {
  return cues.some((cue) => normalized.includes(cue));
}

function hasEnumerationCue(normalized: string): boolean {
  return hasAny(normalized, [
    "list",
    "show",
    "available",
    "exist",
    "exists",
    "what are",
    "which are",
  ]);
}

export function detectMetadataIntent(message: string): MetadataIntentResult {
  const normalized = normalize(message);
  if (!normalized) return { intent: "none" };

  if (normalized.includes("what data do we have")) {
    return { intent: "none" };
  }

  if (
    /\b(and|plus|also)\b/.test(normalized) &&
    /\b(explain|describe|elaborate|tell me about)\b/.test(normalized)
  ) {
    return { intent: "none" };
  }

  if (detectIntent(message).intent === "total_investment_program") {
    return { intent: "none" };
  }

  if (detectAggregationIntent(message).intent !== "none") {
    return { intent: "none" };
  }

  if (extractAipRefCode(message) || isLineItemSpecificQuery(message)) {
    return { intent: "none" };
  }

  const asksYears =
    /\bwhat\s+years?\b/.test(normalized) ||
    /\bwhich\s+years?\b/.test(normalized) ||
    /\bavailable\s+years?\b/.test(normalized) ||
    /\blist\s+(?:all\s+)?(?:fiscal\s+)?years?\b/.test(normalized);
  if (asksYears) {
    return { intent: "available_years" };
  }

  const sectorTopic = hasAny(normalized, ["sector", "sectors"]);
  if (sectorTopic && hasEnumerationCue(normalized)) {
    return { intent: "sector_list" };
  }

  const fundSourceTopic = hasAny(normalized, [
    "fund source",
    "fund sources",
    "funding source",
    "funding sources",
    "source of funds",
    "sources of funds",
  ]);
  if (fundSourceTopic && hasEnumerationCue(normalized)) {
    return { intent: "fund_source_list" };
  }

  const categoryTopic = hasAny(normalized, [
    "project categories",
    "project category",
    "categories",
    "project types",
    "project type",
    "types of projects",
  ]);
  if (categoryTopic && hasEnumerationCue(normalized)) {
    return { intent: "project_categories" };
  }

  const implementingAgencyTopic = hasAny(normalized, [
    "implementing agencies",
    "implementing agency",
    "departments",
    "department",
    "offices",
    "office",
  ]);
  if (implementingAgencyTopic && hasEnumerationCue(normalized)) {
    return { intent: "implementing_agencies" };
  }

  const scopeTopic = hasAny(normalized, [
    "barangays",
    "barangay list",
    "available barangays",
    "available scopes",
    "available scope",
    "which barangays",
  ]);
  if (scopeTopic && hasEnumerationCue(normalized)) {
    return { intent: "available_scopes" };
  }

  return { intent: "none" };
}
