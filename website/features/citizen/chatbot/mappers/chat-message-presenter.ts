import type { Json } from "@/lib/contracts/databasev2";
import type { CitizenChatEvidenceItem } from "../types/citizen-chatbot.types";

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeFiscalYearNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isInteger(input) && input > 0) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function isAipTotalsCitation(metadata: Record<string, unknown>): boolean {
  const type = normalizeText(metadata.type)?.toLowerCase() ?? null;
  if (type === "aip_totals") return true;
  const aggregateType = normalizeText(metadata.aggregate_type)?.toLowerCase() ?? null;
  return type === "aip_line_items" && aggregateType === "total_investment_program";
}

function isSystemCitationRow(row: Record<string, unknown>): boolean {
  const scopeType = normalizeText(row.scopeType ?? row.scope_type)?.toLowerCase() ?? null;
  if (scopeType === "system") return true;

  const sourceId = normalizeText(row.sourceId ?? row.source_id)?.toUpperCase() ?? null;
  return sourceId === "S0" && row.insufficient === true;
}

export function mapEvidenceFromCitations(citations: Json | null): CitizenChatEvidenceItem[] {
  if (!Array.isArray(citations)) return [];
  const citationRows = citations.filter((entry): entry is Record<string, unknown> => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  ));
  if (!citationRows.length) return [];
  if (!citationRows.some((row) => !isSystemCitationRow(row))) return [];

  return citationRows
    .map((row, index) => {
      const snippet = normalizeText(row.snippet);
      if (!snippet) return null;
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};

      const legacyFiscalYear = normalizeText(row.fiscalYear);
      const canonicalFiscalYear =
        typeof row.fiscalYear === "number"
          ? String(row.fiscalYear)
          : typeof row.fiscal_year === "number"
            ? String(row.fiscal_year)
            : typeof row.fiscalYear === "string"
              ? normalizeText(row.fiscalYear)
              : null;
      const resolvedFiscalYear = normalizeFiscalYearNumber(
        row.resolvedFiscalYear ?? row.resolved_fiscal_year ?? row.fiscalYear ?? row.fiscal_year
      );

      const legacyPageOrSection = normalizeText(row.pageOrSection);
      const canonicalPageOrSection =
        typeof metadata.page_no === "number"
          ? `Page ${metadata.page_no}`
          : typeof row.source_page === "number"
            ? `Page ${row.source_page}`
            : normalizeText(metadata.section);
      const aipId =
        normalizeText(row.aipId) ??
        normalizeText(row.aip_id) ??
        normalizeText(metadata.aip_id);
      const projectId =
        normalizeText(row.projectId) ??
        normalizeText(row.project_id) ??
        normalizeText(metadata.project_id);
      const lguName =
        normalizeText(row.lguName) ??
        normalizeText(row.lgu_name) ??
        normalizeText(metadata.lgu_name);
      const projectTitle =
        normalizeText(row.projectTitle) ??
        normalizeText(metadata.program_project_title) ??
        normalizeText(metadata.project_title);
      const projectHref =
        aipId && projectId
          ? `/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(projectId)}`
          : null;
      const projectLinkLabel =
        projectHref && lguName && resolvedFiscalYear !== null && projectTitle
          ? `${lguName} FY ${resolvedFiscalYear} ${projectTitle}`
          : null;
      const totalsHref =
        aipId && isAipTotalsCitation(metadata)
          ? `/aips/${encodeURIComponent(aipId)}`
          : null;
      const totalsLinkLabel =
        totalsHref && lguName && resolvedFiscalYear !== null
          ? `${lguName} FY ${resolvedFiscalYear} AIP`
          : null;
      const hasProjectLink = Boolean(projectHref && projectLinkLabel);
      const hasTotalsLink = !hasProjectLink && Boolean(totalsHref && totalsLinkLabel);
      const href = hasProjectLink
        ? projectHref
        : hasTotalsLink
          ? totalsHref
          : null;
      const linkLabel = hasProjectLink
        ? projectLinkLabel
        : hasTotalsLink
          ? totalsLinkLabel
          : null;

      return {
        id: normalizeText(row.id) ?? `evidence_${index + 1}`,
        documentLabel:
          normalizeText(row.documentLabel) ??
          normalizeText(metadata.document_label) ??
          normalizeText(row.scopeName) ??
          normalizeText(row.scope_name) ??
          "Published AIP",
        snippet,
        fiscalYear: legacyFiscalYear ?? canonicalFiscalYear,
        pageOrSection: legacyPageOrSection ?? canonicalPageOrSection ?? null,
        href,
        linkLabel,
      };
    })
    .filter((item): item is CitizenChatEvidenceItem => item !== null);
}

