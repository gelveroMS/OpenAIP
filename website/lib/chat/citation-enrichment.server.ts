import "server-only";

import { chunkArray, dedupeNonEmptyStrings } from "@/lib/repos/_shared/supabase-batching";
import type { ChatCitation } from "@/lib/repos/chat/types";
import type { supabaseServer } from "@/lib/supabase/server";

const REF_CODE_PATTERN = /\bref(?:erence)?(?:\s+code)?\s*[:#-]?\s*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\b/i;

type SupabaseServerClient = Awaited<ReturnType<typeof supabaseServer>>;

type CitationMetadata = Record<string, unknown>;

type ResolutionCandidate = {
  index: number;
  aipId: string;
  refCode: string;
};

type ProjectLookupRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string | null;
  program_project_description: string | null;
};

type AipLookupRow = {
  id: string;
  fiscal_year: number | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ScopeNameMaps = {
  barangayNames: Map<string, string>;
  cityNames: Map<string, string>;
  municipalityNames: Map<string, string>;
};

const EMPTY_SCOPE_NAME_MAPS: ScopeNameMaps = {
  barangayNames: new Map<string, string>(),
  cityNames: new Map<string, string>(),
  municipalityNames: new Map<string, string>(),
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRefCode(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, "").toUpperCase();
}

function normalizeFiscalYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function toPairKey(aipId: string, refCode: string): string {
  return `${aipId}::${refCode.toUpperCase()}`;
}

function extractCitationMetadata(citation: ChatCitation): CitationMetadata {
  if (!citation.metadata || typeof citation.metadata !== "object" || Array.isArray(citation.metadata)) {
    return {};
  }
  return citation.metadata as CitationMetadata;
}

function parseRefCodeFromSnippet(snippet: string): string | null {
  const match = snippet.match(REF_CODE_PATTERN);
  if (!match) return null;
  return normalizeRefCode(match[1]);
}

function collectResolutionCandidates(citations: ChatCitation[]): ResolutionCandidate[] {
  const candidates: ResolutionCandidate[] = [];

  for (const [index, citation] of citations.entries()) {
    const metadata = extractCitationMetadata(citation);
    const aipId =
      normalizeText(citation.aipId) ??
      normalizeText(metadata.aip_id) ??
      null;
    if (!aipId) continue;

    const refCode =
      normalizeRefCode(citation.projectRefCode) ??
      normalizeRefCode(metadata.project_ref_code) ??
      normalizeRefCode(metadata.aip_ref_code) ??
      parseRefCodeFromSnippet(citation.snippet);
    if (!refCode) continue;

    candidates.push({ index, aipId, refCode });
  }

  return candidates;
}

function collectAipIdsFromCitations(citations: ChatCitation[]): string[] {
  const aipIds = citations
    .map((citation) => {
      const metadata = extractCitationMetadata(citation);
      return normalizeText(citation.aipId) ?? normalizeText(metadata.aip_id);
    })
    .filter((value): value is string => Boolean(value));
  return dedupeNonEmptyStrings(aipIds);
}

async function fetchProjectRows(
  client: SupabaseServerClient,
  candidates: ResolutionCandidate[]
): Promise<ProjectLookupRow[]> {
  const aipIds = dedupeNonEmptyStrings(candidates.map((candidate) => candidate.aipId));
  const refCodes = dedupeNonEmptyStrings(candidates.map((candidate) => candidate.refCode));
  if (!aipIds.length || !refCodes.length) return [];

  const rows: ProjectLookupRow[] = [];
  for (const aipIdChunk of chunkArray(aipIds)) {
    for (const refCodeChunk of chunkArray(refCodes)) {
      const { data, error } = await client
        .from("projects")
        .select("id,aip_id,aip_ref_code,program_project_description")
        .in("aip_id", aipIdChunk)
        .in("aip_ref_code", refCodeChunk);

      if (error) {
        throw new Error(error.message);
      }

      rows.push(...((data ?? []) as ProjectLookupRow[]));
    }
  }

  return rows;
}

async function fetchAipRows(
  client: SupabaseServerClient,
  aipIds: string[]
): Promise<Map<string, AipLookupRow>> {
  const rows: AipLookupRow[] = [];

  for (const aipIdChunk of chunkArray(aipIds)) {
    const { data, error } = await client
      .from("aips")
      .select("id,fiscal_year,barangay_id,city_id,municipality_id")
      .in("id", aipIdChunk);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as AipLookupRow[]));
  }

  return new Map(rows.map((row) => [row.id, row]));
}

async function fetchScopeNameMap(
  client: SupabaseServerClient,
  table: "barangays" | "cities" | "municipalities",
  ids: string[]
): Promise<Map<string, string>> {
  if (!ids.length) return new Map<string, string>();

  const rows: Array<{ id: string; name: string | null }> = [];
  for (const idChunk of chunkArray(ids)) {
    const { data, error } = await client
      .from(table)
      .select("id,name")
      .in("id", idChunk);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as Array<{ id: string; name: string | null }>));
  }

  const map = new Map<string, string>();
  for (const row of rows) {
    const id = normalizeText(row.id);
    const name = normalizeText(row.name);
    if (!id || !name) continue;
    map.set(id, name);
  }
  return map;
}

async function fetchScopeNames(
  client: SupabaseServerClient,
  aipById: Map<string, AipLookupRow>
): Promise<ScopeNameMaps> {
  const barangayIds = dedupeNonEmptyStrings(
    Array.from(aipById.values())
      .map((row) => normalizeText(row.barangay_id))
      .filter((value): value is string => Boolean(value))
  );
  const cityIds = dedupeNonEmptyStrings(
    Array.from(aipById.values())
      .map((row) => normalizeText(row.city_id))
      .filter((value): value is string => Boolean(value))
  );
  const municipalityIds = dedupeNonEmptyStrings(
    Array.from(aipById.values())
      .map((row) => normalizeText(row.municipality_id))
      .filter((value): value is string => Boolean(value))
  );

  const [barangayNames, cityNames, municipalityNames] = await Promise.all([
    fetchScopeNameMap(client, "barangays", barangayIds),
    fetchScopeNameMap(client, "cities", cityIds),
    fetchScopeNameMap(client, "municipalities", municipalityIds),
  ]);

  return { barangayNames, cityNames, municipalityNames };
}

function resolveLguNameFromAip(aip: AipLookupRow | null, names: ScopeNameMaps): string | null {
  if (!aip) return null;

  const barangayId = normalizeText(aip.barangay_id);
  if (barangayId) return names.barangayNames.get(barangayId) ?? null;

  const cityId = normalizeText(aip.city_id);
  if (cityId) return names.cityNames.get(cityId) ?? null;

  const municipalityId = normalizeText(aip.municipality_id);
  if (municipalityId) return names.municipalityNames.get(municipalityId) ?? null;

  return null;
}

function resolveScopeNameFromCitation(citation: ChatCitation, projectTitle: string | null): string | null {
  const scopeType = citation.scopeType;
  if (scopeType !== "barangay" && scopeType !== "city" && scopeType !== "municipality") {
    return null;
  }

  const scopeName = normalizeText(citation.scopeName);
  if (!scopeName) return null;
  const lowered = scopeName.toLowerCase();
  if (lowered === "unknown scope" || lowered.includes("published aip")) {
    return null;
  }

  const normalizedTitle = normalizeText(projectTitle);
  if (normalizedTitle && normalizedTitle.toLowerCase() === lowered) {
    return null;
  }

  return scopeName;
}

export async function enrichChatCitationsWithProjectLinks(input: {
  client: SupabaseServerClient;
  citations: ChatCitation[];
}): Promise<ChatCitation[]> {
  if (!input.citations.length) return input.citations;

  const candidates = collectResolutionCandidates(input.citations);
  const aipIdsFromCitations = collectAipIdsFromCitations(input.citations);
  const projectRows = candidates.length
    ? await fetchProjectRows(input.client, candidates)
    : [];
  const rowsByPairKey = new Map<string, ProjectLookupRow[]>();
  for (const row of projectRows) {
    const aipId = normalizeText(row.aip_id);
    const refCode = normalizeRefCode(row.aip_ref_code);
    if (!aipId || !refCode) continue;

    const key = toPairKey(aipId, refCode);
    const existing = rowsByPairKey.get(key) ?? [];
    existing.push(row);
    rowsByPairKey.set(key, existing);
  }

  const resolvedByIndex = new Map<number, ProjectLookupRow>();
  for (const candidate of candidates) {
    const key = toPairKey(candidate.aipId, candidate.refCode);
    const rows = rowsByPairKey.get(key) ?? [];
    if (rows.length === 1) {
      resolvedByIndex.set(candidate.index, rows[0]);
    }
  }

  if (!resolvedByIndex.size && !aipIdsFromCitations.length) return input.citations;

  const resolvedAipIds = dedupeNonEmptyStrings([
    ...aipIdsFromCitations,
    Array.from(resolvedByIndex.values()).map((row) => row.aip_id)
      .filter((value): value is string => Boolean(value)),
  ].flat());
  const aipById = resolvedAipIds.length
    ? await fetchAipRows(input.client, resolvedAipIds)
    : new Map<string, AipLookupRow>();
  const scopeNameMaps = aipById.size
    ? await fetchScopeNames(input.client, aipById)
    : EMPTY_SCOPE_NAME_MAPS;
  const candidatesByIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));

  return input.citations.map((citation, index) => {
    const metadata = extractCitationMetadata(citation);
    const resolvedProject = resolvedByIndex.get(index) ?? null;
    const candidate = candidatesByIndex.get(index) ?? null;
    const aipId =
      normalizeText(citation.aipId) ??
      normalizeText(metadata.aip_id) ??
      normalizeText(resolvedProject?.aip_id) ??
      normalizeText(candidate?.aipId) ??
      null;
    const aip = aipId ? aipById.get(aipId) ?? null : null;

    const resolvedFiscalYear =
      normalizeFiscalYear(citation.fiscalYear) ??
      normalizeFiscalYear(citation.resolvedFiscalYear) ??
      normalizeFiscalYear(aip?.fiscal_year) ??
      null;
    const projectId =
      normalizeText(citation.projectId) ??
      normalizeText(metadata.project_id) ??
      normalizeText(resolvedProject?.id) ??
      null;
    const projectRefCode =
      normalizeRefCode(citation.projectRefCode) ??
      normalizeRefCode(metadata.project_ref_code) ??
      normalizeRefCode(metadata.aip_ref_code) ??
      normalizeRefCode(resolvedProject?.aip_ref_code) ??
      normalizeRefCode(candidate?.refCode) ??
      null;
    const projectTitle =
      normalizeText(citation.projectTitle) ??
      normalizeText(metadata.program_project_title) ??
      normalizeText(resolvedProject?.program_project_description) ??
      null;
    const lguName =
      normalizeText(citation.lguName) ??
      resolveScopeNameFromCitation(citation, projectTitle) ??
      resolveLguNameFromAip(aip, scopeNameMaps) ??
      null;

    const enriched: ChatCitation = {
      ...citation,
    };
    if (aipId) enriched.aipId = aipId;
    if (projectId) enriched.projectId = projectId;
    if (projectRefCode) enriched.projectRefCode = projectRefCode;
    if (projectTitle) enriched.projectTitle = projectTitle;
    if (lguName) enriched.lguName = lguName;
    if (resolvedFiscalYear !== null) enriched.resolvedFiscalYear = resolvedFiscalYear;

    return enriched;
  });
}
