import type { Json } from "@/lib/contracts/databasev2";
import {
  formatEvidenceDisplayLine,
  isSystemEvidenceCitation,
  isTotalsEvidenceCitation,
} from "@/lib/chat/evidence-display";
import { isInsufficientContextReply } from "@/lib/chat/insufficient-context";
import type { CitizenChatEvidenceItem } from "../types/citizen-chatbot.types";

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length ? trimmed : null;
}

export function mapEvidenceFromCitations(
  citations: Json | null,
  messageContent?: string | null
): CitizenChatEvidenceItem[] {
  if (isInsufficientContextReply(messageContent)) return [];
  if (!Array.isArray(citations)) return [];
  const citationRows = citations.filter((entry): entry is Record<string, unknown> => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  ));
  if (!citationRows.length) return [];
  const visibleRows = citationRows.filter((row) => !isSystemEvidenceCitation(row));
  if (!visibleRows.length) return [];

  return visibleRows
    .map((row, index) => {
      const snippet = normalizeText(row.snippet);
      if (!snippet) return null;
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const aipId =
        normalizeText(row.aipId) ??
        normalizeText(row.aip_id) ??
        normalizeText(metadata.aip_id);
      const projectId =
        normalizeText(row.projectId) ??
        normalizeText(row.project_id) ??
        normalizeText(metadata.project_id);
      const projectHref =
        aipId && projectId
          ? `/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(projectId)}`
          : null;
      const totalsHref =
        aipId && isTotalsEvidenceCitation(row)
          ? `/aips/${encodeURIComponent(aipId)}`
          : null;
      const hasProjectLink = Boolean(projectHref);
      const hasTotalsLink = !hasProjectLink && Boolean(totalsHref);
      const href = hasProjectLink
        ? projectHref
        : hasTotalsLink
          ? totalsHref
          : null;

      return {
        id: normalizeText(row.id) ?? `evidence_${index + 1}`,
        displayLine: formatEvidenceDisplayLine(row, index),
        href,
      };
    })
    .filter((item): item is CitizenChatEvidenceItem => item !== null);
}

