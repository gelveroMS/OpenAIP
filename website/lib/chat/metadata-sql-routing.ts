import "server-only";

import { extractFiscalYear } from "@/lib/chat/intent";
import {
  detectMetadataIntent,
  type MetadataIntentResult,
  type MetadataIntentType,
} from "@/lib/chat/metadata-intent";
import type { ChatCitation, ChatRetrievalMeta, ChatScopeResolution } from "@/lib/repos/chat/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ScopeType = "barangay" | "city" | "municipality";

type PublishedAipRow = {
  id: string;
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ScopeNameRow = {
  id: string;
  name: string | null;
};

type MetadataSqlIntent = Exclude<MetadataIntentType, "none">;

export type MetadataSqlPayload = {
  intent: MetadataSqlIntent;
  content: string;
  citations: ChatCitation[];
  retrievalMeta: ChatRetrievalMeta;
  structuredValues: string[] | number[];
};

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function uniqSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function uniqSortedYears(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value)))).sort((a, b) => a - b);
}

function toPublishedAips(rows: unknown): PublishedAipRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: typeof value.id === "string" ? value.id : "",
        fiscal_year: typeof value.fiscal_year === "number" ? value.fiscal_year : Number.NaN,
        barangay_id: typeof value.barangay_id === "string" ? value.barangay_id : null,
        city_id: typeof value.city_id === "string" ? value.city_id : null,
        municipality_id: typeof value.municipality_id === "string" ? value.municipality_id : null,
      };
    })
    .filter((row) => row.id && Number.isFinite(row.fiscal_year));
}

function matchesScope(row: PublishedAipRow, scopeResolution: ChatScopeResolution): boolean {
  const targets = scopeResolution.resolvedTargets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return true;
  }

  return targets.some((target) => {
    if (target.scopeType === "barangay") return row.barangay_id === target.scopeId;
    if (target.scopeType === "city") return row.city_id === target.scopeId;
    return row.municipality_id === target.scopeId;
  });
}

function formatScopeLabel(scopeResolution: ChatScopeResolution): string {
  const targets = scopeResolution.resolvedTargets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return "all published scopes";
  }
  if (targets.length === 1) {
    const only = targets[0];
    if (only.scopeType === "barangay") {
      return /^barangay\s+/i.test(only.scopeName) ? only.scopeName : `Barangay ${only.scopeName}`;
    }
    if (only.scopeType === "city") {
      return /\bcity\b/i.test(only.scopeName) ? only.scopeName : `City ${only.scopeName}`;
    }
    return /\bmunicipality\b/i.test(only.scopeName)
      ? only.scopeName
      : `Municipality ${only.scopeName}`;
  }
  return "selected scopes";
}

function buildSystemCitation(metadata: Record<string, unknown>): ChatCitation {
  return {
    sourceId: "S0",
    snippet: "Computed from structured published AIP SQL tables.",
    scopeType: "system",
    scopeName: "Structured SQL metadata route",
    insufficient: false,
    metadata,
  };
}

function buildNoDataMessage(intent: MetadataSqlIntent, scopeLabel: string, fiscalYear: number | null): string {
  const fiscalLabel = fiscalYear === null ? "" : ` for FY ${fiscalYear}`;
  if (intent === "available_years") {
    return `No published fiscal years are available for ${scopeLabel}.`;
  }
  if (intent === "sector_list") {
    return `No sector values were found in published AIP line items for ${scopeLabel}${fiscalLabel}.`;
  }
  if (intent === "fund_source_list") {
    return `No fund source values were found in published AIP line items for ${scopeLabel}${fiscalLabel}.`;
  }
  if (intent === "project_categories") {
    return `No project categories were found from published AIP-linked projects for ${scopeLabel}${fiscalLabel}.`;
  }
  if (intent === "implementing_agencies") {
    return `No implementing agencies were found in published AIP line items for ${scopeLabel}${fiscalLabel}.`;
  }
  return `No published scope list is available for ${scopeLabel}${fiscalLabel}.`;
}

function formatListResponse(input: {
  title: string;
  values: string[] | number[];
  scopeLabel: string;
  fiscalYear: number | null;
}): string {
  const fiscalLabel = input.fiscalYear === null ? "" : `; FY ${input.fiscalYear}`;
  const lines = input.values.map((value, index) =>
    typeof value === "number" ? `${index + 1}. FY ${value}` : `${index + 1}. ${value}`
  );
  return `${input.title} (${input.scopeLabel}${fiscalLabel}):\n${lines.join("\n")}`;
}

async function fetchScopeNames(
  table: "barangays" | "cities" | "municipalities",
  ids: string[]
): Promise<Map<string, string>> {
  const deduped = Array.from(new Set(ids.filter(Boolean)));
  if (deduped.length === 0) return new Map<string, string>();

  const admin = supabaseAdmin();
  const { data, error } = await admin.from(table).select("id,name").in("id", deduped);
  if (error) throw new Error(error.message);

  const out = new Map<string, string>();
  for (const row of (data ?? []) as ScopeNameRow[]) {
    if (!row.id) continue;
    const name = normalizeTextValue(row.name);
    if (!name) continue;
    out.set(row.id, name);
  }
  return out;
}

async function resolveScopeListValues(aips: PublishedAipRow[]): Promise<string[]> {
  const barangayIds = uniqSortedStrings(
    aips.map((row) => row.barangay_id).filter((value): value is string => Boolean(value))
  );
  const cityIds = uniqSortedStrings(
    aips.map((row) => row.city_id).filter((value): value is string => Boolean(value))
  );
  const municipalityIds = uniqSortedStrings(
    aips
      .map((row) => row.municipality_id)
      .filter((value): value is string => Boolean(value))
  );

  const [barangayNames, cityNames, municipalityNames] = await Promise.all([
    fetchScopeNames("barangays", barangayIds),
    fetchScopeNames("cities", cityIds),
    fetchScopeNames("municipalities", municipalityIds),
  ]);

  const values: string[] = [];
  for (const id of barangayIds) {
    const name = barangayNames.get(id);
    if (name) values.push(/^barangay\s+/i.test(name) ? name : `Barangay ${name}`);
  }
  for (const id of cityIds) {
    const name = cityNames.get(id);
    if (name) values.push(/\bcity\b/i.test(name) ? name : `City ${name}`);
  }
  for (const id of municipalityIds) {
    const name = municipalityNames.get(id);
    if (name) values.push(/\bmunicipality\b/i.test(name) ? name : `Municipality ${name}`);
  }

  return uniqSortedStrings(values);
}

export async function resolveMetadataSqlPayload(input: {
  message: string;
  scopeResolution: ChatScopeResolution;
}): Promise<MetadataSqlPayload | null> {
  const detected: MetadataIntentResult = detectMetadataIntent(input.message);
  if (detected.intent === "none") {
    return null;
  }

  const requestedFiscalYear = extractFiscalYear(input.message);
  const admin = supabaseAdmin();
  let aipsQuery = admin
    .from("aips")
    .select("id,fiscal_year,barangay_id,city_id,municipality_id")
    .eq("status", "published");

  const shouldApplyFiscalYearFilter = detected.intent !== "available_years";
  if (shouldApplyFiscalYearFilter && requestedFiscalYear !== null) {
    aipsQuery = aipsQuery.eq("fiscal_year", requestedFiscalYear);
  }

  const { data: aipRowsRaw, error: aipError } = await aipsQuery;
  if (aipError) throw new Error(aipError.message);

  const publishedAips = toPublishedAips(aipRowsRaw).filter((row) => matchesScope(row, input.scopeResolution));
  const aipIds = publishedAips.map((row) => row.id);
  const scopeLabel = formatScopeLabel(input.scopeResolution);

  if (detected.intent === "available_years") {
    const years = uniqSortedYears(publishedAips.map((row) => row.fiscal_year));
    if (years.length === 0) {
      return {
        intent: detected.intent,
        content: buildNoDataMessage(detected.intent, scopeLabel, null),
        citations: [
          buildSystemCitation({
            type: "metadata_sql",
            metadata_intent: detected.intent,
            scope_mode: input.scopeResolution.mode,
            value_count: 0,
            aip_count: 0,
          }),
        ],
        retrievalMeta: {
          refused: false,
          reason: "ok",
          contextCount: 0,
          verifierMode: "structured",
        },
        structuredValues: [],
      };
    }

    return {
      intent: detected.intent,
      content: formatListResponse({
        title: "Available fiscal years",
        values: years,
        scopeLabel,
        fiscalYear: null,
      }),
      citations: [
        buildSystemCitation({
          type: "metadata_sql",
          metadata_intent: detected.intent,
          scope_mode: input.scopeResolution.mode,
          value_count: years.length,
          aip_count: aipIds.length,
        }),
      ],
      retrievalMeta: {
        refused: false,
        reason: "ok",
        contextCount: years.length,
        verifierMode: "structured",
      },
      structuredValues: years,
    };
  }

  if (aipIds.length === 0) {
    return {
      intent: detected.intent,
      content: buildNoDataMessage(detected.intent, scopeLabel, requestedFiscalYear),
      citations: [
        buildSystemCitation({
          type: "metadata_sql",
          metadata_intent: detected.intent,
          scope_mode: input.scopeResolution.mode,
          fiscal_year_filter: requestedFiscalYear,
          value_count: 0,
          aip_count: 0,
        }),
      ],
      retrievalMeta: {
        refused: false,
        reason: "ok",
        contextCount: 0,
        verifierMode: "structured",
      },
      structuredValues: [],
    };
  }

  let values: string[] = [];
  let responseTitle = "";

  if (detected.intent === "sector_list") {
    const { data, error } = await admin
      .from("aip_line_items")
      .select("sector_code,sector_name")
      .in("aip_id", aipIds);
    if (error) throw new Error(error.message);

    values = uniqSortedStrings(
      (Array.isArray(data) ? data : []).flatMap((row) => {
        const value = row as Record<string, unknown>;
        const name = normalizeTextValue(value.sector_name);
        const code = normalizeTextValue(value.sector_code);
        if (name && code) return [`${name} (${code})`];
        if (name) return [name];
        if (code) return [code];
        return [];
      })
    );
    responseTitle = "Sectors";
  } else if (detected.intent === "fund_source_list") {
    const { data, error } = await admin
      .from("aip_line_items")
      .select("fund_source")
      .in("aip_id", aipIds);
    if (error) throw new Error(error.message);

    values = uniqSortedStrings(
      (Array.isArray(data) ? data : []).map((row) => {
        const source = normalizeTextValue((row as Record<string, unknown>).fund_source);
        return source ?? "Unspecified";
      })
    );
    responseTitle = "Fund sources";
  } else if (detected.intent === "project_categories") {
    const { data, error } = await admin
      .from("projects")
      .select("category,aip_id")
      .in("aip_id", aipIds);
    if (error) throw new Error(error.message);

    values = uniqSortedStrings(
      (Array.isArray(data) ? data : []).flatMap((row) => {
        const category = normalizeTextValue((row as Record<string, unknown>).category);
        if (!category) return [];
        const label = category
          .split("_")
          .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
          .join(" ");
        return [label];
      })
    );
    responseTitle = "Project categories";
  } else if (detected.intent === "implementing_agencies") {
    const { data, error } = await admin
      .from("aip_line_items")
      .select("implementing_agency")
      .in("aip_id", aipIds);
    if (error) throw new Error(error.message);

    values = uniqSortedStrings(
      (Array.isArray(data) ? data : []).flatMap((row) => {
        const agency = normalizeTextValue((row as Record<string, unknown>).implementing_agency);
        return agency ? [agency] : [];
      })
    );
    responseTitle = "Implementing agencies";
  } else {
    values = await resolveScopeListValues(publishedAips);
    responseTitle = "Available scopes";
  }

  if (values.length === 0) {
    return {
      intent: detected.intent,
      content: buildNoDataMessage(detected.intent, scopeLabel, requestedFiscalYear),
      citations: [
        buildSystemCitation({
          type: "metadata_sql",
          metadata_intent: detected.intent,
          scope_mode: input.scopeResolution.mode,
          fiscal_year_filter: requestedFiscalYear,
          value_count: 0,
          aip_count: aipIds.length,
        }),
      ],
      retrievalMeta: {
        refused: false,
        reason: "ok",
        contextCount: 0,
        verifierMode: "structured",
      },
      structuredValues: [],
    };
  }

  return {
    intent: detected.intent,
    content: formatListResponse({
      title: responseTitle,
      values,
      scopeLabel,
      fiscalYear: shouldApplyFiscalYearFilter ? requestedFiscalYear : null,
    }),
    citations: [
      buildSystemCitation({
        type: "metadata_sql",
        metadata_intent: detected.intent,
        scope_mode: input.scopeResolution.mode,
        fiscal_year_filter: shouldApplyFiscalYearFilter ? requestedFiscalYear : null,
        value_count: values.length,
        aip_count: aipIds.length,
      }),
    ],
    retrievalMeta: {
      refused: false,
      reason: "ok",
      contextCount: values.length,
      verifierMode: "structured",
    },
    structuredValues: values,
  };
}
