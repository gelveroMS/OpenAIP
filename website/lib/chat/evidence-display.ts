type EvidenceMetadata = Record<string, unknown>;

export type EvidenceCitationLike = {
  sourceId?: unknown;
  source_id?: unknown;
  scopeType?: unknown;
  scope_type?: unknown;
  scopeName?: unknown;
  scope_name?: unknown;
  lguName?: unknown;
  lgu_name?: unknown;
  fiscalYear?: unknown;
  fiscal_year?: unknown;
  resolvedFiscalYear?: unknown;
  resolved_fiscal_year?: unknown;
  projectTitle?: unknown;
  project_title?: unknown;
  insufficient?: unknown;
  metadata?: unknown;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeYear(value: unknown): number | null {
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

function toMetadata(citation: EvidenceCitationLike): EvidenceMetadata {
  if (!citation.metadata || typeof citation.metadata !== "object" || Array.isArray(citation.metadata)) {
    return {};
  }
  return citation.metadata as EvidenceMetadata;
}

function normalizeFallbackSnippet(value: unknown): string | null {
  const snippet = normalizeText(value);
  if (!snippet) return null;
  return snippet.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasFallbackSnippet(citation: EvidenceCitationLike): boolean {
  const normalizedSnippet = normalizeFallbackSnippet((citation as Record<string, unknown>).snippet);
  if (!normalizedSnippet) return false;
  return (
    normalizedSnippet.includes("no retrieval citations were produced for this response.") ||
    normalizedSnippet.includes("pipeline request failed.")
  );
}

function isUsableLguScopeName(scopeName: string): boolean {
  const lowered = scopeName.toLowerCase();
  if (lowered === "unknown scope") return false;
  if (lowered.includes("published aip")) return false;
  return true;
}

function resolveSourceToken(citation: EvidenceCitationLike, index: number): string {
  return normalizeText(citation.sourceId ?? citation.source_id) ?? `S${index + 1}`;
}

function resolveLguLabel(citation: EvidenceCitationLike): string {
  const lguName = normalizeText(citation.lguName ?? citation.lgu_name);
  if (lguName) return lguName;

  const scopeName = normalizeText(citation.scopeName ?? citation.scope_name);
  if (scopeName && isUsableLguScopeName(scopeName)) return scopeName;

  return "Unknown LGU";
}

function resolveFiscalYearLabel(citation: EvidenceCitationLike): string {
  const fiscalYear =
    normalizeYear(citation.resolvedFiscalYear ?? citation.resolved_fiscal_year) ??
    normalizeYear(citation.fiscalYear ?? citation.fiscal_year);
  return fiscalYear !== null ? String(fiscalYear) : "Unknown FY";
}

function resolveProgramLabel(citation: EvidenceCitationLike): string {
  const metadata = toMetadata(citation);
  const projectTitle =
    normalizeText(citation.projectTitle ?? citation.project_title) ??
    normalizeText(metadata.program_project_title) ??
    normalizeText(metadata.project_title);
  if (projectTitle) return projectTitle;

  if (isTotalsEvidenceCitation(citation)) return "AIP";
  return "Unknown Program";
}

export function isTotalsEvidenceCitation(citation: EvidenceCitationLike): boolean {
  const metadata = toMetadata(citation);
  const type = normalizeText(metadata.type)?.toLowerCase() ?? null;
  if (type === "aip_totals") return true;
  const aggregateType = normalizeText(metadata.aggregate_type)?.toLowerCase() ?? null;
  return type === "aip_line_items" && aggregateType === "total_investment_program";
}

export function isSystemEvidenceCitation(citation: EvidenceCitationLike): boolean {
  if (citation.insufficient !== true) return false;
  const sourceId = normalizeText(citation.sourceId ?? citation.source_id)?.toUpperCase() ?? null;
  return sourceId === "S0" || hasFallbackSnippet(citation);
}

export function formatEvidenceDisplayLine(citation: EvidenceCitationLike, index: number): string {
  const sourceToken = resolveSourceToken(citation, index);
  const lguLabel = resolveLguLabel(citation);
  const fiscalYearLabel = resolveFiscalYearLabel(citation);
  const programLabel = resolveProgramLabel(citation);
  return `[${sourceToken}] ${lguLabel} FY ${fiscalYearLabel} ${programLabel}`;
}
