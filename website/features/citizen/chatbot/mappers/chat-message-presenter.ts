import type { Json } from "@/lib/contracts/databasev2";
import type { CitizenChatFollowUp, CitizenChatEvidenceItem } from "../types/citizen-chatbot.types";

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length ? trimmed : null;
}

export function mapEvidenceFromCitations(citations: Json | null): CitizenChatEvidenceItem[] {
  if (!Array.isArray(citations)) return [];

  return citations
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

      const row = entry as Record<string, unknown>;
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

      const legacyPageOrSection = normalizeText(row.pageOrSection);
      const canonicalPageOrSection =
        typeof metadata.page_no === "number"
          ? `Page ${metadata.page_no}`
          : typeof row.source_page === "number"
            ? `Page ${row.source_page}`
            : normalizeText(metadata.section);

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
      };
    })
    .filter((item): item is CitizenChatEvidenceItem => item !== null);
}

export function mapFollowUpsFromRetrievalMeta(meta: Json | null): CitizenChatFollowUp[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];

  const row = meta as { suggestions?: unknown; suggestedFollowUps?: unknown };
  const source = Array.isArray(row.suggestions) ? row.suggestions : row.suggestedFollowUps;
  if (!Array.isArray(source)) return [];

  return source
    .map((value, index) => {
      const label = normalizeText(value);
      if (!label) return null;
      return {
        id: `follow_up_${index + 1}`,
        label,
      };
    })
    .filter((item): item is CitizenChatFollowUp => item !== null);
}
