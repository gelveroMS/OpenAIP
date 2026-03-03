import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { formatTotalsEvidence } from "@/lib/chat/evidence";
import { buildRefusalMessage } from "@/lib/chat/refusal";
import {
  detectAggregationIntent,
  type AggregationIntentResult,
} from "@/lib/chat/aggregation-intent";
import {
  detectExplicitCityMention,
  listBarangayIdsInCity,
  resolveCityByNameExact,
  selectPublishedCityAip,
  type CityRef,
  type CityScopeResult,
} from "@/lib/chat/city-scope";
import { detectIntent, extractFiscalYear } from "@/lib/chat/intent";
import {
  buildClarificationOptions,
  buildLineItemAnswer,
  buildLineItemCitationScopeName,
  buildLineItemCitationSnippet,
  buildLineItemScopeDisclosure,
  extractAipRefCode,
  formatPhpAmount,
  parseLineItemQuestion,
  rerankLineItemCandidates,
  resolveLineItemScopeDecision,
  shouldAskLineItemClarification,
  isLineItemSpecificQuery,
  toPgVectorLiteral,
  type LineItemMatchCandidate,
  type LineItemRowRecord,
  type LineItemFactField,
  type LineItemScopeReason,
} from "@/lib/chat/line-item-routing";
import {
  requestPipelineChatAnswer,
  requestPipelineIntentClassify,
  requestPipelineQueryEmbedding,
} from "@/lib/chat/pipeline-client";
import {
  detectBareBarangayScopeMention,
  detectExplicitBarangayMention,
  normalizeBarangayNameForMatch,
  resolveTotalsScope,
  type BarangayRef,
  type TotalsScopeReason,
} from "@/lib/chat/scope";
import { resolveRetrievalScope } from "@/lib/chat/scope-resolver.server";
import { routeSqlFirstTotals, buildTotalsMissingMessage } from "@/lib/chat/totals-sql-routing";
import type { PipelineChatCitation, PipelineIntentClassification } from "@/lib/chat/types";
import type { Json } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getChatRepo } from "@/lib/repos/chat/repo.server";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import {
  assertActorPresent,
  assertPrivilegedWriteAccess,
  isInvariantError,
} from "@/lib/security/invariants";
import { getTypedAppSetting, isUserBlocked } from "@/lib/settings/app-settings";
import type {
  AggregationIntentType,
  ChatCitation,
  ChatClarificationContextCityFallback,
  ChatClarificationContextLineItem,
  ChatClarificationOption,
  ChatClarificationPayload,
  ChatCityFallbackClarificationOption,
  ChatMessage,
  ChatResponseStatus,
  ChatRetrievalMeta,
  ChatScopeResolution,
  RefusalReason,
} from "@/lib/repos/chat/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  consumeChatQuota,
  insertAssistantChatMessage,
  type PrivilegedActorContext,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";

const MAX_MESSAGE_LENGTH = 12000;

type ScopeType = "barangay" | "city" | "municipality";

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "assistant";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
};

type TotalsScopeTarget = {
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string | null;
};

type PublishedAipRow = {
  id: string;
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  created_at: string;
};

type AipTotalRow = {
  total_investment_program: number | string;
  page_no: number | null;
  evidence_text: string;
};

type RpcLineItemMatchRow = {
  line_item_id: string;
  aip_id: string;
  fiscal_year: number | null;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
  distance?: number | null;
  score?: number | null;
  similarity?: number | null;
};

type DbLineItemRow = {
  id: string;
  aip_id: string;
  fiscal_year: number;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  implementing_agency: string | null;
  start_date: string | null;
  end_date: string | null;
  fund_source: string | null;
  ps: number | null;
  mooe: number | null;
  co: number | null;
  fe: number | null;
  total: number | null;
  expected_output: string | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

type RpcTopProjectRow = {
  line_item_id: string;
  aip_id: string;
  fiscal_year: number | null;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  fund_source: string | null;
  start_date: string | null;
  end_date: string | null;
  total: number | string | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

type RpcTotalsBySectorRow = {
  sector_code: string | null;
  sector_name: string | null;
  sector_total: number | string | null;
  count_items: number | string | null;
};

type RpcTotalsByFundSourceRow = {
  fund_source: string | null;
  fund_total: number | string | null;
  count_items: number | string | null;
};

type RpcCompareFiscalYearTotalsRow = {
  year_a_total: number | string | null;
  year_b_total: number | string | null;
  delta: number | string | null;
};

type TotalsAssistantPayload = {
  content: string;
  citations: ChatCitation[];
  retrievalMeta: ChatRetrievalMeta;
};

type ScopeLookupRow = {
  id: string;
  name: string | null;
};

type RouteScopeReason =
  | LineItemScopeReason
  | TotalsScopeReason
  | "explicit_city"
  | "fallback_barangays_in_city";

type TotalsRoutingLogPayload = {
  request_id: string;
  intent: "total_investment_program";
  route: "sql_totals";
  fiscal_year_parsed: number | null;
  scope_reason: RouteScopeReason;
  explicit_scope_detected: boolean;
  barangay_id_used: string | null;
  aip_id_selected: string | null;
  totals_found: boolean;
  vector_called: false;
  city_id?: string | null;
  fallback_mode?: "barangays_in_city" | null;
  barangay_ids_count?: number | null;
  coverage_barangays?: string[];
  aggregation_source?: "aip_line_items" | "aip_totals_total_investment_program" | null;
  answered?: boolean;
  status?: ChatResponseStatus;
  refusal_reason?: RefusalReason;
};

type NonTotalsRoutingLogPayload = {
  request_id: string;
  intent:
    | "line_item_fact"
    | "unanswerable_field"
    | "clarification_needed"
    | "pipeline_fallback"
    | "aggregate_top_projects"
    | "aggregate_totals_by_sector"
    | "aggregate_totals_by_fund_source"
    | "aggregate_compare_years";
  route: "row_sql" | "pipeline_fallback" | "aggregate_sql";
  fiscal_year_parsed: number | null;
  scope_reason: RouteScopeReason;
  barangay_id_used: string | null;
  match_count_used: number | null;
  limit_used?: number | null;
  top_candidate_ids: string[];
  top_candidate_distances: number[];
  answered: boolean;
  // vector_called means the row-match RPC was called (not the query-embedding call).
  vector_called: boolean;
  city_id?: string | null;
  fallback_mode?: "barangays_in_city" | null;
  barangay_ids_count?: number | null;
  coverage_barangays?: string[];
  aggregation_source?: "aip_line_items" | "aip_totals_total_investment_program" | null;
  coverage_year_a_count?: number | null;
  coverage_year_b_count?: number | null;
  missing_year_a_count?: number | null;
  missing_year_b_count?: number | null;
  status?: ChatResponseStatus;
  refusal_reason?: RefusalReason;
};

type ClarificationLifecycleLogPayload =
  | {
      request_id: string;
      event: "clarification_created";
      session_id: string;
      clarification_id: string;
      option_count: number;
      top_candidate_ids: string[];
    }
  | {
      request_id: string;
      event: "clarification_resolved";
      session_id: string;
      clarification_id: string;
      selected_line_item_id: string;
    };

type ClarificationSelection =
  | { kind: "numeric"; optionIndex: number }
  | { kind: "ref"; refCode: string }
  | { kind: "title"; titleQuery: string };

type CityFallbackClarificationContext = ChatClarificationContextCityFallback;
type LineItemClarificationContext = ChatClarificationContextLineItem;

type PendingClarificationPayload = ChatClarificationPayload & {
  context?: LineItemClarificationContext | CityFallbackClarificationContext;
};

type PendingClarificationRecord = {
  messageId: string;
  payload: PendingClarificationPayload;
};

type AssistantMetaRow = {
  id: string;
  retrieval_meta: unknown | null;
};

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    citations: (row.citations as ChatCitation[]) ?? null,
    retrievalMeta: (row.retrieval_meta as ChatRetrievalMeta) ?? null,
  };
}

function normalizeUserMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_MESSAGE_LENGTH);
}

function containsDomainCues(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b20\d{2}\b/.test(normalized)) {
    return true;
  }

  const cues = [
    "aip",
    "budget",
    "investment",
    "total",
    "sum",
    "overall",
    "ref",
    "reference",
    "project",
    "program",
    "activity",
    "line item",
    "barangay",
    "city",
    "municipality",
    "fiscal",
    "year",
    "fy",
  ];

  return cues.some((cue) => normalized.includes(cue));
}

function isConversationalIntent(
  intent?: string
): intent is "GREETING" | "THANKS" | "COMPLAINT" | "CLARIFY" | "OUT_OF_SCOPE" {
  return (
    intent === "GREETING" ||
    intent === "THANKS" ||
    intent === "COMPLAINT" ||
    intent === "CLARIFY" ||
    intent === "OUT_OF_SCOPE"
  );
}

function conversationalReply(intent: string): string {
  switch (intent) {
    case "GREETING":
      return "Hi! I can help with published AIP totals, line items, and project details. Tell me the barangay/city and year you want to check.";
    case "THANKS":
      return "You're welcome! If you'd like, tell me the barangay/city and year and what AIP detail you want to check.";
    case "COMPLAINT":
      return "Thanks for flagging that. Which part seems incorrect (barangay/city, year, or project/ref code) so I can re-check based on the published AIP data?";
    case "CLARIFY":
      return "Sure - tell me the barangay/city, year, and (if available) the ref code or project name you mean.";
    case "OUT_OF_SCOPE":
      return "I can help with published AIP questions only. Ask about barangay/city budgets, fund sources, totals, or project details.";
    default:
      return "How can I help with the published AIP data?";
  }
}

function inferAggregationIntentFromPipelineClassification(input: {
  message: string;
  detected: AggregationIntentResult;
  frontendIntentClassification: PipelineIntentClassification | null;
}): AggregationIntentResult {
  if (input.detected.intent !== "none") {
    return input.detected;
  }

  const classification = input.frontendIntentClassification;
  if (!classification) {
    return input.detected;
  }

  const canUseClassification =
    classification.method === "rule" ||
    classification.confidence >= 0.6;
  if (!canUseClassification || classification.intent !== "CATEGORY_AGGREGATION") {
    return input.detected;
  }

  const normalized = input.message.toLowerCase();
  const hasSectorCue = normalized.includes("sector");
  const hasFundCue =
    normalized.includes("fund source") ||
    normalized.includes("fund sources") ||
    normalized.includes("funding source") ||
    normalized.includes("funding sources") ||
    normalized.includes("source of funds") ||
    normalized.includes("sources of funds");

  if (hasSectorCue) {
    return { intent: "totals_by_sector" };
  }

  if (hasFundCue) {
    return { intent: "totals_by_fund_source" };
  }

  return input.detected;
}

function isMissingConsumeQuotaRpcError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("consume_chat_quota") && normalized.includes("schema cache");
}

function toScopeResolution(input: {
  mode: ChatScopeResolution["mode"];
  requestedScopes: ChatScopeResolution["requestedScopes"];
  resolvedTargets: ChatScopeResolution["resolvedTargets"];
  unresolvedScopes: string[];
  ambiguousScopes: Array<{ scopeName: string; candidateCount: number }>;
}): ChatScopeResolution {
  return {
    mode: input.mode,
    requestedScopes: input.requestedScopes,
    resolvedTargets: input.resolvedTargets,
    unresolvedScopes: input.unresolvedScopes,
    ambiguousScopes: input.ambiguousScopes,
  };
}

function makeSystemCitation(snippet: string, metadata?: unknown): ChatCitation {
  return {
    sourceId: "S0",
    snippet,
    scopeType: "system",
    scopeName: "System",
    insufficient: true,
    metadata: metadata ?? null,
  };
}

function makeAggregateCitation(snippet: string, metadata?: unknown): ChatCitation {
  return {
    sourceId: "S0",
    snippet,
    scopeType: "system",
    scopeName: "Aggregated published AIP line items",
    insufficient: false,
    metadata: metadata ?? null,
  };
}

function normalizePipelineCitations(citations: PipelineChatCitation[]): ChatCitation[] {
  const normalized: ChatCitation[] = [];
  for (const citation of citations) {
    const snippet = typeof citation.snippet === "string" ? citation.snippet.trim() : "";
    if (!snippet) continue;

    normalized.push({
      sourceId: citation.source_id || "S0",
      chunkId: citation.chunk_id ?? null,
      aipId: citation.aip_id ?? null,
      fiscalYear: citation.fiscal_year ?? null,
      scopeType: citation.scope_type ?? "unknown",
      scopeId: citation.scope_id ?? null,
      scopeName: citation.scope_name ?? null,
      similarity: citation.similarity ?? null,
      snippet,
      insufficient: Boolean(citation.insufficient),
      metadata: citation.metadata ?? null,
    });
  }
  return normalized;
}

function toLineItemMatchCandidates(value: unknown): LineItemMatchCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: LineItemMatchCandidate[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const typed = row as Partial<RpcLineItemMatchRow>;
    if (!typed.line_item_id || !typed.aip_id || !typed.program_project_title) continue;
    candidates.push({
      line_item_id: typed.line_item_id,
      aip_id: typed.aip_id,
      fiscal_year: Number.isInteger(typed.fiscal_year)
        ? (typed.fiscal_year as number)
        : (() => {
            const parsed = toNumberOrNull(typed.fiscal_year);
            return Number.isInteger(parsed) ? parsed : null;
          })(),
      barangay_id: typeof typed.barangay_id === "string" ? typed.barangay_id : null,
      aip_ref_code: typeof typed.aip_ref_code === "string" ? typed.aip_ref_code : null,
      program_project_title: typed.program_project_title,
      page_no: Number.isInteger(typed.page_no) ? (typed.page_no as number) : null,
      row_no: Number.isInteger(typed.row_no) ? (typed.row_no as number) : null,
      table_no: Number.isInteger(typed.table_no) ? (typed.table_no as number) : null,
      distance:
        toNumberOrNull(typed.distance) ??
        (() => {
          const similarity = toNumberOrNull(typed.similarity);
          if (similarity === null) return null;
          return Math.max(0, 1 - similarity);
        })(),
      score:
        toNumberOrNull(typed.score) ??
        (() => {
          const distance = toNumberOrNull(typed.distance);
          if (distance !== null) return 1 / (1 + distance);
          return toNumberOrNull(typed.similarity);
        })(),
    });
  }
  return candidates;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSelectionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRefCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "").trim();
  return normalized || null;
}

function parseClarificationSelection(message: string): ClarificationSelection | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return {
      kind: "numeric",
      optionIndex: Number.parseInt(trimmed, 10),
    };
  }

  const refMatch = trimmed.match(/ref\s*([a-z0-9-]+)/i);
  if (refMatch?.[1]) {
    return {
      kind: "ref",
      refCode: refMatch[1],
    };
  }

  return {
    kind: "title",
    titleQuery: trimmed,
  };
}

function isShortClarificationInput(message: string): boolean {
  return message.trim().length > 0 && message.trim().length <= 30;
}

function shouldRepromptClarification(input: {
  message: string;
  selection: ClarificationSelection | null;
  frontendIntentClassification: PipelineIntentClassification | null;
}): boolean {
  if (!isShortClarificationInput(input.message)) {
    return false;
  }

  const frontendIntent = input.frontendIntentClassification?.intent ?? null;
  if (
    frontendIntent === "GREETING" ||
    frontendIntent === "THANKS" ||
    frontendIntent === "COMPLAINT" ||
    frontendIntent === "CLARIFY" ||
    frontendIntent === "DOCUMENT_EXPLANATION" ||
    frontendIntent === "OUT_OF_SCOPE"
  ) {
    return false;
  }

  if (input.selection?.kind === "numeric" || input.selection?.kind === "ref") {
    return true;
  }

  if (input.selection?.kind !== "title") {
    return false;
  }

  const normalized = normalizeSelectionText(input.message);
  if (!normalized) {
    return false;
  }

  const wordCount = normalized.split(" ").filter(Boolean).length;
  const looksLikeFreshMessage =
    input.message.includes("?") ||
    /\b(?:this|that|not|wrong|answer|issue|problem|why|what|how|who|when|where|help)\b/i.test(
      normalized
    );

  return wordCount <= 3 && !looksLikeFreshMessage;
}

function isClarificationCancelMessage(message: string): boolean {
  const normalized = normalizeSelectionText(message);
  if (!normalized) return false;

  return (
    normalized === "none of the above" ||
    normalized === "cancel" ||
    normalized.startsWith("cancel ") ||
    normalized === "stop" ||
    normalized === "nevermind" ||
    normalized === "never mind"
  );
}

function isLineItemClarificationPayload(
  payload: ChatClarificationPayload
): payload is Extract<ChatClarificationPayload, { kind: "line_item_disambiguation" }> {
  if (payload.kind !== "line_item_disambiguation") return false;
  return payload.options.length > 0;
}

function isCityFallbackClarificationPayload(
  payload: ChatClarificationPayload
): payload is Extract<ChatClarificationPayload, { kind: "city_aip_missing_fallback" }> {
  if (payload.kind !== "city_aip_missing_fallback") return false;
  return payload.options.length > 0;
}

function resolveLineItemClarificationOptionFromSelection(input: {
  selection: ClarificationSelection;
  options: ChatClarificationOption[];
}): ChatClarificationOption | null {
  if (input.selection.kind === "numeric") {
    const selectedIndex = input.selection.optionIndex;
    const option = input.options.find((item) => item.optionIndex === selectedIndex);
    return option ?? null;
  }

  if (input.selection.kind === "ref") {
    const normalizedSelectionRef = normalizeRefCode(input.selection.refCode);
    if (!normalizedSelectionRef) return null;
    const matches = input.options.filter((item) => normalizeRefCode(item.refCode) === normalizedSelectionRef);
    return matches.length === 1 ? matches[0] : null;
  }

  const normalizedQuery = normalizeSelectionText(input.selection.titleQuery);
  if (normalizedQuery.length < 3) return null;
  const titleMatches = input.options.filter((item) =>
    normalizeSelectionText(item.title).includes(normalizedQuery)
  );
  return titleMatches.length === 1 ? titleMatches[0] : null;
}

function resolveCityFallbackClarificationOptionFromSelection(input: {
  selection: ClarificationSelection;
  options: ChatCityFallbackClarificationOption[];
}): ChatCityFallbackClarificationOption | null {
  if (input.selection.kind !== "numeric") {
    return null;
  }
  const selectedIndex = input.selection.optionIndex;
  const option = input.options.find((item) => item.optionIndex === selectedIndex);
  return option ?? null;
}

function parseFactFields(input: string[] | undefined): LineItemFactField[] {
  const fields = new Set<LineItemFactField>();
  for (const raw of input ?? []) {
    if (
      raw === "amount" ||
      raw === "schedule" ||
      raw === "fund_source" ||
      raw === "implementing_agency" ||
      raw === "expected_output"
    ) {
      fields.add(raw);
    }
  }
  return Array.from(fields);
}

function buildClarificationPromptContent(payload: ChatClarificationPayload): string {
  if (payload.kind === "city_aip_missing_fallback") {
    const optionsText = payload.options.map((option) => `${option.optionIndex}. ${option.label}`).join("\n");
    return `${payload.prompt}\n${optionsText}`;
  }

  return `${payload.prompt}\n${payload.options
    .map(
      (option) =>
        `${option.optionIndex}. ${option.title}` +
        (option.refCode ? ` (Ref ${option.refCode})` : "") +
        (option.total ? ` - Total: ${option.total}` : "") +
        (option.fiscalYear ? ` - FY ${option.fiscalYear}` : "") +
        (option.barangayName ? ` - ${option.barangayName}` : "")
    )
    .join("\n")}`;
}

function toClarificationTotal(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return formatPhpAmount(value);
}

function buildStructuredClarificationOptions(input: {
  candidates: Array<{
    line_item_id: string;
    program_project_title: string;
    aip_ref_code: string | null;
    fiscal_year: number | null;
  }>;
  rowsById: Map<string, LineItemRowRecord>;
  defaultBarangayName: string | null;
}): ChatClarificationOption[] {
  const options: ChatClarificationOption[] = [];
  const seenLineItemIds = new Set<string>();

  for (const candidate of input.candidates) {
    if (seenLineItemIds.has(candidate.line_item_id)) continue;
    seenLineItemIds.add(candidate.line_item_id);

    const row = input.rowsById.get(candidate.line_item_id) ?? null;
    const title = (row?.program_project_title || candidate.program_project_title || "").trim();
    if (!title) continue;

    const refCode = (row?.aip_ref_code ?? candidate.aip_ref_code ?? "").trim() || null;
    const fiscalYear =
      typeof row?.fiscal_year === "number"
        ? row.fiscal_year
        : typeof candidate.fiscal_year === "number"
          ? candidate.fiscal_year
          : null;

    options.push({
      optionIndex: options.length + 1,
      lineItemId: candidate.line_item_id,
      title,
      refCode,
      fiscalYear,
      barangayName: input.defaultBarangayName,
      total: toClarificationTotal(row?.total ?? null),
    });

    if (options.length >= 3) break;
  }

  return options;
}

function toLineItemRows(value: unknown): LineItemRowRecord[] {
  if (!Array.isArray(value)) return [];
  const rows: LineItemRowRecord[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const typed = row as Partial<DbLineItemRow>;
    if (!typed.id || !typed.aip_id || !typed.program_project_title || typeof typed.fiscal_year !== "number") {
      continue;
    }
    rows.push({
      id: typed.id,
      aip_id: typed.aip_id,
      fiscal_year: typed.fiscal_year,
      barangay_id: typeof typed.barangay_id === "string" ? typed.barangay_id : null,
      aip_ref_code: typeof typed.aip_ref_code === "string" ? typed.aip_ref_code : null,
      program_project_title: typed.program_project_title,
      implementing_agency: typeof typed.implementing_agency === "string" ? typed.implementing_agency : null,
      start_date: typeof typed.start_date === "string" ? typed.start_date : null,
      end_date: typeof typed.end_date === "string" ? typed.end_date : null,
      fund_source: typeof typed.fund_source === "string" ? typed.fund_source : null,
      ps: toNumberOrNull(typed.ps),
      mooe: toNumberOrNull(typed.mooe),
      co: toNumberOrNull(typed.co),
      fe: toNumberOrNull(typed.fe),
      total: toNumberOrNull(typed.total),
      expected_output: typeof typed.expected_output === "string" ? typed.expected_output : null,
      page_no: Number.isInteger(typed.page_no) ? (typed.page_no as number) : null,
      row_no: Number.isInteger(typed.row_no) ? (typed.row_no as number) : null,
      table_no: Number.isInteger(typed.table_no) ? (typed.table_no as number) : null,
    });
  }
  return rows;
}

function toTopProjectRows(value: unknown): RpcTopProjectRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RpcTopProjectRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const typed = row as Partial<RpcTopProjectRow>;
    if (!typed.line_item_id || !typed.aip_id || !typed.program_project_title) continue;
    rows.push({
      line_item_id: typed.line_item_id,
      aip_id: typed.aip_id,
      fiscal_year: toNumberOrNull(typed.fiscal_year),
      barangay_id: typeof typed.barangay_id === "string" ? typed.barangay_id : null,
      aip_ref_code: typeof typed.aip_ref_code === "string" ? typed.aip_ref_code : null,
      program_project_title: typed.program_project_title,
      fund_source: typeof typed.fund_source === "string" ? typed.fund_source : null,
      start_date: typeof typed.start_date === "string" ? typed.start_date : null,
      end_date: typeof typed.end_date === "string" ? typed.end_date : null,
      total: typed.total ?? null,
      page_no: toNumberOrNull(typed.page_no),
      row_no: toNumberOrNull(typed.row_no),
      table_no: toNumberOrNull(typed.table_no),
    });
  }
  return rows;
}

function toTotalsBySectorRows(value: unknown): RpcTotalsBySectorRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RpcTotalsBySectorRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const typed = row as Partial<RpcTotalsBySectorRow>;
    rows.push({
      sector_code: typeof typed.sector_code === "string" ? typed.sector_code : null,
      sector_name: typeof typed.sector_name === "string" ? typed.sector_name : null,
      sector_total: typed.sector_total ?? null,
      count_items: typed.count_items ?? null,
    });
  }
  return rows;
}

function toTotalsByFundSourceRows(value: unknown): RpcTotalsByFundSourceRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RpcTotalsByFundSourceRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const typed = row as Partial<RpcTotalsByFundSourceRow>;
    rows.push({
      fund_source: typeof typed.fund_source === "string" ? typed.fund_source : null,
      fund_total: typed.fund_total ?? null,
      count_items: typed.count_items ?? null,
    });
  }
  return rows;
}

function toCompareTotalsRow(value: unknown): RpcCompareFiscalYearTotalsRow | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (!first || typeof first !== "object") return null;
  const typed = first as Partial<RpcCompareFiscalYearTotalsRow>;
  return {
    year_a_total: typed.year_a_total ?? null,
    year_b_total: typed.year_b_total ?? null,
    delta: typed.delta ?? null,
  };
}

function formatScheduleRange(startDate: string | null, endDate: string | null): string {
  const start = startDate?.trim() ?? "";
  const end = endDate?.trim() ?? "";
  if (start && end) return `${start}..${end}`;
  if (start) return `${start}..N/A`;
  if (end) return `N/A..${end}`;
  return "N/A";
}

function hasAggregationGlobalCue(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("all barangays") ||
    normalized.includes("across all barangays") ||
    normalized.includes("all published aips") ||
    normalized.includes("city-wide") ||
    normalized.includes("citywide")
  );
}

function isFundSourceListQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  const hasFundTopic =
    normalized.includes("fund source") ||
    normalized.includes("fund sources") ||
    normalized.includes("funding source") ||
    normalized.includes("source of funds") ||
    normalized.includes("sources of funds");
  if (!hasFundTopic) return false;

  return (
    normalized.includes("exist") ||
    normalized.includes("available") ||
    normalized.includes("list") ||
    normalized.includes("show") ||
    normalized.includes("what are")
  );
}

function parseInteger(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

type CityFallbackOriginalIntent = "total_investment_program" | AggregationLogIntent;

function toCityFallbackOriginalIntent(intent: AggregationIntentType): AggregationLogIntent {
  if (intent === "top_projects") return "aggregate_top_projects";
  if (intent === "totals_by_sector") return "aggregate_totals_by_sector";
  if (intent === "totals_by_fund_source") return "aggregate_totals_by_fund_source";
  return "aggregate_compare_years";
}

function fromCityFallbackOriginalIntent(
  intent: CityFallbackClarificationContext["originalIntent"]
): CityFallbackOriginalIntent | null {
  if (intent === "total_investment_program") return intent;
  if (
    intent === "aggregate_top_projects" ||
    intent === "aggregate_totals_by_sector" ||
    intent === "aggregate_totals_by_fund_source" ||
    intent === "aggregate_compare_years"
  ) {
    return intent;
  }
  // Backward compatibility with previously persisted payloads.
  if (intent === "top_projects") return "aggregate_top_projects";
  if (intent === "totals_by_sector") return "aggregate_totals_by_sector";
  if (intent === "totals_by_fund_source") return "aggregate_totals_by_fund_source";
  if (intent === "compare_years") return "aggregate_compare_years";
  return null;
}

function normalizeCityLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "the city";
  if (/^city of\s+/i.test(trimmed)) return trimmed;
  if (/\bcity\b/i.test(trimmed)) return `City of ${trimmed.replace(/\bcity\b/gi, "").trim()}`;
  return `City of ${trimmed}`;
}

function isLineItemClarificationContext(value: unknown): value is LineItemClarificationContext {
  if (!value || typeof value !== "object") return false;
  const typed = value as Partial<LineItemClarificationContext>;
  return (
    Array.isArray(typed.factFields) &&
    typeof typed.scopeReason === "string" &&
    (typed.barangayName === null || typeof typed.barangayName === "string")
  );
}

function isCityFallbackClarificationContext(
  value: unknown
): value is CityFallbackClarificationContext {
  if (!value || typeof value !== "object") return false;
  const typed = value as Partial<CityFallbackClarificationContext>;
  const normalizedIntent =
    typed.originalIntent === undefined
      ? null
      : fromCityFallbackOriginalIntent(typed.originalIntent);
  const fiscalYearParsed =
    typeof typed.fiscalYearParsed === "number" || typed.fiscalYearParsed === null
      ? typed.fiscalYearParsed
      : typeof typed.fiscalYear === "number" || typed.fiscalYear === null
        ? typed.fiscalYear
        : undefined;
  return (
    typeof typed.cityId === "string" &&
    typeof typed.cityName === "string" &&
    normalizedIntent !== null &&
    fiscalYearParsed !== undefined
  );
}

function buildCityAipMissingClarificationPayload(input: {
  cityName: string;
  fiscalYearParsed: number | null;
}): Extract<ChatClarificationPayload, { kind: "city_aip_missing_fallback" }> {
  const cityLabel = normalizeCityLabel(input.cityName);
  const yearLabel = input.fiscalYearParsed === null ? "" : ` (FY ${input.fiscalYearParsed})`;
  const prompt =
    `No published City AIP for ${cityLabel}${yearLabel}. ` +
    `Would you like to query across all barangays within ${cityLabel} instead?`;
  return {
    id: randomUUID(),
    kind: "city_aip_missing_fallback",
    prompt,
    options: [
      {
        optionIndex: 1,
        action: "use_barangays_in_city",
        label: `Use barangays in ${cityLabel}`,
      },
      {
        optionIndex: 2,
        action: "cancel",
        label: "Cancel",
      },
    ],
  };
}

type CoverageSummary = {
  line: string;
  coverageBarangays: string[];
  coveredCount: number;
  totalCount: number;
  missingCount: number;
};

type CompareScopeMode =
  | "global_barangays"
  | "barangays_in_city"
  | "single_barangay"
  | "city_aip";

type CompareYearCoveredRow = {
  lguId: string | null;
  lguName: string;
  aipId: string;
  total: number;
};

type CompareYearTotalsResult = {
  coveredRows: CompareYearCoveredRow[];
  missingIds: string[];
  missingNames: string[];
  coverageNames: string[];
  coverageLine: string;
  missingLine: string;
  contributingAipIds: string[];
  denominatorCount: number;
  coveredCount: number;
};

type CompareYearsVerboseAnswer = {
  content: string;
  overallYearATotal: number;
  overallYearBTotal: number;
  overallDelta: number;
  coverageBarangays: string[];
};

function formatCoverageNames(names: string[]): string[] {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  if (sorted.length <= 10) return sorted;
  return [...sorted.slice(0, 10), "..."];
}

function formatIdSample(values: string[]): string[] {
  const unique = values.filter((value, index, all) => value && all.indexOf(value) === index);
  if (unique.length <= 10) return unique;
  return [...unique.slice(0, 10), "..."];
}

async function buildCoverageSummary(input: {
  cityBarangayIds: string[];
  coveredBarangayIds: string[];
  fiscalLabel: string;
}): Promise<CoverageSummary> {
  const uniqueCoveredIds = input.coveredBarangayIds.filter(
    (id, index, all) => id && all.indexOf(id) === index
  );
  const cityBarangayNameMap = await fetchBarangayNameMap(input.cityBarangayIds);
  const coveredNameSet = new Set<string>();
  for (const coveredId of uniqueCoveredIds) {
    const name = cityBarangayNameMap.get(coveredId);
    if (name) coveredNameSet.add(normalizeBarangayLabel(name).replace(/^Barangay\s+/i, ""));
  }
  const coverageBarangays = formatCoverageNames(Array.from(coveredNameSet));
  const coveredCount = uniqueCoveredIds.length;
  const totalCount = input.cityBarangayIds.length;
  const missingCount = Math.max(0, totalCount - coveredCount);
  const coverageListText = coverageBarangays.length > 0 ? coverageBarangays.join(", ") : "none";
  return {
    line:
      `Coverage: ${coveredCount}/${totalCount} barangays have published ${input.fiscalLabel} AIPs ` +
      `(${coverageListText}).`,
    coverageBarangays,
    coveredCount,
    totalCount,
    missingCount,
  };
}

async function fetchTotalInvestmentProgramTotalsByYear(input: {
  year: number;
  scopeMode: CompareScopeMode;
  cityId?: string | null;
  cityName?: string | null;
  barangayId?: string | null;
  barangayName?: string | null;
  cityBarangayIds?: string[];
}): Promise<CompareYearTotalsResult> {
  const fiscalLabel = `FY${input.year}`;
  const cityLabel = normalizeCityLabel(input.cityName ?? "the city");
  const admin = supabaseAdmin();

  if (input.scopeMode === "city_aip") {
    if (!input.cityId) {
      return {
        coveredRows: [],
        missingIds: [],
        missingNames: [cityLabel],
        coverageNames: [],
        coverageLine: `Coverage ${fiscalLabel}: 0/1 city AIPs available (${cityLabel}).`,
        missingLine: `Missing ${fiscalLabel}: ${cityLabel}.`,
        contributingAipIds: [],
        denominatorCount: 1,
        coveredCount: 0,
      };
    }

    const cityAip = await selectPublishedCityAip(admin, input.cityId, input.year);
    if (!cityAip.aipId) {
      return {
        coveredRows: [],
        missingIds: [input.cityId],
        missingNames: [cityLabel],
        coverageNames: [],
        coverageLine: `Coverage ${fiscalLabel}: 0/1 city AIPs available (${cityLabel}).`,
        missingLine: `Missing ${fiscalLabel}: ${cityLabel}.`,
        contributingAipIds: [],
        denominatorCount: 1,
        coveredCount: 0,
      };
    }

    const { data: totalsRow, error: totalsError } = await admin
      .from("aip_totals")
      .select("aip_id,total_investment_program")
      .eq("source_label", "total_investment_program")
      .eq("aip_id", cityAip.aipId)
      .limit(1)
      .maybeSingle();
    if (totalsError) throw new Error(totalsError.message);

    const parsedTotal = parseAmount(
      (totalsRow as { total_investment_program?: unknown } | null)?.total_investment_program ?? null
    );

    if (parsedTotal === null) {
      return {
        coveredRows: [],
        missingIds: [input.cityId],
        missingNames: [cityLabel],
        coverageNames: [],
        coverageLine: `Coverage ${fiscalLabel}: 0/1 city AIPs with Total Investment Program totals (${cityLabel}).`,
        missingLine: `Missing ${fiscalLabel}: ${cityLabel}.`,
        contributingAipIds: [],
        denominatorCount: 1,
        coveredCount: 0,
      };
    }

    return {
      coveredRows: [
        {
          lguId: input.cityId,
          lguName: cityLabel,
          aipId: cityAip.aipId,
          total: parsedTotal,
        },
      ],
      missingIds: [],
      missingNames: [],
      coverageNames: [cityLabel],
      coverageLine: `Coverage ${fiscalLabel}: 1/1 city AIPs with Total Investment Program totals (${cityLabel}).`,
      missingLine: `Missing ${fiscalLabel}: none.`,
      contributingAipIds: [cityAip.aipId],
      denominatorCount: 1,
      coveredCount: 1,
    };
  }

  let candidateBarangays: BarangayRef[] = [];

  if (input.scopeMode === "global_barangays") {
    candidateBarangays = await fetchActiveBarangaysForMatching();
  } else if (input.scopeMode === "barangays_in_city") {
    const ids = (input.cityBarangayIds ?? []).filter(
      (id, index, all) => id && all.indexOf(id) === index
    );
    const nameMap = await fetchBarangayNameMap(ids);
    candidateBarangays = ids.map((id) => ({
      id,
      name: (nameMap.get(id) ?? `Barangay ID ${id}`).trim(),
    }));
  } else if (input.scopeMode === "single_barangay") {
    if (input.barangayId) {
      const nameMap = await fetchBarangayNameMap([input.barangayId]);
      candidateBarangays = [
        {
          id: input.barangayId,
          name:
            (nameMap.get(input.barangayId) ?? input.barangayName ?? `Barangay ID ${input.barangayId}`).trim(),
        },
      ];
    }
  }

  const candidateBarangayIds = candidateBarangays.map((row) => row.id);
  const candidateNameMap = new Map(candidateBarangays.map((row) => [row.id, row.name]));

  if (candidateBarangayIds.length === 0) {
    return {
      coveredRows: [],
      missingIds: [],
      missingNames: [],
      coverageNames: [],
      coverageLine: `Coverage ${fiscalLabel}: 0/0 barangays have published AIPs.`,
      missingLine: `Missing ${fiscalLabel}: none.`,
      contributingAipIds: [],
      denominatorCount: 0,
      coveredCount: 0,
    };
  }

  const publishedAips = await fetchPublishedBarangayAips({
    barangayIds: candidateBarangayIds,
    fiscalYear: input.year,
  });

  const publishedAipIds = publishedAips.map((row) => row.id);
  const aipTotalsById = new Map<string, number>();
  if (publishedAipIds.length > 0) {
    const { data: totalsRows, error: totalsError } = await admin
      .from("aip_totals")
      .select("aip_id,total_investment_program")
      .eq("source_label", "total_investment_program")
      .in("aip_id", publishedAipIds);
    if (totalsError) throw new Error(totalsError.message);

    for (const row of totalsRows ?? []) {
      const typed = row as { aip_id?: unknown; total_investment_program?: unknown };
      const aipId = typeof typed.aip_id === "string" ? typed.aip_id : null;
      const amount = parseAmount(typed.total_investment_program ?? null);
      if (aipId && amount !== null) {
        aipTotalsById.set(aipId, amount);
      }
    }
  }

  const groupedByBarangay = new Map<
    string,
    {
      lguId: string;
      lguName: string;
      total: number;
      aipIds: string[];
    }
  >();

  for (const aip of publishedAips) {
    const amount = aipTotalsById.get(aip.id);
    if (amount === undefined) continue;
    const current =
      groupedByBarangay.get(aip.barangay_id) ??
      {
        lguId: aip.barangay_id,
        lguName: (candidateNameMap.get(aip.barangay_id) ?? `Barangay ID ${aip.barangay_id}`).trim(),
        total: 0,
        aipIds: [],
      };
    current.total += amount;
    current.aipIds.push(aip.id);
    groupedByBarangay.set(aip.barangay_id, current);
  }

  const coveredRows: CompareYearCoveredRow[] = Array.from(groupedByBarangay.values())
    .sort((a, b) => a.lguName.localeCompare(b.lguName))
    .map((row) => ({
      lguId: row.lguId,
      lguName: row.lguName,
      aipId: row.aipIds[0] ?? "",
      total: row.total,
    }))
    .filter((row) => Boolean(row.aipId));

  const coveredIds = new Set(coveredRows.map((row) => row.lguId).filter((value): value is string => Boolean(value)));
  const missingIds = candidateBarangayIds.filter((id) => !coveredIds.has(id));

  const coverageNames = formatCoverageNames(
    coveredRows.map((row) => row.lguName.replace(/^Barangay\s+/i, ""))
  );
  const missingNames = formatCoverageNames(
    missingIds.map((id) => (candidateNameMap.get(id) ?? `Barangay ID ${id}`).replace(/^Barangay\s+/i, ""))
  );
  const coverageListText = coverageNames.length > 0 ? coverageNames.join(", ") : "none";
  const missingListText = missingNames.length > 0 ? missingNames.join(", ") : "none";

  const contributingAipIds = formatIdSample(
    Array.from(groupedByBarangay.values()).flatMap((row) => row.aipIds)
  );

  return {
    coveredRows,
    missingIds,
    missingNames,
    coverageNames,
    coverageLine:
      `Coverage ${fiscalLabel}: ${coveredRows.length}/${candidateBarangayIds.length} barangays have ` +
      `published AIPs with Total Investment Program totals (${coverageListText}).`,
    missingLine: `Missing ${fiscalLabel}: ${missingListText}.`,
    contributingAipIds,
    denominatorCount: candidateBarangayIds.length,
    coveredCount: coveredRows.length,
  };
}

function formatCompareDelta(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "PHP 0.00";
  const amount = formatPhpAmount(Math.abs(value));
  return value > 0 ? `+${amount}` : `-${amount}`;
}

function buildCompareYearsVerboseAnswer(input: {
  yearA: number;
  yearB: number;
  scopeLabel: string;
  sourceNote: string;
  yearAResult: CompareYearTotalsResult;
  yearBResult: CompareYearTotalsResult;
}): CompareYearsVerboseAnswer {
  const lguMap = new Map<
    string,
    {
      lguName: string;
      yearATotal: number | null;
      yearBTotal: number | null;
    }
  >();

  const toKey = (lguId: string | null, lguName: string) =>
    lguId ? `id:${lguId}` : `name:${lguName.toLowerCase()}`;

  for (const row of input.yearAResult.coveredRows) {
    const key = toKey(row.lguId, row.lguName);
    const current = lguMap.get(key) ?? {
      lguName: row.lguName,
      yearATotal: null,
      yearBTotal: null,
    };
    current.yearATotal = row.total;
    lguMap.set(key, current);
  }

  for (const row of input.yearBResult.coveredRows) {
    const key = toKey(row.lguId, row.lguName);
    const current = lguMap.get(key) ?? {
      lguName: row.lguName,
      yearATotal: null,
      yearBTotal: null,
    };
    current.yearBTotal = row.total;
    lguMap.set(key, current);
  }

  const perLguRows = Array.from(lguMap.values()).sort((a, b) => {
    const bTotal = b.yearBTotal ?? Number.NEGATIVE_INFINITY;
    const aTotal = a.yearBTotal ?? Number.NEGATIVE_INFINITY;
    if (bTotal !== aTotal) return bTotal - aTotal;
    return a.lguName.localeCompare(b.lguName);
  });

  const visibleRows = perLguRows.slice(0, 10);
  const hiddenCount = Math.max(0, perLguRows.length - visibleRows.length);

  const perLguLines =
    visibleRows.length === 0
      ? ["No covered LGUs found for the requested years."]
      : visibleRows.map((row) => {
          const yearAText =
            row.yearATotal === null ? "No published AIP" : formatPhpAmount(row.yearATotal);
          const yearBText =
            row.yearBTotal === null ? "No published AIP" : formatPhpAmount(row.yearBTotal);
          const deltaText =
            row.yearATotal !== null && row.yearBTotal !== null
              ? formatCompareDelta(row.yearBTotal - row.yearATotal)
              : "N/A";
          return `${row.lguName}: FY${input.yearA}=${yearAText} | FY${input.yearB}=${yearBText} | Δ=${deltaText}`;
        });

  if (hiddenCount > 0) {
    perLguLines.push(`+${hiddenCount} more LGUs.`);
  }

  const overallYearATotal = input.yearAResult.coveredRows.reduce((sum, row) => sum + row.total, 0);
  const overallYearBTotal = input.yearBResult.coveredRows.reduce((sum, row) => sum + row.total, 0);
  const overallDelta = overallYearBTotal - overallYearATotal;
  const yearAUnavailable = input.yearAResult.coveredCount === 0;
  const yearBUnavailable = input.yearBResult.coveredCount === 0;
  const overallYearAText = yearAUnavailable
    ? "N/A (no published AIPs with totals)"
    : formatPhpAmount(overallYearATotal);
  const overallYearBText = yearBUnavailable
    ? "N/A (no published AIPs with totals)"
    : formatPhpAmount(overallYearBTotal);
  const overallDeltaText =
    yearAUnavailable || yearBUnavailable ? "N/A" : formatCompareDelta(overallDelta);
  const deltaDirection =
    yearAUnavailable || yearBUnavailable
      ? null
      : overallDelta > 0
        ? "increase"
        : overallDelta < 0
          ? "decrease"
          : "no change";

  const coverageBarangays = formatCoverageNames(
    Array.from(new Set([...input.yearAResult.coverageNames, ...input.yearBResult.coverageNames]))
  );

  return {
    content: [
      `Fiscal year comparison (${input.scopeLabel}):`,
      input.yearAResult.coverageLine,
      input.yearBResult.coverageLine,
      input.yearAResult.missingLine,
      input.yearBResult.missingLine,
      "Per-LGU totals:",
      ...perLguLines,
      `Overall totals (covered LGUs only): FY${input.yearA}=${overallYearAText} | FY${input.yearB}=${overallYearBText} | Δ=${overallDeltaText}${deltaDirection ? ` (${deltaDirection})` : ""}.`,
      `Notes: ${input.sourceNote}`,
    ].join("\n"),
    overallYearATotal,
    overallYearBTotal,
    overallDelta,
    coverageBarangays,
  };
}

async function resolveExplicitCityScopeFromMessage(input: {
  message: string;
  scopeResolution: ChatScopeResolution;
}): Promise<CityScopeResult> {
  if (input.scopeResolution.mode === "named_scopes") {
    const target =
      input.scopeResolution.resolvedTargets.length === 1
        ? input.scopeResolution.resolvedTargets[0]
        : null;
    if (target?.scopeType === "city") {
      return {
        kind: "explicit_city",
        city: {
          id: target.scopeId,
          name: target.scopeName,
        },
        matchedBy: "label",
      };
    }

    if (target) {
      return { kind: "none" };
    }
  }

  const admin = supabaseAdmin();
  const explicitMention = detectExplicitCityMention(input.message);
  if (explicitMention.cityNameCandidate) {
    const resolved = await resolveCityByNameExact(admin, explicitMention.cityNameCandidate);
    if (resolved) {
      return {
        kind: "explicit_city",
        city: resolved,
        matchedBy: "label",
      };
    }
  }

  const looseScopeName = parseLooseScopeName(input.message);
  if (
    looseScopeName &&
    !/\b(?:fy|fiscal|year|20\d{2})\b/i.test(looseScopeName)
  ) {
    const resolved = await resolveCityByNameExact(admin, looseScopeName);
    if (resolved) {
      return {
        kind: "explicit_city",
        city: resolved,
        matchedBy: "name",
      };
    }
  }

  return { kind: "none" };
}

type AggregationScopeDecision = {
  scopeReason: LineItemScopeReason;
  barangayIdUsed: string | null;
  barangayName: string | null;
  unsupportedScopeType: ScopeType | null;
  clarificationMessage?: string;
};

type AggregationLogIntent =
  | "aggregate_top_projects"
  | "aggregate_totals_by_sector"
  | "aggregate_totals_by_fund_source"
  | "aggregate_compare_years";

async function resolveAggregationScopeDecision(input: {
  message: string;
  scopeResolution: ChatScopeResolution;
  userBarangay: BarangayRef | null;
}): Promise<AggregationScopeDecision> {
  if (input.scopeResolution.mode === "named_scopes") {
    const target =
      input.scopeResolution.resolvedTargets.length === 1
        ? input.scopeResolution.resolvedTargets[0]
        : null;
    if (target?.scopeType === "barangay") {
      return {
        scopeReason: "explicit_barangay",
        barangayIdUsed: target.scopeId,
        barangayName: target.scopeName,
        unsupportedScopeType: null,
      };
    }

    if (target?.scopeType === "city" || target?.scopeType === "municipality") {
      return {
        scopeReason: "unknown",
        barangayIdUsed: null,
        barangayName: null,
        unsupportedScopeType: target.scopeType,
      };
    }
  }

  let cachedBarangays: BarangayRef[] | null = null;
  const getActiveBarangays = async (): Promise<BarangayRef[]> => {
    if (cachedBarangays) return cachedBarangays;
    cachedBarangays = await fetchActiveBarangaysForMatching();
    return cachedBarangays;
  };

  const explicitMentionCandidate = detectExplicitBarangayMention(input.message);
  if (explicitMentionCandidate) {
    const barangays = await getActiveBarangays();
    const match = resolveExplicitBarangayByCandidate(explicitMentionCandidate, barangays);
    if (match.status === "single" && match.barangay) {
      return {
        scopeReason: "explicit_barangay",
        barangayIdUsed: match.barangay.id,
        barangayName: match.barangay.name,
        unsupportedScopeType: null,
      };
    }

    if (match.status === "ambiguous") {
      return {
        scopeReason: "unknown",
        barangayIdUsed: null,
        barangayName: null,
        unsupportedScopeType: null,
        clarificationMessage:
          "I found multiple barangays with that name. Please specify the exact barangay name.",
      };
    }
  }

  const shouldCheckBareMention =
    /\b(?:barangay|brgy\.?)\b/i.test(input.message) || /\b(?:of|for|in)\s+[a-z]/i.test(input.message);
  if (shouldCheckBareMention) {
    const barangays = await getActiveBarangays();
    const knownBarangayNamesNormalized = new Set(
      barangays
        .map((barangay) => normalizeBarangayNameForMatch(barangay.name))
        .filter((normalizedName) => Boolean(normalizedName))
    );
    const bareMentionCandidate = detectBareBarangayScopeMention(
      input.message,
      knownBarangayNamesNormalized
    );
    if (bareMentionCandidate) {
      const match = resolveExplicitBarangayByCandidate(bareMentionCandidate, barangays);
      if (match.status === "single" && match.barangay) {
        return {
          scopeReason: "explicit_barangay",
          barangayIdUsed: match.barangay.id,
          barangayName: match.barangay.name,
          unsupportedScopeType: null,
        };
      }

      if (match.status === "ambiguous") {
        return {
          scopeReason: "unknown",
          barangayIdUsed: null,
          barangayName: null,
          unsupportedScopeType: null,
          clarificationMessage:
            "I found multiple barangays with that name. Please specify the exact barangay name.",
        };
      }
    }
  }

  if (hasAggregationGlobalCue(input.message)) {
    return {
      scopeReason: "global",
      barangayIdUsed: null,
      barangayName: null,
      unsupportedScopeType: null,
    };
  }

  if (input.scopeResolution.mode === "own_barangay" && input.userBarangay) {
    return {
      scopeReason: "explicit_our_barangay",
      barangayIdUsed: input.userBarangay.id,
      barangayName: input.userBarangay.name,
      unsupportedScopeType: null,
    };
  }

  return {
    scopeReason: "global",
    barangayIdUsed: null,
    barangayName: null,
    unsupportedScopeType: null,
  };
}

function toAggregationLogIntent(intent: "top_projects" | "totals_by_sector" | "totals_by_fund_source" | "compare_years"): AggregationLogIntent {
  if (intent === "top_projects") return "aggregate_top_projects";
  if (intent === "totals_by_sector") return "aggregate_totals_by_sector";
  if (intent === "totals_by_fund_source") return "aggregate_totals_by_fund_source";
  return "aggregate_compare_years";
}

function parseLooseScopeName(message: string): string | null {
  const match = message.match(
    /\b(?:in|sa)\s+([a-z0-9][a-z0-9 .,'-]{1,80}?)(?=\s+(?:for|fy|fiscal|year)\b|[.,;!?)]|$)/i
  );
  if (!match) return null;
  const raw = (match[1] ?? "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^(barangay|city|municipality)\s+/i, "").trim();
  return stripped || null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPhp(value: number): string {
  return `PHP ${new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function mapRefusalReasonToMetaReason(
  status: "answer" | "clarification" | "refusal",
  refusalReason: RefusalReason | undefined
): ChatRetrievalMeta["reason"] {
  if (status === "answer") return "ok";
  if (status === "clarification") return "clarification_needed";
  if (refusalReason === "ambiguous_scope") return "ambiguous_scope";
  if (refusalReason === "missing_required_parameter") return "clarification_needed";
  if (
    refusalReason === "retrieval_failure" ||
    refusalReason === "document_limitation" ||
    refusalReason === "unsupported_request"
  ) {
    return "insufficient_evidence";
  }
  return "unknown";
}

function normalizeRetrievalMetaStatus(retrievalMeta: ChatRetrievalMeta): ChatRetrievalMeta {
  const explicitStatus = retrievalMeta.status;
  const derivedStatus: ChatResponseStatus =
    explicitStatus ??
    (retrievalMeta.kind === "clarification"
      ? "clarification"
      : retrievalMeta.refused
        ? "refusal"
        : "answer");

  const nextReason: ChatRetrievalMeta["reason"] =
    derivedStatus === "clarification"
      ? "clarification_needed"
      : retrievalMeta.reason ?? mapRefusalReasonToMetaReason(derivedStatus, retrievalMeta.refusalReason);

  const refusedValue =
    derivedStatus === "clarification"
      ? false
      : derivedStatus === "refusal"
        ? true
        : Boolean(retrievalMeta.refused);

  const nextRefusalReason =
    derivedStatus === "clarification" ? undefined : retrievalMeta.refusalReason;
  const nextRefusalDetail =
    derivedStatus === "clarification" ? undefined : retrievalMeta.refusalDetail;

  return {
    ...retrievalMeta,
    status: derivedStatus,
    refused: refusedValue,
    reason: nextReason,
    refusalReason: nextRefusalReason,
    refusalDetail: nextRefusalDetail,
    suggestions: Array.isArray(retrievalMeta.suggestions)
      ? retrievalMeta.suggestions.map((entry) => entry.trim()).filter(Boolean).slice(0, 3)
      : undefined,
  };
}

function detectDocLimitFieldFromQuery(
  normalizedQuestion: string
):
  | "contractor"
  | "procurement_mode"
  | "exact_address"
  | "beneficiary_count"
  | "supplier"
  | null {
  if (
    /\bcontractor(s)?\b/i.test(normalizedQuestion) ||
    /\bsupplier(s)?\b/i.test(normalizedQuestion) ||
    /\bwinning bidder(s)?\b/i.test(normalizedQuestion) ||
    /\bawarded to\b/i.test(normalizedQuestion) ||
    /\bcontractor name\b/i.test(normalizedQuestion) ||
    /\bsupplier name\b/i.test(normalizedQuestion)
  ) {
    return "contractor";
  }
  if (/\bprocurement\b|\bprocurement mode\b/i.test(normalizedQuestion)) return "procurement_mode";
  if (/\bexact address\b|\bsite address\b|\bexact site\b/i.test(normalizedQuestion)) {
    return "exact_address";
  }
  if (/\bbeneficiary\b|\bbeneficiaries\b|\bbeneficiary count\b/i.test(normalizedQuestion)) {
    return "beneficiary_count";
  }
  return null;
}

function isUnsupportedRequestQuery(queryText: string): boolean {
  const normalized = queryText.toLowerCase();
  return (
    /\bwho stole\b/.test(normalized) ||
    /\bembezzl/.test(normalized) ||
    /\bcorrupt(ion)?\b/.test(normalized) ||
    /\bpredict\b/.test(normalized) ||
    /\bforecast\b/.test(normalized) ||
    /\bnext year\b.*\bbudget\b/.test(normalized)
  );
}

function formatScopeLabel(target: TotalsScopeTarget): string {
  const scopedName = target.scopeName?.trim();
  if (!scopedName) {
    if (target.scopeType === "barangay") return "your barangay";
    return `the ${target.scopeType}`;
  }
  if (target.scopeType === "barangay") {
    return /^barangay\s+/i.test(scopedName) ? scopedName : `Barangay ${scopedName}`;
  }
  if (target.scopeType === "city") {
    return /\bcity\b/i.test(scopedName) ? scopedName : `City ${scopedName}`;
  }
  return /\bmunicipality\b/i.test(scopedName) ? scopedName : `Municipality ${scopedName}`;
}

function normalizeBarangayLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "your barangay";
  return /^barangay\s+/i.test(trimmed) ? trimmed : `Barangay ${trimmed}`;
}

function isTotalsDebugEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.CHATBOT_DEBUG_LOGS === "true";
}

function logTotalsRouting(payload: TotalsRoutingLogPayload): void {
  if (!isTotalsDebugEnabled()) return;
  const sanitized: TotalsRoutingLogPayload = { ...payload };
  if (sanitized.status === "clarification") {
    sanitized.answered = false;
    delete sanitized.refusal_reason;
  }
  console.info(JSON.stringify(sanitized));
}

function logNonTotalsRouting(payload: NonTotalsRoutingLogPayload): void {
  if (!isTotalsDebugEnabled()) return;
  const sanitized: NonTotalsRoutingLogPayload = { ...payload };
  const isClarification =
    sanitized.status === "clarification" || sanitized.intent === "clarification_needed";
  if (isClarification) {
    sanitized.answered = false;
    delete sanitized.refusal_reason;
  }
  console.info(JSON.stringify(sanitized));
}

function logClarificationLifecycle(payload: ClarificationLifecycleLogPayload): void {
  if (!isTotalsDebugEnabled()) return;
  console.info(JSON.stringify(payload));
}

function toPublicClarificationPayload(
  clarification: ChatRetrievalMeta["clarification"]
): ChatClarificationPayload | undefined {
  if (!clarification) return undefined;

  if (clarification.kind === "line_item_disambiguation") {
    return {
      id: clarification.id,
      kind: "line_item_disambiguation",
      prompt: clarification.prompt,
      options: clarification.options,
    };
  }

  return {
    id: clarification.id,
    kind: "city_aip_missing_fallback",
    prompt: clarification.prompt,
    options: clarification.options,
  };
}

function toResponseStatus(
  retrievalMeta: ChatRetrievalMeta | null | undefined
): { status: ChatResponseStatus; clarification?: ChatClarificationPayload } {
  if (!retrievalMeta) {
    return { status: "answer" };
  }

  if (retrievalMeta.status === "clarification" || retrievalMeta.kind === "clarification") {
    return {
      status: "clarification",
      clarification: toPublicClarificationPayload(retrievalMeta.clarification),
    };
  }

  if (retrievalMeta.status === "refusal" || retrievalMeta.refused) {
    return { status: "refusal" };
  }

  return { status: "answer" };
}

function chatResponsePayload(input: {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}): {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  status: ChatResponseStatus;
  clarification?: ChatClarificationPayload;
} {
  const mapped = toResponseStatus(input.assistantMessage.retrievalMeta ?? null);
  return {
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    assistantMessage: input.assistantMessage,
    status: mapped.status,
    ...(mapped.clarification ? { clarification: mapped.clarification } : {}),
  };
}

function isExplicitScopeDetected(scopeReason: RouteScopeReason): boolean {
  return (
    scopeReason === "explicit_barangay" ||
    scopeReason === "explicit_our_barangay" ||
    scopeReason === "explicit_city"
  );
}

function makeTotalsLogPayload(
  payload: Omit<TotalsRoutingLogPayload, "explicit_scope_detected">
): TotalsRoutingLogPayload {
  return {
    ...payload,
    explicit_scope_detected: isExplicitScopeDetected(payload.scope_reason),
  };
}

async function appendAssistantMessage(params: {
  actor?: PrivilegedActorContext | null;
  sessionId: string;
  content: string;
  citations: ChatCitation[];
  retrievalMeta: ChatRetrievalMeta;
}): Promise<ChatMessage> {
  const normalizedMeta = normalizeRetrievalMetaStatus(params.retrievalMeta);
  const inserted = await insertAssistantChatMessage({
    actor: params.actor ?? null,
    sessionId: params.sessionId,
    content: params.content,
    citations: params.citations as unknown as Json,
    retrievalMeta: normalizedMeta as unknown as Json,
  });

  return toChatMessage(inserted as ChatMessageRow);
}

async function getLatestPendingClarification(
  sessionId: string
): Promise<PendingClarificationRecord | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("chat_messages")
    .select("id,retrieval_meta")
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;

  const row = data as AssistantMetaRow;
  const retrievalMeta = row.retrieval_meta as ChatRetrievalMeta | null;
  if (!retrievalMeta || typeof retrievalMeta !== "object") return null;
  if (retrievalMeta.kind !== "clarification" && retrievalMeta.status !== "clarification") return null;
  if (!retrievalMeta.clarification) return null;

  const clarification = retrievalMeta.clarification as PendingClarificationPayload;
  if (!clarification.id || !Array.isArray(clarification.options) || clarification.options.length === 0) {
    return null;
  }
  if (!isLineItemClarificationPayload(clarification) && !isCityFallbackClarificationPayload(clarification)) {
    return null;
  }

  return {
    messageId: row.id,
    payload: clarification,
  };
}

async function consumeQuota(
  actor: PrivilegedActorContext | null,
  userId: string,
  route: "barangay_chat_message" | "city_chat_message"
): Promise<{ allowed: boolean; reason: string }> {
  const rateLimit = await getTypedAppSetting("controls.chatbot_rate_limit");
  const payload = await consumeChatQuota({
    actor,
    userId,
    maxRequests: rateLimit.maxRequests,
    timeWindow: rateLimit.timeWindow,
    route,
  });
  return {
    allowed: payload.allowed,
    reason: payload.reason,
  };
}

async function queryScopeByName(
  table: "barangays" | "cities" | "municipalities",
  scopeType: ScopeType,
  name: string
): Promise<TotalsScopeTarget[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from(table)
    .select("id,name")
    .eq("is_active", true)
    .ilike("name", name)
    .limit(3);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const typed = row as ScopeLookupRow;
    return {
      scopeType,
      scopeId: typed.id,
      scopeName: typed.name,
    };
  });
}

async function fetchActiveBarangaysForMatching(): Promise<BarangayRef[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("barangays")
    .select("id,name")
    .eq("is_active", true)
    .limit(5000);

  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const typed = row as ScopeLookupRow;
      return {
        id: typed.id,
        name: (typed.name ?? "").trim(),
      };
    })
    .filter((row) => row.id && row.name);
}

async function fetchBarangayNameMap(barangayIds: string[]): Promise<Map<string, string>> {
  const deduped = barangayIds.filter((id, index, all) => id && all.indexOf(id) === index);
  if (deduped.length === 0) return new Map<string, string>();

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("barangays")
    .select("id,name")
    .in("id", deduped);

  if (error) throw new Error(error.message);

  const nameMap = new Map<string, string>();
  for (const row of data ?? []) {
    const typed = row as ScopeLookupRow;
    const name = (typed.name ?? "").trim();
    if (typed.id && name) {
      nameMap.set(typed.id, name);
    }
  }
  return nameMap;
}

type PublishedBarangayAip = {
  id: string;
  fiscal_year: number;
  barangay_id: string;
};

async function fetchPublishedBarangayAips(input: {
  barangayIds: string[];
  fiscalYear?: number | null;
  fiscalYears?: number[];
}): Promise<PublishedBarangayAip[]> {
  const deduped = input.barangayIds.filter((id, index, all) => id && all.indexOf(id) === index);
  if (deduped.length === 0) return [];

  const admin = supabaseAdmin();
  let query = admin
    .from("aips")
    .select("id,fiscal_year,barangay_id")
    .eq("status", "published")
    .in("barangay_id", deduped);

  if (Array.isArray(input.fiscalYears) && input.fiscalYears.length > 0) {
    query = query.in("fiscal_year", input.fiscalYears);
  } else if (input.fiscalYear !== undefined && input.fiscalYear !== null) {
    query = query.eq("fiscal_year", input.fiscalYear);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const typed = row as { id?: unknown; fiscal_year?: unknown; barangay_id?: unknown };
      return {
        id: typeof typed.id === "string" ? typed.id : null,
        fiscal_year: typeof typed.fiscal_year === "number" ? typed.fiscal_year : null,
        barangay_id: typeof typed.barangay_id === "string" ? typed.barangay_id : null,
      };
    })
    .filter(
      (
        row
      ): row is {
        id: string;
        fiscal_year: number;
        barangay_id: string;
      } => Boolean(row.id && row.fiscal_year !== null && row.barangay_id)
    );
}

function resolveExplicitBarangayByCandidate(
  candidateName: string,
  barangays: BarangayRef[]
): { status: "none" | "single" | "ambiguous"; barangay?: BarangayRef } {
  const normalizedCandidate = normalizeBarangayNameForMatch(candidateName);
  if (!normalizedCandidate) {
    return { status: "none" };
  }

  const matches = barangays.filter(
    (barangay) => normalizeBarangayNameForMatch(barangay.name) === normalizedCandidate
  );
  if (matches.length === 0) {
    return { status: "none" };
  }
  if (matches.length === 1) {
    return { status: "single", barangay: matches[0] };
  }
  return { status: "ambiguous" };
}

async function findScopeTargetByLooseName(name: string): Promise<{
  status: "none" | "single" | "ambiguous";
  target?: TotalsScopeTarget;
}> {
  const [barangays, cities, municipalities] = await Promise.all([
    queryScopeByName("barangays", "barangay", name),
    queryScopeByName("cities", "city", name),
    queryScopeByName("municipalities", "municipality", name),
  ]);

  const all = [...barangays, ...cities, ...municipalities];
  if (all.length === 0) {
    return { status: "none" };
  }
  if (all.length === 1) {
    return { status: "single", target: all[0] };
  }
  return { status: "ambiguous" };
}

async function lookupScopeNameById(target: TotalsScopeTarget): Promise<string | null> {
  const admin = supabaseAdmin();
  const table =
    target.scopeType === "barangay"
      ? "barangays"
      : target.scopeType === "city"
        ? "cities"
        : "municipalities";
  const { data, error } = await admin
    .from(table)
    .select("id,name")
    .eq("id", target.scopeId)
    .maybeSingle();
  if (error || !data) return target.scopeName;
  return (data as ScopeLookupRow).name ?? target.scopeName;
}

async function resolveTotalsScopeTarget(input: {
  actor: ActorContext;
  message: string;
  scopeResolution: ChatScopeResolution;
}): Promise<{
  target: TotalsScopeTarget | null;
  explicitBarangay: BarangayRef | null;
  errorMessage?: string;
}> {
  let cachedBarangays: BarangayRef[] | null = null;
  const getActiveBarangays = async (): Promise<BarangayRef[]> => {
    if (cachedBarangays) return cachedBarangays;
    cachedBarangays = await fetchActiveBarangaysForMatching();
    return cachedBarangays;
  };

  const resolved = input.scopeResolution.resolvedTargets;
  if (resolved.length > 1) {
    return {
      target: null,
      explicitBarangay: null,
      errorMessage:
        "Please ask about one place at a time for total investment queries (one barangay/city/municipality).",
    };
  }

  if (resolved.length === 1) {
    const target = resolved[0];
    const mappedTarget: TotalsScopeTarget = {
      scopeType: target.scopeType,
      scopeId: target.scopeId,
      scopeName: target.scopeName,
    };
    return {
      target: mappedTarget,
      explicitBarangay:
        target.scopeType === "barangay" && target.scopeName
          ? { id: target.scopeId, name: target.scopeName }
          : null,
    };
  }

  const explicitMentionCandidate = detectExplicitBarangayMention(input.message);
  if (explicitMentionCandidate) {
    const barangays = await getActiveBarangays();
    const match = resolveExplicitBarangayByCandidate(explicitMentionCandidate, barangays);
    if (match.status === "single" && match.barangay) {
      return {
        target: {
          scopeType: "barangay",
          scopeId: match.barangay.id,
          scopeName: match.barangay.name,
        },
        explicitBarangay: match.barangay,
      };
    }
    if (match.status === "ambiguous") {
      return {
        target: null,
        explicitBarangay: null,
        errorMessage:
          "I found multiple barangays with that name. Please specify the exact barangay name.",
      };
    }
  }

  const barangays = await getActiveBarangays();
  const knownBarangayNamesNormalized = new Set(
    barangays
      .map((barangay) => normalizeBarangayNameForMatch(barangay.name))
      .filter((normalizedName) => Boolean(normalizedName))
  );
  const bareMentionCandidate = detectBareBarangayScopeMention(
    input.message,
    knownBarangayNamesNormalized
  );
  if (bareMentionCandidate) {
    const match = resolveExplicitBarangayByCandidate(bareMentionCandidate, barangays);
    if (match.status === "single" && match.barangay) {
      return {
        target: {
          scopeType: "barangay",
          scopeId: match.barangay.id,
          scopeName: match.barangay.name,
        },
        explicitBarangay: match.barangay,
      };
    }
    if (match.status === "ambiguous") {
      return {
        target: null,
        explicitBarangay: null,
        errorMessage:
          "I found multiple barangays with that name. Please specify the exact barangay name.",
      };
    }
  }

  const looseScopeName = parseLooseScopeName(input.message);
  if (looseScopeName) {
    const loose = await findScopeTargetByLooseName(looseScopeName);
    if (loose.status === "single" && loose.target) {
      return {
        target: loose.target,
        explicitBarangay:
          loose.target.scopeType === "barangay" && loose.target.scopeName
            ? { id: loose.target.scopeId, name: loose.target.scopeName }
            : null,
      };
    }
    if (loose.status === "ambiguous") {
      return {
        target: null,
        explicitBarangay: null,
        errorMessage:
          "I found multiple places with that name. Please specify the exact barangay/city/municipality.",
      };
    }
  }

  if (
    (input.actor.scope.kind === "barangay" ||
      input.actor.scope.kind === "city" ||
      input.actor.scope.kind === "municipality") &&
    input.actor.scope.id
  ) {
    const target: TotalsScopeTarget = {
      scopeType: input.actor.scope.kind,
      scopeId: input.actor.scope.id,
      scopeName: null,
    };
    return {
      target: {
        ...target,
        scopeName: await lookupScopeNameById(target),
      },
      explicitBarangay: null,
    };
  }

  return {
    target: null,
    explicitBarangay: null,
    errorMessage: "I couldn't determine the place scope for this total investment query.",
  };
}

async function resolveUserBarangay(actor: ActorContext): Promise<BarangayRef | null> {
  if (actor.scope.kind !== "barangay" || !actor.scope.id) {
    return null;
  }

  const scopeName = await lookupScopeNameById({
    scopeType: "barangay",
    scopeId: actor.scope.id,
    scopeName: null,
  });
  if (!scopeName) {
    return null;
  }

  return {
    id: actor.scope.id,
    name: scopeName,
  };
}

async function findPublishedAipForScope(input: {
  target: TotalsScopeTarget;
  fiscalYear: number | null;
}): Promise<PublishedAipRow | null> {
  const admin = supabaseAdmin();
  let query = admin
    .from("aips")
    .select("id,fiscal_year,barangay_id,city_id,municipality_id,created_at")
    .eq("status", "published");

  if (input.target.scopeType === "barangay") {
    query = query.eq("barangay_id", input.target.scopeId);
  } else if (input.target.scopeType === "city") {
    query = query.eq("city_id", input.target.scopeId);
  } else {
    query = query.eq("municipality_id", input.target.scopeId);
  }

  if (input.fiscalYear !== null) {
    query = query.eq("fiscal_year", input.fiscalYear).order("created_at", { ascending: false });
  } else {
    query = query.order("fiscal_year", { ascending: false }).order("created_at", { ascending: false });
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as PublishedAipRow | null) ?? null;
}

async function findAipTotal(aipId: string): Promise<AipTotalRow | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("aip_totals")
    .select("total_investment_program,page_no,evidence_text")
    .eq("aip_id", aipId)
    .eq("source_label", "total_investment_program")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AipTotalRow | null) ?? null;
}

async function resolveTotalsAssistantPayload(input: {
  actor: ActorContext;
  message: string;
  scopeResolution: ChatScopeResolution;
  requestId: string;
}): Promise<TotalsAssistantPayload> {
  const requestedFiscalYear = extractFiscalYear(input.message);
  const explicitCityScope = await resolveExplicitCityScopeFromMessage({
    message: input.message,
    scopeResolution: input.scopeResolution,
  });

  if (explicitCityScope.kind === "explicit_city") {
    const cityLabel = normalizeCityLabel(explicitCityScope.city.name);
    const admin = supabaseAdmin();
    const cityAip = await selectPublishedCityAip(
      admin,
      explicitCityScope.city.id,
      requestedFiscalYear
    );

    if (!cityAip.aipId) {
      const clarificationPayload = buildCityAipMissingClarificationPayload({
        cityName: explicitCityScope.city.name,
        fiscalYearParsed: requestedFiscalYear,
      });
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "explicit_city",
          barangay_id_used: null,
          aip_id_selected: null,
          totals_found: false,
          vector_called: false,
          city_id: explicitCityScope.city.id,
        })
      );

      return {
        content: buildClarificationPromptContent(clarificationPayload),
        citations: [
          makeSystemCitation("City AIP not found; offered barangays-in-city fallback.", {
            reason: "city_aip_missing_fallback_offered",
            city_id: explicitCityScope.city.id,
            city_name: explicitCityScope.city.name,
            fiscal_year: requestedFiscalYear,
          }),
        ],
        retrievalMeta: {
          refused: false,
          reason: "clarification_needed",
          status: "clarification",
          kind: "clarification",
          clarification: {
            ...clarificationPayload,
            context: {
              cityId: explicitCityScope.city.id,
              cityName: explicitCityScope.city.name,
              fiscalYearParsed: requestedFiscalYear,
              originalIntent: "total_investment_program",
            },
          },
          scopeReason: "explicit_city",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    const totalsRow = await findAipTotal(cityAip.aipId);
    if (!totalsRow) {
      const missingMessage = buildTotalsMissingMessage({
        fiscalYear: cityAip.fiscalYearFound ?? requestedFiscalYear,
        scopeLabel: cityLabel,
      });
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "explicit_city",
          barangay_id_used: null,
          aip_id_selected: cityAip.aipId,
          totals_found: false,
          vector_called: false,
          city_id: explicitCityScope.city.id,
        })
      );
      return {
        content: missingMessage,
        citations: [
          makeSystemCitation("No aip_totals row found for city AIP.", {
            type: "aip_total_missing",
            aip_id: cityAip.aipId,
            city_id: explicitCityScope.city.id,
            fiscal_year: cityAip.fiscalYearFound ?? requestedFiscalYear,
          }),
        ],
        retrievalMeta: {
          refused: true,
          reason: "insufficient_evidence",
          scopeReason: "explicit_city",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    const parsedAmount = parseAmount(totalsRow.total_investment_program);
    if (parsedAmount === null) {
      const missingMessage = buildTotalsMissingMessage({
        fiscalYear: cityAip.fiscalYearFound ?? requestedFiscalYear,
        scopeLabel: cityLabel,
      });
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "explicit_city",
          barangay_id_used: null,
          aip_id_selected: cityAip.aipId,
          totals_found: false,
          vector_called: false,
          city_id: explicitCityScope.city.id,
        })
      );
      return {
        content: missingMessage,
        citations: [
          makeSystemCitation("Invalid city total_investment_program format in aip_totals.", {
            type: "aip_total_missing",
            aip_id: cityAip.aipId,
            city_id: explicitCityScope.city.id,
          }),
        ],
        retrievalMeta: {
          refused: true,
          reason: "insufficient_evidence",
          scopeReason: "explicit_city",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    const rawEvidence = totalsRow.evidence_text.trim();
    const formattedEvidence = formatTotalsEvidence(rawEvidence);
    const evidenceText = formattedEvidence || rawEvidence;
    const resolvedFiscalYear = cityAip.fiscalYearFound ?? requestedFiscalYear ?? null;
    const pageLabel = totalsRow.page_no !== null ? `page ${totalsRow.page_no}` : "page not specified";
    const answer =
      `The Total Investment Program for FY ${resolvedFiscalYear ?? "N/A"} (${cityLabel}) is ${formatPhp(parsedAmount)}. ` +
      `Evidence: ${pageLabel}, "${evidenceText}".`;
    logTotalsRouting(
      makeTotalsLogPayload({
        request_id: input.requestId,
        intent: "total_investment_program",
        route: "sql_totals",
        fiscal_year_parsed: requestedFiscalYear,
        scope_reason: "explicit_city",
        barangay_id_used: null,
        aip_id_selected: cityAip.aipId,
        totals_found: true,
        vector_called: false,
        city_id: explicitCityScope.city.id,
      })
    );

    return {
      content: answer,
      citations: [
        {
          sourceId: "T1",
          aipId: cityAip.aipId,
          fiscalYear: resolvedFiscalYear,
          scopeType: "city",
          scopeId: explicitCityScope.city.id,
          scopeName: `${cityLabel} - FY ${resolvedFiscalYear ?? "Any"} - Total Investment Program`,
          snippet: evidenceText,
          insufficient: false,
          metadata: {
            type: "aip_total",
            page_no: totalsRow.page_no,
            evidence_text: evidenceText,
            evidence_text_raw: rawEvidence,
            aip_id: cityAip.aipId,
            fiscal_year: resolvedFiscalYear,
            city_id: explicitCityScope.city.id,
          },
        },
      ],
      retrievalMeta: {
        refused: false,
        reason: "ok",
        scopeReason: "explicit_city",
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const multiBarangayTargets =
    input.scopeResolution.mode === "named_scopes" &&
    input.scopeResolution.resolvedTargets.length > 1 &&
    input.scopeResolution.resolvedTargets.every((target) => target.scopeType === "barangay")
      ? input.scopeResolution.resolvedTargets
      : null;

  if (multiBarangayTargets) {
    if (requestedFiscalYear === null) {
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "global",
          barangay_id_used: null,
          aip_id_selected: null,
          totals_found: false,
          vector_called: false,
          status: "clarification",
        })
      );
      return {
        content:
          "Please specify one fiscal year when asking for the combined budget of multiple barangays (for example, FY 2026).",
        citations: [
          makeSystemCitation("Multi-barangay totals require an explicit fiscal year.", {
            reason: "clarification_needed",
            scope_ids: multiBarangayTargets.map((target) => target.scopeId),
          }),
        ],
        retrievalMeta: {
          refused: false,
          reason: "clarification_needed",
          status: "clarification",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    const barangayIds = multiBarangayTargets.map((target) => target.scopeId);
    const requestedBarangayNames = formatCoverageNames(
      multiBarangayTargets.map((target) => normalizeBarangayLabel(target.scopeName))
    );
    const publishedBarangayAips = await fetchPublishedBarangayAips({
      barangayIds,
      fiscalYear: requestedFiscalYear,
    });
    const coveredBarangayIds = publishedBarangayAips.map((row) => row.barangay_id);
    const coveredBarangayIdSet = new Set(coveredBarangayIds);
    const coverageNames = formatCoverageNames(
      multiBarangayTargets
        .filter((target) => coveredBarangayIdSet.has(target.scopeId))
        .map((target) => normalizeBarangayLabel(target.scopeName))
    );
    const missingNames = formatCoverageNames(
      multiBarangayTargets
        .filter((target) => !coveredBarangayIdSet.has(target.scopeId))
        .map((target) => normalizeBarangayLabel(target.scopeName))
    );
    const selectedAipIds = publishedBarangayAips
      .map((row) => row.id)
      .filter((id, index, all) => id && all.indexOf(id) === index);

    if (selectedAipIds.length === 0) {
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "global",
          barangay_id_used: null,
          aip_id_selected: null,
          totals_found: false,
          vector_called: false,
          aggregation_source: "aip_totals_total_investment_program",
        })
      );
      return {
        content:
          `I couldn't find published AIPs for FY ${requestedFiscalYear} across the selected barangays (${requestedBarangayNames.join(", ")}).` +
          (missingNames.length > 0 ? ` Missing: ${missingNames.join(", ")}.` : ""),
        citations: [
          makeAggregateCitation("No published AIPs found for the selected barangays.", {
            aggregate_type: "multi_barangay_total_investment_program",
            fiscal_year: requestedFiscalYear,
            barangay_ids: barangayIds,
            requested_barangays: requestedBarangayNames,
            missing_barangays: missingNames,
          }),
        ],
        retrievalMeta: {
          refused: true,
          reason: "insufficient_evidence",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    const admin = supabaseAdmin();
    const { data: totalsRows, error: totalsError } = await admin
      .from("aip_totals")
      .select("aip_id,total_investment_program")
      .eq("source_label", "total_investment_program")
      .in("aip_id", selectedAipIds);
    if (totalsError) {
      throw new Error(totalsError.message);
    }

    let summedTotal = 0;
    const contributingAipIds: string[] = [];
    for (const row of totalsRows ?? []) {
      const typed = row as { aip_id?: unknown; total_investment_program?: unknown };
      const amount = parseAmount(typed.total_investment_program);
      const aipId = typeof typed.aip_id === "string" ? typed.aip_id : null;
      if (aipId && amount !== null) {
        summedTotal += amount;
        contributingAipIds.push(aipId);
      }
    }

    const uniqueContributingAipIds = contributingAipIds.filter(
      (id, index, all) => id && all.indexOf(id) === index
    );
    const coveredCount = coverageNames.length;
    const totalCount = multiBarangayTargets.length;
    const combinedScopeLabel = requestedBarangayNames.join(", ");

    if (uniqueContributingAipIds.length === 0) {
      logTotalsRouting(
        makeTotalsLogPayload({
          request_id: input.requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: "global",
          barangay_id_used: null,
          aip_id_selected: null,
          totals_found: false,
          vector_called: false,
          aggregation_source: "aip_totals_total_investment_program",
        })
      );
      return {
        content:
          `Published AIPs were found for FY ${requestedFiscalYear}, but I couldn't find extracted Total Investment Program totals for the selected barangays (${combinedScopeLabel}).`,
        citations: [
          makeAggregateCitation("Published AIPs found, but no aip_totals rows were usable.", {
            aggregate_type: "multi_barangay_total_investment_program",
            fiscal_year: requestedFiscalYear,
            barangay_ids: barangayIds,
            requested_barangays: requestedBarangayNames,
            covered_barangays: coverageNames,
            missing_barangays: missingNames,
            selected_aip_ids: formatIdSample(selectedAipIds),
          }),
        ],
        retrievalMeta: {
          refused: true,
          reason: "insufficient_evidence",
          scopeResolution: input.scopeResolution,
        },
      };
    }

    logTotalsRouting(
      makeTotalsLogPayload({
        request_id: input.requestId,
        intent: "total_investment_program",
        route: "sql_totals",
        fiscal_year_parsed: requestedFiscalYear,
        scope_reason: "global",
        barangay_id_used: null,
        aip_id_selected: null,
        totals_found: true,
        vector_called: false,
        aggregation_source: "aip_totals_total_investment_program",
      })
    );

    return {
      content:
        `The combined Total Investment Program for FY ${requestedFiscalYear} (${combinedScopeLabel}) is ${formatPhp(summedTotal)}.\n` +
        `Coverage: ${coveredCount} of ${totalCount} selected barangays have published AIPs.` +
        (missingNames.length > 0 ? ` Missing: ${missingNames.join(", ")}.` : ""),
      citations: [
        makeAggregateCitation("Aggregated from aip_totals (Total Investment Program) across selected barangays.", {
          aggregate_type: "multi_barangay_total_investment_program",
          aggregation_source: "aip_totals_total_investment_program",
          fiscal_year: requestedFiscalYear,
          barangay_ids: barangayIds,
          requested_barangays: requestedBarangayNames,
          covered_barangays: coverageNames,
          missing_barangays: missingNames,
          contributing_aip_ids: formatIdSample(uniqueContributingAipIds),
          contributing_aip_ids_count: uniqueContributingAipIds.length,
        }),
      ],
      retrievalMeta: {
        refused: false,
        reason: "ok",
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const scopeResult = await resolveTotalsScopeTarget({
    actor: input.actor,
    message: input.message,
    scopeResolution: input.scopeResolution,
  });
  const userBarangay = await resolveUserBarangay(input.actor);
  const totalsScope = resolveTotalsScope(input.message, userBarangay, scopeResult.explicitBarangay);

  if (!scopeResult.target) {
    const scopeRefusal = buildRefusalMessage({
      intent: "totals",
      queryText: input.message,
      fiscalYear: requestedFiscalYear,
      explicitScopeRequested: input.scopeResolution.requestedScopes.length > 0,
      scopeResolved: input.scopeResolution.resolvedTargets.length > 0,
    });
    logTotalsRouting(
      makeTotalsLogPayload({
      request_id: input.requestId,
      intent: "total_investment_program",
      route: "sql_totals",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: totalsScope.scopeReason,
      barangay_id_used: totalsScope.barangayId,
      aip_id_selected: null,
      totals_found: false,
      vector_called: false,
      status: scopeRefusal.status,
      refusal_reason: scopeRefusal.reason,
      })
    );
    return {
      content: scopeRefusal.message,
      citations: [
        makeSystemCitation("Scope clarification required for totals SQL lookup.", {
          reason: scopeRefusal.reason,
          scope_resolution: input.scopeResolution,
        }),
      ],
      retrievalMeta: {
        refused: scopeRefusal.status === "refusal",
        reason: mapRefusalReasonToMetaReason(scopeRefusal.status, scopeRefusal.reason),
        status: scopeRefusal.status,
        refusalReason: scopeRefusal.reason,
        refusalDetail: scopeResult.errorMessage ?? undefined,
        suggestions: scopeRefusal.suggestions,
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const target = scopeResult.target;
  if (target.scopeType === "barangay" && totalsScope.scopeReason === "unknown") {
    const scopeRefusal = buildRefusalMessage({
      intent: "totals",
      queryText: input.message,
      fiscalYear: requestedFiscalYear,
      explicitScopeRequested: true,
      scopeResolved: false,
    });
    logTotalsRouting(
      makeTotalsLogPayload({
      request_id: input.requestId,
      intent: "total_investment_program",
      route: "sql_totals",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: totalsScope.scopeReason,
      barangay_id_used: totalsScope.barangayId,
      aip_id_selected: null,
      totals_found: false,
      vector_called: false,
      status: scopeRefusal.status,
      refusal_reason: scopeRefusal.reason,
      })
    );
    return {
      content: scopeRefusal.message,
      citations: [
        makeSystemCitation("Barangay clarification required for totals SQL lookup.", {
          reason: scopeRefusal.reason,
          scope_reason: totalsScope.scopeReason,
          scope_resolution: input.scopeResolution,
        }),
      ],
      retrievalMeta: {
        refused: scopeRefusal.status === "refusal",
        reason: mapRefusalReasonToMetaReason(scopeRefusal.status, scopeRefusal.reason),
        status: scopeRefusal.status,
        refusalReason: scopeRefusal.reason,
        suggestions: scopeRefusal.suggestions,
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const baseScopeLabel = formatScopeLabel(target);
  const answerScopeLabel =
    target.scopeType === "barangay" &&
    totalsScope.scopeReason === "default_user_barangay" &&
    totalsScope.barangayName
      ? `${normalizeBarangayLabel(totalsScope.barangayName)} - based on your account scope`
      : baseScopeLabel;
  const aip = await findPublishedAipForScope({
    target,
    fiscalYear: requestedFiscalYear,
  });

  if (!aip) {
    const retrievalFailure = buildRefusalMessage({
      intent: "totals",
      queryText: input.message,
      fiscalYear: requestedFiscalYear,
      scopeLabel: answerScopeLabel,
      explicitScopeRequested: input.scopeResolution.requestedScopes.length > 0,
      scopeResolved: true,
    });
    logTotalsRouting(
      makeTotalsLogPayload({
      request_id: input.requestId,
      intent: "total_investment_program",
      route: "sql_totals",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: totalsScope.scopeReason,
      barangay_id_used: totalsScope.barangayId,
      aip_id_selected: null,
      totals_found: false,
      vector_called: false,
      status: retrievalFailure.status,
      refusal_reason: retrievalFailure.reason,
      })
    );
    return {
      content: retrievalFailure.message,
      citations: [
        makeSystemCitation("No published AIP matched the totals query scope/year.", {
          type: "aip_total_missing",
          scope_type: target.scopeType,
          scope_id: target.scopeId,
          fiscal_year: requestedFiscalYear,
        }),
      ],
      retrievalMeta: {
        refused: retrievalFailure.status === "refusal",
        reason: mapRefusalReasonToMetaReason(retrievalFailure.status, retrievalFailure.reason),
        status: retrievalFailure.status,
        refusalReason: retrievalFailure.reason,
        suggestions: retrievalFailure.suggestions,
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const totalsRow = await findAipTotal(aip.id);
  if (!totalsRow) {
    const missingMessage = buildTotalsMissingMessage({
      fiscalYear: requestedFiscalYear ?? aip.fiscal_year ?? null,
      scopeLabel: answerScopeLabel,
    });
    const retrievalFailure = buildRefusalMessage({
      intent: "totals",
      queryText: input.message,
      fiscalYear: requestedFiscalYear ?? aip.fiscal_year ?? null,
      scopeLabel: answerScopeLabel,
      explicitScopeRequested: input.scopeResolution.requestedScopes.length > 0,
      scopeResolved: true,
    });
    logTotalsRouting(
      makeTotalsLogPayload({
      request_id: input.requestId,
      intent: "total_investment_program",
      route: "sql_totals",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: totalsScope.scopeReason,
      barangay_id_used: totalsScope.barangayId,
      aip_id_selected: aip.id,
      totals_found: false,
      vector_called: false,
      status: retrievalFailure.status,
      refusal_reason: retrievalFailure.reason,
      })
    );
    return {
      content: missingMessage,
      citations: [
        makeSystemCitation("No aip_totals row found for published AIP.", {
          type: "aip_total_missing",
          aip_id: aip.id,
          fiscal_year: aip.fiscal_year,
          scope_type: target.scopeType,
          scope_id: target.scopeId,
        }),
      ],
      retrievalMeta: {
        refused: retrievalFailure.status === "refusal",
        reason: mapRefusalReasonToMetaReason(retrievalFailure.status, retrievalFailure.reason),
        status: retrievalFailure.status,
        refusalReason: retrievalFailure.reason,
        suggestions: retrievalFailure.suggestions,
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const parsedAmount = parseAmount(totalsRow.total_investment_program);
  if (parsedAmount === null) {
    const missingMessage = buildTotalsMissingMessage({
      fiscalYear: requestedFiscalYear ?? aip.fiscal_year ?? null,
      scopeLabel: answerScopeLabel,
    });
    const retrievalFailure = buildRefusalMessage({
      intent: "totals",
      queryText: input.message,
      fiscalYear: requestedFiscalYear ?? aip.fiscal_year ?? null,
      scopeLabel: answerScopeLabel,
      explicitScopeRequested: input.scopeResolution.requestedScopes.length > 0,
      scopeResolved: true,
    });
    logTotalsRouting(
      makeTotalsLogPayload({
      request_id: input.requestId,
      intent: "total_investment_program",
      route: "sql_totals",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: totalsScope.scopeReason,
      barangay_id_used: totalsScope.barangayId,
      aip_id_selected: aip.id,
      totals_found: false,
      vector_called: false,
      status: retrievalFailure.status,
      refusal_reason: retrievalFailure.reason,
      })
    );
    return {
      content: missingMessage,
      citations: [
        makeSystemCitation("Invalid total_investment_program amount format in aip_totals.", {
          type: "aip_total_missing",
          aip_id: aip.id,
          fiscal_year: aip.fiscal_year,
        }),
      ],
      retrievalMeta: {
        refused: retrievalFailure.status === "refusal",
        reason: mapRefusalReasonToMetaReason(retrievalFailure.status, retrievalFailure.reason),
        status: retrievalFailure.status,
        refusalReason: retrievalFailure.reason,
        suggestions: retrievalFailure.suggestions,
        scopeResolution: input.scopeResolution,
      },
    };
  }

  const rawEvidence = totalsRow.evidence_text.trim();
  const formattedEvidence = formatTotalsEvidence(rawEvidence);
  const evidenceText = formattedEvidence || rawEvidence;
  const citationScopeLabel =
    target.scopeType === "barangay" && totalsScope.barangayName
      ? normalizeBarangayLabel(totalsScope.barangayName)
      : baseScopeLabel;
  const citationTitle = `${citationScopeLabel} — FY ${aip.fiscal_year} — Total Investment Program`;
  const pageLabel = totalsRow.page_no !== null ? `page ${totalsRow.page_no}` : "page not specified";
  const answer =
    `The Total Investment Program for FY ${aip.fiscal_year} (${answerScopeLabel}) is ${formatPhp(parsedAmount)}. ` +
    `Evidence: ${pageLabel}, "${evidenceText}".`;
  logTotalsRouting(
    makeTotalsLogPayload({
    request_id: input.requestId,
    intent: "total_investment_program",
    route: "sql_totals",
    fiscal_year_parsed: requestedFiscalYear,
    scope_reason: totalsScope.scopeReason,
    barangay_id_used: totalsScope.barangayId,
    aip_id_selected: aip.id,
    totals_found: true,
    vector_called: false,
    })
  );

  return {
    content: answer,
    citations: [
      {
        sourceId: "T1",
        aipId: aip.id,
        fiscalYear: aip.fiscal_year,
        scopeType: target.scopeType,
        scopeId: target.scopeId,
        scopeName: citationTitle,
        snippet: evidenceText,
        insufficient: false,
        metadata: {
          type: "aip_total",
          page_no: totalsRow.page_no,
          evidence_text: evidenceText,
          evidence_text_raw: rawEvidence,
          aip_id: aip.id,
          fiscal_year: aip.fiscal_year,
        },
      },
    ],
    retrievalMeta: {
      refused: false,
      reason: "ok",
      scopeResolution: input.scopeResolution,
    },
  };
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    assertActorPresent(actor, "Unauthorized.");
    assertPrivilegedWriteAccess({
      actor,
      allowlistedRoles: ["barangay_official", "city_official"],
      scopeByRole: {
        barangay_official: "barangay",
        city_official: "city",
      },
      requireScopeId: true,
      message: "Unauthorized.",
    });
    const privilegedActor = toPrivilegedActorContext(actor);
    if (await isUserBlocked(actor.userId)) {
      return NextResponse.json(
        { message: "Your account is currently blocked from chatbot usage." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      content?: string;
    };
    const content = normalizeUserMessage(body.content);
    const requestId = randomUUID();
    if (!content) {
      return NextResponse.json({ message: "Message cannot be empty." }, { status: 400 });
    }

    let frontendIntentClassification: PipelineIntentClassification | null = null;
    try {
      frontendIntentClassification = await requestPipelineIntentClassify({
        text: content,
      });
      if (isTotalsDebugEnabled()) {
        console.info(
          JSON.stringify({
            request_id: requestId,
            event: "frontend_intent_classified",
            intent: frontendIntentClassification.intent,
            confidence: frontendIntentClassification.confidence,
            method: frontendIntentClassification.method,
          })
        );
      }
    } catch (error) {
      if (isTotalsDebugEnabled()) {
        const message =
          error instanceof Error ? error.message : "Pipeline intent classification failed.";
        console.warn(
          JSON.stringify({
            request_id: requestId,
            event: "frontend_intent_classification_failed",
            error: message,
          })
        );
      }
    }

    const repo = getChatRepo();
    let sessionId = body.sessionId ?? null;

    if (sessionId) {
      const existing = await repo.getSession(sessionId);
      if (!existing || existing.userId !== actor.userId) {
        return NextResponse.json({ message: "Session not found." }, { status: 404 });
      }
    }

    const quota = await consumeQuota(
      privilegedActor,
      actor.userId,
      actor.role === "city_official" ? "city_chat_message" : "barangay_chat_message"
    );
    if (!quota.allowed) {
      return NextResponse.json(
        { message: "Rate limit exceeded. Please try again shortly.", reason: quota.reason },
        { status: 429 }
      );
    }

    if (!sessionId) {
      const created = await repo.createSession(actor.userId);
      sessionId = created.id;
    }

    const session = await repo.getSession(sessionId);
    if (!session || session.userId !== actor.userId) {
      return NextResponse.json({ message: "Session not found." }, { status: 404 });
    }

    const userMessage = await repo.appendUserMessage(session.id, content);
    const startedAt = Date.now();
    const frontendIntent = frontendIntentClassification?.intent;
    const confidence = frontendIntentClassification?.confidence ?? null;
    const domainCues = containsDomainCues(content);

    if (!domainCues && isConversationalIntent(frontendIntent)) {
      const shortcutScopeResolution: ChatScopeResolution = {
        mode: "global",
        requestedScopes: [],
        resolvedTargets: [],
        unresolvedScopes: [],
        ambiguousScopes: [],
      };
      const assistantMessage = await appendAssistantMessage({
        sessionId: session.id,
        content: conversationalReply(frontendIntent),
        citations: [
          makeSystemCitation("Conversational shortcut reply. No AIP retrieval was performed.", {
            reason: "conversational_shortcut",
            intent: frontendIntent,
          }),
        ],
        retrievalMeta: {
          refused: false,
          reason: "conversational_shortcut" as ChatRetrievalMeta["reason"],
          status: "answer",
          scopeResolution: shortcutScopeResolution,
          latencyMs: Date.now() - startedAt,
          contextCount: 0,
          intentClassification: frontendIntentClassification ?? undefined,
        },
      });

      if (isTotalsDebugEnabled()) {
        console.info(
          JSON.stringify({
            request_id: requestId,
            event: "frontend_conversational_shortcut",
            intent: frontendIntent,
            confidence,
            method: frontendIntentClassification?.method ?? null,
          })
        );
      }

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    const requestedFiscalYear = extractFiscalYear(content);
    const earlyDocLimitField = detectDocLimitFieldFromQuery(content.toLowerCase());
    if (earlyDocLimitField === "contractor") {
      const refusal = buildRefusalMessage({
        intent: "unanswerable_field",
        queryText: content,
        fiscalYear: requestedFiscalYear,
        docLimitField: "contractor",
      });
      const scopeResolution: ChatScopeResolution = {
        mode: "global",
        requestedScopes: [],
        resolvedTargets: [],
        unresolvedScopes: [],
        ambiguousScopes: [],
      };
      const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
        sessionId: session.id,
        content: refusal.message,
        citations: [
          makeSystemCitation("Requested field is outside published AIP structured line-item coverage.", {
            reason: refusal.reason,
          }),
        ],
        retrievalMeta: {
          refused: true,
          reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
          status: refusal.status,
          refusalReason: refusal.reason,
          suggestions: refusal.suggestions,
          scopeResolution,
          latencyMs: Date.now() - startedAt,
        },
      });

      logNonTotalsRouting({
        request_id: requestId,
        intent: "unanswerable_field",
        route: "row_sql",
        fiscal_year_parsed: requestedFiscalYear,
        scope_reason: "unknown",
        barangay_id_used: null,
        match_count_used: null,
        top_candidate_ids: [],
        top_candidate_distances: [],
        answered: false,
        vector_called: false,
        status: refusal.status,
        refusal_reason: refusal.reason,
      });

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    const client = await supabaseServer();
    const scope = await resolveRetrievalScope({
      client,
      actor,
      question: content,
    });

    const scopeResolution = toScopeResolution({
      mode: scope.scopeResolution.mode,
      requestedScopes: scope.scopeResolution.requestedScopes,
      resolvedTargets: scope.scopeResolution.resolvedTargets,
      unresolvedScopes: scope.scopeResolution.unresolvedScopes,
      ambiguousScopes: scope.scopeResolution.ambiguousScopes,
    });
    const detectedIntent = detectIntent(content).intent;

    if (!scope.retrievalScope && detectedIntent !== "total_investment_program") {
      const explicitScopeRequested = scopeResolution.requestedScopes.length > 0;
      const scopeResolved = scopeResolution.resolvedTargets.length > 0;
      const refusal = buildRefusalMessage({
        intent: "pipeline_fallback",
        queryText: content,
        explicitScopeRequested,
        scopeResolved,
      });
      const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
        sessionId: session.id,
        content: refusal.message,
        citations: [makeSystemCitation("Scope clarification required before retrieval.", scope.scopeResolution)],
        retrievalMeta: {
          refused: refusal.status === "refusal",
          reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
          status: refusal.status,
          refusalReason: refusal.reason,
          refusalDetail: "Scope resolution failed before retrieval.",
          suggestions: refusal.suggestions,
          scopeResolution,
        },
      });
      logNonTotalsRouting({
        request_id: requestId,
        intent: "clarification_needed",
        route: "row_sql",
        fiscal_year_parsed: extractFiscalYear(content),
        scope_reason: "unknown",
        barangay_id_used: null,
        match_count_used: null,
        top_candidate_ids: [],
        top_candidate_distances: [],
        answered: refusal.status !== "refusal",
        vector_called: false,
        status: refusal.status,
        refusal_reason: refusal.reason,
      });

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    const intentRoute = await routeSqlFirstTotals<TotalsAssistantPayload, null>({
      intent: detectedIntent,
      resolveTotals: async () =>
        resolveTotalsAssistantPayload({
          actor,
          message: content,
          scopeResolution,
          requestId,
        }),
      resolveNormal: async () => null,
    });

    if (intentRoute.path === "totals") {
      const totalsPayload =
        intentRoute.value ??
        ({
          content: buildTotalsMissingMessage({ fiscalYear: null, scopeLabel: null }),
          citations: [makeSystemCitation("Totals SQL path returned no payload.")],
          retrievalMeta: {
            refused: true,
            reason: "insufficient_evidence",
            scopeResolution,
          },
        } satisfies TotalsAssistantPayload);
      if (!intentRoute.value) {
        logTotalsRouting(
          makeTotalsLogPayload({
          request_id: requestId,
          intent: "total_investment_program",
          route: "sql_totals",
          fiscal_year_parsed: extractFiscalYear(content),
          scope_reason: "unknown",
          barangay_id_used: null,
          aip_id_selected: null,
          totals_found: false,
          vector_called: false,
          })
        );
      }

      const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
        sessionId: session.id,
        content: totalsPayload.content,
        citations: totalsPayload.citations,
        retrievalMeta: {
          ...totalsPayload.retrievalMeta,
          latencyMs: Date.now() - startedAt,
        },
      });

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    if (!scope.retrievalScope) {
      throw new Error("Retrieval scope missing for non-totals intent.");
    }

    const parsedLineItemQuestion = parseLineItemQuestion(content);
    const aggregationIntent = inferAggregationIntentFromPipelineClassification({
      message: content,
      detected: detectAggregationIntent(content),
      frontendIntentClassification,
    });
    const shouldDeferAggregation =
      aggregationIntent.intent === "totals_by_fund_source" && isLineItemSpecificQuery(content);
    const userBarangay = await resolveUserBarangay(actor);
    const lineItemScope = resolveLineItemScopeDecision({
      question: parsedLineItemQuestion,
      scopeResolution: {
        mode: scopeResolution.mode,
        resolvedTargets: scopeResolution.resolvedTargets,
      },
      userBarangayId: userBarangay?.id ?? null,
    });
    const explicitBarangayTarget =
      scopeResolution.resolvedTargets.find((target) => target.scopeType === "barangay") ?? null;
    const scopeBarangayName =
      lineItemScope.scopeReason === "explicit_barangay"
        ? explicitBarangayTarget?.scopeName ?? userBarangay?.name ?? null
        : lineItemScope.scopeReason === "explicit_our_barangay" ||
            lineItemScope.scopeReason === "default_user_barangay"
          ? userBarangay?.name ?? explicitBarangayTarget?.scopeName ?? null
          : null;

    const pendingClarification = await getLatestPendingClarification(session.id);
    if (pendingClarification) {
      const selection = parseClarificationSelection(content);

      if (isCityFallbackClarificationPayload(pendingClarification.payload)) {
        const cityContext = isCityFallbackClarificationContext(pendingClarification.payload.context)
          ? pendingClarification.payload.context
          : null;
        const selectedCityOption =
          selection !== null
            ? resolveCityFallbackClarificationOptionFromSelection({
                selection,
                options: pendingClarification.payload.options,
              })
            : null;

        if (isClarificationCancelMessage(content) || selectedCityOption?.action === "cancel") {
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: "Okay. Please specify a barangay or remove the city scope.",
            citations: [
              makeSystemCitation("City fallback clarification cancelled.", {
                reason: "city_fallback_cancelled",
                clarification_id: pendingClarification.payload.id,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              status: "answer",
              kind: "clarification_resolved",
              scopeReason: "fallback_barangays_in_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        if (selectedCityOption?.action === "use_barangays_in_city" && cityContext) {
          const admin = supabaseAdmin();
          const cityLabel = normalizeCityLabel(cityContext.cityName);
          const cityBarangayIds = await listBarangayIdsInCity(admin, cityContext.cityId);

          const normalizedOriginalIntent = fromCityFallbackOriginalIntent(cityContext.originalIntent);
          const fiscalYearParsed = cityContext.fiscalYearParsed ?? cityContext.fiscalYear ?? null;
          const fiscalLabel = fiscalYearParsed === null ? "All fiscal years" : `FY ${fiscalYearParsed}`;
          if (!normalizedOriginalIntent) {
            throw new Error("Unsupported city fallback intent in clarification context.");
          }

          if (cityBarangayIds.length === 0) {
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: `No active barangays were found for ${cityLabel}.`,
              citations: [
                makeSystemCitation("City fallback could not run because city has no active barangays.", {
                  city_id: cityContext.cityId,
                  city_name: cityContext.cityName,
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                status: "answer",
                kind: "clarification_resolved",
                scopeReason: "fallback_barangays_in_city",
                fallbackContext: {
                  mode: "barangays_in_city",
                  cityId: cityContext.cityId,
                  cityName: cityContext.cityName,
                  barangayIdsCount: 0,
                  coverageBarangays: [],
                  aggregationSource:
                    normalizedOriginalIntent === "total_investment_program"
                      ? "aip_totals_total_investment_program"
                      : "aip_line_items",
                },
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            if (normalizedOriginalIntent === "total_investment_program") {
              logTotalsRouting(
                makeTotalsLogPayload({
                  request_id: requestId,
                  intent: "total_investment_program",
                  route: "sql_totals",
                  fiscal_year_parsed: fiscalYearParsed,
                  scope_reason: "fallback_barangays_in_city",
                  barangay_id_used: null,
                  aip_id_selected: null,
                  totals_found: false,
                  vector_called: false,
                  city_id: cityContext.cityId,
                  fallback_mode: "barangays_in_city",
                  barangay_ids_count: 0,
                  coverage_barangays: [],
                  aggregation_source: "aip_totals_total_investment_program",
                })
              );
            } else {
              logNonTotalsRouting({
                request_id: requestId,
                intent: normalizedOriginalIntent,
                route: "aggregate_sql",
                fiscal_year_parsed:
                  normalizedOriginalIntent === "aggregate_compare_years" ? null : fiscalYearParsed,
                scope_reason: "fallback_barangays_in_city",
                barangay_id_used: null,
                match_count_used: null,
                limit_used: cityContext.limit ?? null,
                top_candidate_ids: [],
                top_candidate_distances: [],
                answered: true,
                vector_called: false,
                city_id: cityContext.cityId,
                fallback_mode: "barangays_in_city",
                barangay_ids_count: 0,
                coverage_barangays: [],
                aggregation_source: "aip_line_items",
              });
            }
            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const baseFallbackMetadata = (inputMeta: {
            aggregationSource: "aip_line_items" | "aip_totals_total_investment_program";
            coverageBarangays: string[];
            barangayIdsCount: number;
          }) => ({
            aggregated: true,
            fallback_mode: "barangays_in_city" as const,
            city_id: cityContext.cityId,
            city_name: cityContext.cityName,
            barangay_ids_count: inputMeta.barangayIdsCount,
            coverage_barangays: inputMeta.coverageBarangays,
            aggregation_source: inputMeta.aggregationSource,
          });

          if (normalizedOriginalIntent === "total_investment_program") {
            if (fiscalYearParsed === null) {
              const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
                sessionId: session.id,
                content:
                  `To compute the totals fallback for ${cityLabel}, please specify a fiscal year (for example, FY 2026).`,
                citations: [
                  makeSystemCitation("Totals city fallback requires fiscal year.", {
                    city_id: cityContext.cityId,
                    city_name: cityContext.cityName,
                    fallback_mode: "barangays_in_city",
                  }),
                ],
                retrievalMeta: {
                  refused: false,
                  reason: "clarification_needed",
                  status: "answer",
                  kind: "clarification_resolved",
                  scopeReason: "fallback_barangays_in_city",
                  scopeResolution,
                  latencyMs: Date.now() - startedAt,
                },
              });
              return NextResponse.json(
                chatResponsePayload({
                  sessionId: session.id,
                  userMessage,
                  assistantMessage,
                }),
                { status: 200 }
              );
            }

            const publishedBarangayAips = await fetchPublishedBarangayAips({
              barangayIds: cityBarangayIds,
              fiscalYear: fiscalYearParsed,
            });
            const coveredBarangayIds = publishedBarangayAips.map((row) => row.barangay_id);
            const coverage = await buildCoverageSummary({
              cityBarangayIds,
              coveredBarangayIds,
              fiscalLabel: `FY ${fiscalYearParsed}`,
            });
            const selectedAipIds = publishedBarangayAips.map((row) => row.id);

            if (selectedAipIds.length === 0) {
              const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
                sessionId: session.id,
                content:
                  `No published City AIP and no published Barangay AIPs found for ${cityLabel} (FY ${fiscalYearParsed}). ` +
                  `${coverage.line}\nPlease try another fiscal year.`,
                citations: [
                  makeAggregateCitation("No published barangay AIPs were found for city fallback totals.", {
                    ...baseFallbackMetadata({
                      aggregationSource: "aip_totals_total_investment_program",
                      coverageBarangays: coverage.coverageBarangays,
                      barangayIdsCount: cityBarangayIds.length,
                    }),
                    fiscal_year: fiscalYearParsed,
                    covered_barangay_ids_count: 0,
                    missing_barangay_ids_count: coverage.missingCount,
                  }),
                ],
                retrievalMeta: {
                  refused: false,
                  reason: "ok",
                  status: "answer",
                  kind: "clarification_resolved",
                  scopeReason: "fallback_barangays_in_city",
                  fallbackContext: {
                    mode: "barangays_in_city",
                    cityId: cityContext.cityId,
                    cityName: cityContext.cityName,
                    barangayIdsCount: cityBarangayIds.length,
                    coverageBarangays: coverage.coverageBarangays,
                    aggregationSource: "aip_totals_total_investment_program",
                  },
                  scopeResolution,
                  latencyMs: Date.now() - startedAt,
                },
              });
              logTotalsRouting(
                makeTotalsLogPayload({
                  request_id: requestId,
                  intent: "total_investment_program",
                  route: "sql_totals",
                  fiscal_year_parsed: fiscalYearParsed,
                  scope_reason: "fallback_barangays_in_city",
                  barangay_id_used: null,
                  aip_id_selected: null,
                  totals_found: false,
                  vector_called: false,
                  city_id: cityContext.cityId,
                  fallback_mode: "barangays_in_city",
                  barangay_ids_count: cityBarangayIds.length,
                  coverage_barangays: coverage.coverageBarangays,
                  aggregation_source: "aip_totals_total_investment_program",
                })
              );

              return NextResponse.json(
                chatResponsePayload({
                  sessionId: session.id,
                  userMessage,
                  assistantMessage,
                }),
                { status: 200 }
              );
            }

            const { data: totalsRows, error: totalsError } = await admin
              .from("aip_totals")
              .select("aip_id,total_investment_program")
              .eq("source_label", "total_investment_program")
              .in("aip_id", selectedAipIds);
            if (totalsError) throw new Error(totalsError.message);

            let summedTotal = 0;
            const contributingAipIds: string[] = [];
            for (const row of totalsRows ?? []) {
              const typed = row as { aip_id?: unknown; total_investment_program?: unknown };
              const amount = parseAmount(typed.total_investment_program);
              const aipId = typeof typed.aip_id === "string" ? typed.aip_id : null;
              if (aipId && amount !== null) {
                summedTotal += amount;
                contributingAipIds.push(aipId);
              }
            }
            const uniqueContributingAipIds = contributingAipIds.filter(
              (id, index, all) => id && all.indexOf(id) === index
            );
            const contributingSample =
              uniqueContributingAipIds.length > 10
                ? [...uniqueContributingAipIds.slice(0, 10), "..."]
                : uniqueContributingAipIds;

            const answerLines = [
              `No published City AIP for ${cityLabel} (FY ${fiscalYearParsed}).`,
              `Using published Barangay AIPs within ${cityLabel} instead.`,
              coverage.line,
              `Total Investment Program (sum of barangay totals) = ${formatPhp(summedTotal)}.`,
            ];

            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: answerLines.join("\n"),
              citations: [
                makeAggregateCitation(
                  "Sum of barangay Total Investment Program totals from aip_totals.",
                  {
                    ...baseFallbackMetadata({
                      aggregationSource: "aip_totals_total_investment_program",
                      coverageBarangays: coverage.coverageBarangays,
                      barangayIdsCount: cityBarangayIds.length,
                    }),
                    fiscal_year: fiscalYearParsed,
                    contributing_aip_ids: contributingSample,
                    contributing_aip_ids_count: uniqueContributingAipIds.length,
                    covered_barangay_ids_count: coverage.coveredCount,
                    missing_barangay_ids_count: coverage.missingCount,
                  }
                ),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                status: "answer",
                kind: "clarification_resolved",
                scopeReason: "fallback_barangays_in_city",
                fallbackContext: {
                  mode: "barangays_in_city",
                  cityId: cityContext.cityId,
                  cityName: cityContext.cityName,
                  barangayIdsCount: cityBarangayIds.length,
                  coverageBarangays: coverage.coverageBarangays,
                  aggregationSource: "aip_totals_total_investment_program",
                },
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logTotalsRouting(
              makeTotalsLogPayload({
                request_id: requestId,
                intent: "total_investment_program",
                route: "sql_totals",
                fiscal_year_parsed: fiscalYearParsed,
                scope_reason: "fallback_barangays_in_city",
                barangay_id_used: null,
                aip_id_selected: null,
                totals_found: uniqueContributingAipIds.length > 0,
                vector_called: false,
                city_id: cityContext.cityId,
                fallback_mode: "barangays_in_city",
                barangay_ids_count: cityBarangayIds.length,
                coverage_barangays: coverage.coverageBarangays,
                aggregation_source: "aip_totals_total_investment_program",
              })
            );
            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const aggregateIntent = normalizedOriginalIntent;

          const fallbackUsesCompareTotals = aggregateIntent === "aggregate_compare_years";
          let fallbackData: unknown = null;

          if (!fallbackUsesCompareTotals) {
            const fallbackRpcName =
              aggregateIntent === "aggregate_top_projects"
                ? "get_top_projects_for_barangays"
                : aggregateIntent === "aggregate_totals_by_sector"
                  ? "get_totals_by_sector_for_barangays"
                  : "get_totals_by_fund_source_for_barangays";

            const fallbackRpcArgs =
              aggregateIntent === "aggregate_top_projects"
                ? {
                    p_limit: cityContext.limit ?? 10,
                    p_fiscal_year: fiscalYearParsed,
                    p_barangay_ids: cityBarangayIds,
                  }
                : {
                    p_fiscal_year: fiscalYearParsed,
                    p_barangay_ids: cityBarangayIds,
                  };

            const { data, error } = await client.rpc(fallbackRpcName, fallbackRpcArgs);
            if (error) throw new Error(error.message);
            fallbackData = data;
          }

          const fallbackLogBase = {
            request_id: requestId,
            intent: aggregateIntent,
            route: "aggregate_sql" as const,
            fiscal_year_parsed: aggregateIntent === "aggregate_compare_years" ? null : fiscalYearParsed,
            scope_reason: "fallback_barangays_in_city" as const,
            barangay_id_used: null,
            match_count_used: null,
            limit_used: cityContext.limit ?? null,
            top_candidate_ids: [] as string[],
            top_candidate_distances: [] as number[],
            answered: true,
            vector_called: false,
            city_id: cityContext.cityId,
            fallback_mode: "barangays_in_city" as const,
            aggregation_source: "aip_line_items" as const,
          };

          if (aggregateIntent === "aggregate_top_projects") {
            const coveredRows = await fetchPublishedBarangayAips({
              barangayIds: cityBarangayIds,
              fiscalYear: fiscalYearParsed,
            });
            const coverage = await buildCoverageSummary({
              cityBarangayIds,
              coveredBarangayIds: coveredRows.map((row) => row.barangay_id),
              fiscalLabel,
            });
            const rows = toTopProjectRows(fallbackData);
            const listLines =
              rows.length === 0
                ? ["No published AIP line items matched the selected filters."]
                : rows.map((row, index) => {
                    const total = formatPhpAmount(toNumberOrNull(row.total));
                    const fund = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
                    const fyLabel = typeof row.fiscal_year === "number" ? `FY ${row.fiscal_year}` : "FY Any";
                    const refLabel = row.aip_ref_code ? `Ref ${row.aip_ref_code}` : "Ref N/A";
                    return `${index + 1}. ${row.program_project_title} - ${total} - ${fund} - ${fyLabel} - ${refLabel}`;
                  });
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content:
                `Top ${Math.max(rows.length, 0)} projects by total (All barangays in ${cityLabel}; ${fiscalLabel}):\n` +
                `${coverage.line}\n` +
                "Aggregated from published AIP line items of covered barangays.\n" +
                listLines.join("\n"),
              citations: [
                makeAggregateCitation("Aggregated from published AIP line items of covered barangays.", {
                  ...baseFallbackMetadata({
                    aggregationSource: "aip_line_items",
                    coverageBarangays: coverage.coverageBarangays,
                    barangayIdsCount: cityBarangayIds.length,
                  }),
                  aggregate_type: "top_projects",
                  fiscal_year_filter: fiscalYearParsed,
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                status: "answer",
                kind: "clarification_resolved",
                scopeReason: "fallback_barangays_in_city",
                fallbackContext: {
                  mode: "barangays_in_city",
                  cityId: cityContext.cityId,
                  cityName: cityContext.cityName,
                  barangayIdsCount: cityBarangayIds.length,
                  coverageBarangays: coverage.coverageBarangays,
                  aggregationSource: "aip_line_items",
                },
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              ...fallbackLogBase,
              barangay_ids_count: cityBarangayIds.length,
              coverage_barangays: coverage.coverageBarangays,
            });
            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          if (aggregateIntent === "aggregate_totals_by_sector") {
            const coveredRows = await fetchPublishedBarangayAips({
              barangayIds: cityBarangayIds,
              fiscalYear: fiscalYearParsed,
            });
            const coverage = await buildCoverageSummary({
              cityBarangayIds,
              coveredBarangayIds: coveredRows.map((row) => row.barangay_id),
              fiscalLabel,
            });
            const rows = toTotalsBySectorRows(fallbackData);
            const contentLines =
              rows.length === 0
                ? ["No published AIP line items matched the selected filters."]
                : rows.map((row, index) => {
                    const label =
                      [row.sector_code, row.sector_name].filter(Boolean).join(" - ") || "Unspecified sector";
                    return `${index + 1}. ${label}: ${formatPhpAmount(toNumberOrNull(row.sector_total))} (${parseInteger(row.count_items) ?? 0} items)`;
                  });
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content:
                `Budget totals by sector (All barangays in ${cityLabel}; ${fiscalLabel}):\n` +
                `${coverage.line}\n` +
                "Aggregated from published AIP line items of covered barangays.\n" +
                contentLines.join("\n"),
              citations: [
                makeAggregateCitation("Aggregated from published AIP line items of covered barangays.", {
                  ...baseFallbackMetadata({
                    aggregationSource: "aip_line_items",
                    coverageBarangays: coverage.coverageBarangays,
                    barangayIdsCount: cityBarangayIds.length,
                  }),
                  aggregate_type: "totals_by_sector",
                  fiscal_year_filter: fiscalYearParsed,
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                status: "answer",
                kind: "clarification_resolved",
                scopeReason: "fallback_barangays_in_city",
                fallbackContext: {
                  mode: "barangays_in_city",
                  cityId: cityContext.cityId,
                  cityName: cityContext.cityName,
                  barangayIdsCount: cityBarangayIds.length,
                  coverageBarangays: coverage.coverageBarangays,
                  aggregationSource: "aip_line_items",
                },
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              ...fallbackLogBase,
              barangay_ids_count: cityBarangayIds.length,
              coverage_barangays: coverage.coverageBarangays,
            });
            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          if (aggregateIntent === "aggregate_totals_by_fund_source") {
            const coveredRows = await fetchPublishedBarangayAips({
              barangayIds: cityBarangayIds,
              fiscalYear: fiscalYearParsed,
            });
            const coverage = await buildCoverageSummary({
              cityBarangayIds,
              coveredBarangayIds: coveredRows.map((row) => row.barangay_id),
              fiscalLabel,
            });
            const rows = toTotalsByFundSourceRows(fallbackData);
            const listOnly = cityContext.listOnly === true;
            const contentLines =
              rows.length === 0
                ? ["No published AIP line items matched the selected filters."]
                : listOnly
                  ? Array.from(
                      new Set(
                        rows
                          .map((row) => (row.fund_source ?? "Unspecified").trim() || "Unspecified")
                          .sort((a, b) => a.localeCompare(b))
                      )
                    ).map((label, index) => `${index + 1}. ${label}`)
                  : rows.map((row, index) => {
                      const label = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
                      return `${index + 1}. ${label}: ${formatPhpAmount(toNumberOrNull(row.fund_total))} (${parseInteger(row.count_items) ?? 0} items)`;
                    });
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content:
                (listOnly
                  ? `Fund sources (All barangays in ${cityLabel}; ${fiscalLabel}):\n`
                  : `Budget totals by fund source (All barangays in ${cityLabel}; ${fiscalLabel}):\n`) +
                `${coverage.line}\n` +
                "Aggregated from published AIP line items of covered barangays.\n" +
                contentLines.join("\n"),
              citations: [
                makeAggregateCitation("Aggregated from published AIP line items of covered barangays.", {
                  ...baseFallbackMetadata({
                    aggregationSource: "aip_line_items",
                    coverageBarangays: coverage.coverageBarangays,
                    barangayIdsCount: cityBarangayIds.length,
                  }),
                  aggregate_type: "totals_by_fund_source",
                  fiscal_year_filter: fiscalYearParsed,
                  output_mode: listOnly ? "fund_source_list" : "totals_with_counts",
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                status: "answer",
                kind: "clarification_resolved",
                scopeReason: "fallback_barangays_in_city",
                fallbackContext: {
                  mode: "barangays_in_city",
                  cityId: cityContext.cityId,
                  cityName: cityContext.cityName,
                  barangayIdsCount: cityBarangayIds.length,
                  coverageBarangays: coverage.coverageBarangays,
                  aggregationSource: "aip_line_items",
                },
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              ...fallbackLogBase,
              barangay_ids_count: cityBarangayIds.length,
              coverage_barangays: coverage.coverageBarangays,
            });
            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const yearA = cityContext.yearA ?? null;
          const yearB = cityContext.yearB ?? null;
          if (yearA === null || yearB === null) {
            throw new Error("City fallback compare-years requires both fiscal years.");
          }

          const yearAResult = await fetchTotalInvestmentProgramTotalsByYear({
            year: yearA,
            scopeMode: "barangays_in_city",
            cityId: cityContext.cityId,
            cityName: cityContext.cityName,
            cityBarangayIds,
          });
          const yearBResult = await fetchTotalInvestmentProgramTotalsByYear({
            year: yearB,
            scopeMode: "barangays_in_city",
            cityId: cityContext.cityId,
            cityName: cityContext.cityName,
            cityBarangayIds,
          });
          const compareVerbose = buildCompareYearsVerboseAnswer({
            yearA,
            yearB,
            scopeLabel: `All barangays in ${cityLabel}`,
            sourceNote: `Using sum of barangay totals (aip_totals) within ${cityLabel}.`,
            yearAResult,
            yearBResult,
          });
          const contributingYearASample = formatIdSample(yearAResult.contributingAipIds);
          const contributingYearBSample = formatIdSample(yearBResult.contributingAipIds);
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: compareVerbose.content,
            citations: [
              makeAggregateCitation("Aggregated from aip_totals (Total Investment Program).", {
                ...baseFallbackMetadata({
                  aggregationSource: "aip_totals_total_investment_program",
                  coverageBarangays: compareVerbose.coverageBarangays,
                  barangayIdsCount: cityBarangayIds.length,
                }),
                aggregate_type: "compare_years_verbose",
                scope_mode: "barangays_in_city",
                aggregation_source: "aip_totals_total_investment_program",
                year_a: yearA,
                year_b: yearB,
                coverage_year_a_count: yearAResult.coveredCount,
                coverage_year_b_count: yearBResult.coveredCount,
                missing_year_a_count: yearAResult.missingIds.length,
                missing_year_b_count: yearBResult.missingIds.length,
                contributing_aip_ids_year_a_sample: contributingYearASample,
                contributing_aip_ids_year_a_count: yearAResult.contributingAipIds.length,
                contributing_aip_ids_year_b_sample: contributingYearBSample,
                contributing_aip_ids_year_b_count: yearBResult.contributingAipIds.length,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              status: "answer",
              kind: "clarification_resolved",
              scopeReason: "fallback_barangays_in_city",
              fallbackContext: {
                mode: "barangays_in_city",
                cityId: cityContext.cityId,
                cityName: cityContext.cityName,
                barangayIdsCount: cityBarangayIds.length,
                coverageBarangays: compareVerbose.coverageBarangays,
                aggregationSource: "aip_totals_total_investment_program",
              },
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            ...fallbackLogBase,
            fiscal_year_parsed: null,
            barangay_ids_count: cityBarangayIds.length,
            coverage_barangays: compareVerbose.coverageBarangays,
            aggregation_source: "aip_totals_total_investment_program",
            coverage_year_a_count: yearAResult.coveredCount,
            coverage_year_b_count: yearBResult.coveredCount,
            missing_year_a_count: yearAResult.missingIds.length,
            missing_year_b_count: yearBResult.missingIds.length,
          });
          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        if (
          !selectedCityOption &&
          shouldRepromptClarification({
            message: content,
            selection,
            frontendIntentClassification,
          })
        ) {
          const reminderPayload: ChatClarificationPayload = {
            id: pendingClarification.payload.id,
            kind: "city_aip_missing_fallback",
            prompt: "Please reply with 1-2.",
            options: pendingClarification.payload.options,
          };
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: buildClarificationPromptContent(reminderPayload),
            citations: [
              makeSystemCitation("City fallback clarification reminder: awaiting valid selection.", {
                reason: "clarification_selection_required",
                clarification_id: pendingClarification.payload.id,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "clarification_needed",
              status: "clarification",
              kind: "clarification",
              scopeReason: "fallback_barangays_in_city",
              clarification: {
                ...reminderPayload,
                context: pendingClarification.payload.context,
              },
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }
      }

      if (isLineItemClarificationPayload(pendingClarification.payload)) {
        const selectedOption =
          selection !== null
            ? resolveLineItemClarificationOptionFromSelection({
                selection,
                options: pendingClarification.payload.options,
              })
            : null;

        if (selectedOption) {
          const lineItemContext = isLineItemClarificationContext(pendingClarification.payload.context)
            ? pendingClarification.payload.context
            : null;
          const { data: selectedRowData, error: selectedRowError } = await client
            .from("aip_line_items")
            .select(
            "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,implementing_agency,start_date,end_date,fund_source,ps,mooe,co,fe,total,expected_output,page_no,row_no,table_no"
          )
          .eq("id", selectedOption.lineItemId)
          .maybeSingle();
        if (selectedRowError) {
          throw new Error(selectedRowError.message);
        }

        const selectedRows = toLineItemRows(selectedRowData ? [selectedRowData] : []);
        if (selectedRows.length > 0) {
          const resolvedRow = selectedRows[0];
          const contextFactFields = parseFactFields(lineItemContext?.factFields);
          const factFields =
            contextFactFields.length > 0
              ? contextFactFields
              : parsedLineItemQuestion.factFields;

          const contextScopeReason = lineItemContext?.scopeReason;
          const resolvedScopeReason =
            contextScopeReason === "explicit_barangay" ||
            contextScopeReason === "explicit_our_barangay" ||
            contextScopeReason === "default_user_barangay" ||
            contextScopeReason === "global" ||
            contextScopeReason === "unknown"
              ? contextScopeReason
              : lineItemScope.scopeReason;

          const resolvedBarangayName =
            lineItemContext?.barangayName ?? scopeBarangayName;

          const scopeDisclosure = buildLineItemScopeDisclosure({
            scopeReason: resolvedScopeReason,
            barangayName: resolvedBarangayName,
          });

          const assistantContent = buildLineItemAnswer({
            row: resolvedRow,
            fields: factFields,
            scopeDisclosure,
          });

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: assistantContent,
            citations: [
              {
                sourceId: "L1",
                aipId: resolvedRow.aip_id,
                fiscalYear: resolvedRow.fiscal_year,
                scopeType: resolvedRow.barangay_id ? "barangay" : "unknown",
                scopeId: resolvedRow.barangay_id,
                scopeName: buildLineItemCitationScopeName({
                  title: resolvedRow.program_project_title,
                  fiscalYear: resolvedRow.fiscal_year,
                  barangayName: resolvedBarangayName,
                  scopeReason: resolvedScopeReason,
                }),
                snippet: buildLineItemCitationSnippet(resolvedRow),
                insufficient: false,
                metadata: {
                  type: "aip_line_item",
                  line_item_id: resolvedRow.id,
                  aip_ref_code: resolvedRow.aip_ref_code,
                  page_no: resolvedRow.page_no,
                  row_no: resolvedRow.row_no,
                  table_no: resolvedRow.table_no,
                  aip_id: resolvedRow.aip_id,
                  fiscal_year: resolvedRow.fiscal_year,
                  barangay_id: resolvedRow.barangay_id,
                  total: formatPhpAmount(resolvedRow.total),
                },
              },
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              status: "answer",
              kind: "clarification_resolved",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
              clarificationResolution: {
                clarificationId: pendingClarification.payload.id,
                selectedLineItemId: resolvedRow.id,
              },
            },
          });

          logClarificationLifecycle({
            request_id: requestId,
            event: "clarification_resolved",
            session_id: session.id,
            clarification_id: pendingClarification.payload.id,
            selected_line_item_id: resolvedRow.id,
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "line_item_fact",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: resolvedScopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: null,
            top_candidate_ids: [resolvedRow.id],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }), { status: 200 });
        }
      }

        if (!selectedOption && isClarificationCancelMessage(content)) {
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: "Okay - please restate the project title or provide the Ref code.",
            citations: [
              makeSystemCitation("Clarification flow cancelled by user.", {
                reason: "clarification_cancelled",
                clarification_id: pendingClarification.payload.id,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              status: "answer",
              kind: "clarification_resolved",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "clarification_needed",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }), { status: 200 });
        }

        if (
          !selectedOption &&
          shouldRepromptClarification({
            message: content,
            selection,
            frontendIntentClassification,
          })
        ) {
          const reminderPayload: ChatClarificationPayload = {
            id: pendingClarification.payload.id,
            kind: pendingClarification.payload.kind,
            prompt: "Please reply with 1-3, or type the Ref code.",
            options: pendingClarification.payload.options,
          };

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: buildClarificationPromptContent(reminderPayload),
            citations: [
              makeSystemCitation("Clarification reminder: awaiting valid selection.", {
                reason: "clarification_selection_required",
                clarification_id: pendingClarification.payload.id,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "clarification_needed",
              status: "clarification",
              kind: "clarification",
              clarification: {
                ...reminderPayload,
                context: pendingClarification.payload.context,
              },
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "clarification_needed",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: null,
            top_candidate_ids: pendingClarification.payload.options.map((option) => option.lineItemId),
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }), { status: 200 });
        }
      }
    }

    if (aggregationIntent.intent !== "none" && !shouldDeferAggregation) {
      const explicitCityScope = await resolveExplicitCityScopeFromMessage({
        message: content,
        scopeResolution,
      });
      const aggregationScope = await resolveAggregationScopeDecision({
        message: content,
        scopeResolution,
        userBarangay,
      });
      const aggregationLogIntent = toAggregationLogIntent(aggregationIntent.intent);
      const fiscalYearForAggregation =
        aggregationIntent.intent === "compare_years" ? null : requestedFiscalYear;
      const aggregationLimit =
        aggregationIntent.intent === "top_projects" ? aggregationIntent.limit ?? 10 : null;

      if (explicitCityScope.kind === "explicit_city") {
        const admin = supabaseAdmin();
        const cityLabel = normalizeCityLabel(explicitCityScope.city.name);
        const cityScopeLabel = cityLabel;
        if (aggregationIntent.intent === "compare_years") {
          const yearA = aggregationIntent.yearA ?? null;
          const yearB = aggregationIntent.yearB ?? null;
          if (yearA === null || yearB === null) {
            throw new Error("Aggregation compare years intent requires two years.");
          }

          const yearAResult = await fetchTotalInvestmentProgramTotalsByYear({
            year: yearA,
            scopeMode: "city_aip",
            cityId: explicitCityScope.city.id,
            cityName: explicitCityScope.city.name,
          });
          const yearBResult = await fetchTotalInvestmentProgramTotalsByYear({
            year: yearB,
            scopeMode: "city_aip",
            cityId: explicitCityScope.city.id,
            cityName: explicitCityScope.city.name,
          });

          if (yearAResult.coveredCount === 0 || yearBResult.coveredCount === 0) {
            const clarificationPayload = buildCityAipMissingClarificationPayload({
              cityName: explicitCityScope.city.name,
              fiscalYearParsed: null,
            });
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: buildClarificationPromptContent(clarificationPayload),
              citations: [
                makeSystemCitation("City AIP missing for compare-years; offered barangays-in-city fallback.", {
                  reason: "city_aip_missing_fallback_offered",
                  city_id: explicitCityScope.city.id,
                  city_name: explicitCityScope.city.name,
                  year_a: yearA,
                  year_b: yearB,
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "clarification_needed",
                status: "clarification",
                kind: "clarification",
                clarification: {
                  ...clarificationPayload,
                  context: {
                    cityId: explicitCityScope.city.id,
                    cityName: explicitCityScope.city.name,
                    fiscalYearParsed: null,
                    originalIntent: "aggregate_compare_years",
                    yearA,
                    yearB,
                  },
                },
                scopeReason: "explicit_city",
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              request_id: requestId,
              intent: aggregationLogIntent,
              route: "aggregate_sql",
              fiscal_year_parsed: null,
              scope_reason: "explicit_city",
              barangay_id_used: null,
              match_count_used: null,
              limit_used: null,
              top_candidate_ids: [],
              top_candidate_distances: [],
              answered: true,
              vector_called: false,
              city_id: explicitCityScope.city.id,
            });

            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const compareVerbose = buildCompareYearsVerboseAnswer({
            yearA,
            yearB,
            scopeLabel: cityScopeLabel,
            sourceNote: "Using City AIP totals.",
            yearAResult,
            yearBResult,
          });
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: compareVerbose.content,
            citations: [
              makeAggregateCitation("Aggregated from aip_totals (Total Investment Program).", {
                aggregated: true,
                aggregate_type: "compare_years_verbose",
                aggregation_source: "aip_totals_total_investment_program",
                scope_mode: "city_aip",
                year_a: yearA,
                year_b: yearB,
                city_id: explicitCityScope.city.id,
                city_name: explicitCityScope.city.name,
                coverage_year_a_count: yearAResult.coveredCount,
                coverage_year_b_count: yearBResult.coveredCount,
                missing_year_a_count: yearAResult.missingIds.length,
                missing_year_b_count: yearBResult.missingIds.length,
                contributing_aip_ids_year_a_sample: formatIdSample(yearAResult.contributingAipIds),
                contributing_aip_ids_year_a_count: yearAResult.contributingAipIds.length,
                contributing_aip_ids_year_b_sample: formatIdSample(yearBResult.contributingAipIds),
                contributing_aip_ids_year_b_count: yearBResult.contributingAipIds.length,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeReason: "explicit_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: null,
            scope_reason: "explicit_city",
            barangay_id_used: null,
            match_count_used: null,
            limit_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
            city_id: explicitCityScope.city.id,
            aggregation_source: "aip_totals_total_investment_program",
            coverage_year_a_count: yearAResult.coveredCount,
            coverage_year_b_count: yearBResult.coveredCount,
            missing_year_a_count: yearAResult.missingIds.length,
            missing_year_b_count: yearBResult.missingIds.length,
            coverage_barangays: compareVerbose.coverageBarangays,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        const cityAip = await selectPublishedCityAip(
          admin,
          explicitCityScope.city.id,
          fiscalYearForAggregation
        );

        if (!cityAip.aipId) {
          const clarificationPayload = buildCityAipMissingClarificationPayload({
            cityName: explicitCityScope.city.name,
            fiscalYearParsed: fiscalYearForAggregation,
          });
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: buildClarificationPromptContent(clarificationPayload),
            citations: [
              makeSystemCitation("City AIP not found; offered barangays-in-city fallback.", {
                reason: "city_aip_missing_fallback_offered",
                city_id: explicitCityScope.city.id,
                city_name: explicitCityScope.city.name,
                fiscal_year: fiscalYearForAggregation,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "clarification_needed",
              status: "clarification",
              kind: "clarification",
              clarification: {
                ...clarificationPayload,
                context: {
                  cityId: explicitCityScope.city.id,
                  cityName: explicitCityScope.city.name,
                  fiscalYearParsed: fiscalYearForAggregation,
                  originalIntent: toCityFallbackOriginalIntent(aggregationIntent.intent),
                  limit: aggregationLimit,
                  yearA: aggregationIntent.yearA ?? null,
                  yearB: aggregationIntent.yearB ?? null,
                  listOnly:
                    aggregationIntent.intent === "totals_by_fund_source"
                      ? isFundSourceListQuery(content)
                      : undefined,
                },
              },
              scopeReason: "explicit_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: "explicit_city",
            barangay_id_used: null,
            match_count_used: null,
            limit_used: aggregationLimit,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
            city_id: explicitCityScope.city.id,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        const cityFiscalLabel =
          fiscalYearForAggregation === null ? "All fiscal years" : `FY ${fiscalYearForAggregation}`;

        if (aggregationIntent.intent === "top_projects") {
          let topProjectsQuery = client
            .from("aip_line_items")
            .select(
              "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,fund_source,start_date,end_date,total,page_no,row_no,table_no"
            )
            .eq("aip_id", cityAip.aipId)
            .not("total", "is", null)
            .order("total", { ascending: false })
            .limit(Math.max(1, Math.min(aggregationLimit ?? 10, 50)));

          if (fiscalYearForAggregation !== null) {
            topProjectsQuery = topProjectsQuery.eq("fiscal_year", fiscalYearForAggregation);
          }

          const { data, error } = await topProjectsQuery;
          if (error) throw new Error(error.message);
          const rows = toTopProjectRows(
            (data ?? []).map((row) => ({
              line_item_id: (row as { id: string }).id,
              ...(row as Record<string, unknown>),
            }))
          );

          const listLines =
            rows.length === 0
              ? ["No published AIP line items matched the selected filters."]
              : rows.map((row, index) => {
                  const total = formatPhpAmount(toNumberOrNull(row.total));
                  const fund = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
                  const fyLabel = typeof row.fiscal_year === "number" ? `FY ${row.fiscal_year}` : "FY Any";
                  const refLabel = row.aip_ref_code ? `Ref ${row.aip_ref_code}` : "Ref N/A";
                  return `${index + 1}. ${row.program_project_title} - ${total} - ${fund} - ${fyLabel} - ${refLabel}`;
                });

          const citations: ChatCitation[] = rows.map((row, index) => ({
            sourceId: `A${index + 1}`,
            aipId: row.aip_id,
            fiscalYear: row.fiscal_year,
            scopeType: "city",
            scopeId: explicitCityScope.city.id,
            scopeName: `${cityScopeLabel} - FY ${row.fiscal_year ?? "Any"} - ${row.program_project_title}`,
            snippet:
              `Total: ${formatPhpAmount(toNumberOrNull(row.total))} - ` +
              `Fund: ${(row.fund_source ?? "Unspecified").trim() || "Unspecified"} - ` +
              `Schedule: ${formatScheduleRange(row.start_date, row.end_date)} - ` +
              `Ref: ${row.aip_ref_code ?? "N/A"}`,
            insufficient: false,
            metadata: {
              type: "aip_line_item",
              aggregate_type: "top_projects_city_aip",
              line_item_id: row.line_item_id,
              aip_id: row.aip_id,
              city_id: explicitCityScope.city.id,
              fiscal_year: row.fiscal_year,
              page_no: row.page_no,
              row_no: row.row_no,
              table_no: row.table_no,
            },
          }));

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: `Top ${rows.length} projects by total (${cityScopeLabel}; ${cityFiscalLabel}):\n${listLines.join("\n")}`,
            citations:
              citations.length > 0
                ? citations
                : [
                    makeAggregateCitation("Aggregated from published AIP line items.", {
                      aggregated: true,
                      city_id_filter: explicitCityScope.city.id,
                      city_aip_id: cityAip.aipId,
                    }),
                  ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeReason: "explicit_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: "explicit_city",
            barangay_id_used: null,
            match_count_used: null,
            limit_used: aggregationLimit,
            top_candidate_ids: rows.slice(0, 3).map((row) => row.line_item_id),
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
            city_id: explicitCityScope.city.id,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        let cityRowsQuery = client
          .from("aip_line_items")
          .select(
            "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,sector_code,sector_name,fund_source,total"
          )
          .eq("aip_id", cityAip.aipId);
        if (fiscalYearForAggregation !== null) {
          cityRowsQuery = cityRowsQuery.eq("fiscal_year", fiscalYearForAggregation);
        }
        const { data: cityRowsData, error: cityRowsError } = await cityRowsQuery;
        if (cityRowsError) throw new Error(cityRowsError.message);
        const cityRows = (cityRowsData ?? []) as Array<{
          fiscal_year: number | null;
          fund_source: string | null;
          total: number | null;
        }>;

        if (aggregationIntent.intent === "totals_by_sector") {
          const sectorMap = new Map<string, { code: string | null; name: string | null; total: number; count: number }>();
          for (const row of cityRowsData ?? []) {
            const typed = row as { sector_code?: string | null; sector_name?: string | null; total?: unknown };
            const key = `${typed.sector_code ?? ""}|${typed.sector_name ?? ""}`;
            const current = sectorMap.get(key) ?? {
              code: typed.sector_code ?? null,
              name: typed.sector_name ?? null,
              total: 0,
              count: 0,
            };
            current.total += parseAmount(typed.total ?? null) ?? 0;
            current.count += 1;
            sectorMap.set(key, current);
          }
          const rows = Array.from(sectorMap.values()).sort((a, b) => b.total - a.total);
          const contentLines =
            rows.length === 0
              ? ["No published AIP line items matched the selected filters."]
              : rows.map((row, index) => {
                  const label = [row.code, row.name].filter(Boolean).join(" - ") || "Unspecified sector";
                  return `${index + 1}. ${label}: ${formatPhpAmount(row.total)} (${row.count} items)`;
                });
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: `Budget totals by sector (${cityScopeLabel}; ${cityFiscalLabel}):\n${contentLines.join("\n")}`,
            citations: [
              makeAggregateCitation("Aggregated from published AIP line items.", {
                aggregated: true,
                source: "aip_line_items",
                aggregate_type: "totals_by_sector",
                city_id_filter: explicitCityScope.city.id,
                city_aip_id: cityAip.aipId,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeReason: "explicit_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: "explicit_city",
            barangay_id_used: null,
            match_count_used: null,
            limit_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
            city_id: explicitCityScope.city.id,
          });
          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        if (aggregationIntent.intent === "totals_by_fund_source") {
          const fundMap = new Map<string, { label: string; total: number; count: number }>();
          for (const row of cityRows) {
            const label = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
            const current = fundMap.get(label) ?? { label, total: 0, count: 0 };
            current.total += parseAmount(row.total) ?? 0;
            current.count += 1;
            fundMap.set(label, current);
          }
          const rows = Array.from(fundMap.values()).sort((a, b) => b.total - a.total);
          const listOnly = isFundSourceListQuery(content);
          const contentLines =
            rows.length === 0
              ? ["No published AIP line items matched the selected filters."]
              : listOnly
                ? rows.map((row, index) => `${index + 1}. ${row.label}`)
                : rows.map(
                    (row, index) =>
                      `${index + 1}. ${row.label}: ${formatPhpAmount(row.total)} (${row.count} items)`
                  );
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: listOnly
              ? `Fund sources (${cityScopeLabel}; ${cityFiscalLabel}):\n${contentLines.join("\n")}`
              : `Budget totals by fund source (${cityScopeLabel}; ${cityFiscalLabel}):\n${contentLines.join("\n")}`,
            citations: [
              makeAggregateCitation("Aggregated from published AIP line items.", {
                aggregated: true,
                source: "aip_line_items",
                aggregate_type: "totals_by_fund_source",
                city_id_filter: explicitCityScope.city.id,
                city_aip_id: cityAip.aipId,
                output_mode: listOnly ? "fund_source_list" : "totals_with_counts",
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeReason: "explicit_city",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: "explicit_city",
            barangay_id_used: null,
            match_count_used: null,
            limit_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
            city_id: explicitCityScope.city.id,
          });
          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

      }

      if (aggregationScope.clarificationMessage) {
        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content: aggregationScope.clarificationMessage,
          citations: [
            makeSystemCitation("Aggregation scope clarification required.", {
              reason: "aggregation_scope_ambiguous_barangay_name",
            }),
          ],
          retrievalMeta: {
            refused: false,
            reason: "clarification_needed",
            status: "clarification",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: aggregationLogIntent,
          route: "aggregate_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: aggregationScope.scopeReason,
          barangay_id_used: null,
          match_count_used: null,
          limit_used: aggregationLimit,
          top_candidate_ids: [],
          top_candidate_distances: [],
          answered: true,
          vector_called: false,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      }

      if (aggregationScope.unsupportedScopeType === "municipality") {
        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content:
            "I can aggregate by one barangay or across all barangays. Please specify a barangay or say 'across all barangays'.",
          citations: [
            makeSystemCitation("Aggregation scope clarification required for non-barangay place scope.", {
              reason: "aggregation_scope_requires_barangay_or_global",
              requested_scope_type: aggregationScope.unsupportedScopeType,
            }),
          ],
          retrievalMeta: {
            refused: false,
            reason: "clarification_needed",
            status: "clarification",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: aggregationLogIntent,
          route: "aggregate_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: aggregationScope.scopeReason,
          barangay_id_used: null,
          match_count_used: null,
          limit_used: aggregationLimit,
          top_candidate_ids: [],
          top_candidate_distances: [],
          answered: true,
          vector_called: false,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      }

      const scopeLabel = aggregationScope.barangayIdUsed
        ? normalizeBarangayLabel(aggregationScope.barangayName ?? "your barangay")
        : "All barangays";
      const fiscalLabel = fiscalYearForAggregation === null ? "All fiscal years" : `FY ${fiscalYearForAggregation}`;

      try {
        if (aggregationIntent.intent === "top_projects") {
          const { data, error } = await client.rpc("get_top_projects", {
            p_limit: aggregationLimit,
            p_fiscal_year: fiscalYearForAggregation,
            p_barangay_id: aggregationScope.barangayIdUsed,
          });
          if (error) {
            throw new Error(error.message);
          }

          const rows = toTopProjectRows(data);
          if (rows.length === 0) {
            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: "No published AIP line items matched the selected filters.",
              citations: [
                makeAggregateCitation("Aggregated from published AIP line items.", {
                  aggregated: true,
                  aggregate_type: "top_projects",
                  source: "aip_line_items",
                  fiscal_year_filter: fiscalYearForAggregation,
                  barangay_id_filter: aggregationScope.barangayIdUsed,
                }),
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              request_id: requestId,
              intent: aggregationLogIntent,
              route: "aggregate_sql",
              fiscal_year_parsed: requestedFiscalYear,
              scope_reason: aggregationScope.scopeReason,
              barangay_id_used: aggregationScope.barangayIdUsed,
              match_count_used: null,
              limit_used: aggregationLimit,
              top_candidate_ids: [],
              top_candidate_distances: [],
              answered: true,
              vector_called: false,
            });

            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const topBarangayMap =
            aggregationScope.barangayIdUsed === null
              ? await fetchBarangayNameMap(
                  rows
                    .map((row) => row.barangay_id)
                    .filter((barangayId): barangayId is string => Boolean(barangayId))
                )
              : new Map<string, string>();
          if (aggregationScope.barangayIdUsed && aggregationScope.barangayName) {
            topBarangayMap.set(aggregationScope.barangayIdUsed, aggregationScope.barangayName);
          }

          const listLines = rows.map((row, index) => {
            const total = formatPhpAmount(toNumberOrNull(row.total));
            const fund = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
            const fyLabel = typeof row.fiscal_year === "number" ? `FY ${row.fiscal_year}` : "FY Any";
            const refLabel = row.aip_ref_code ? `Ref ${row.aip_ref_code}` : "Ref N/A";
            const rowBarangayName =
              row.barangay_id && topBarangayMap.has(row.barangay_id)
                ? normalizeBarangayLabel(topBarangayMap.get(row.barangay_id) ?? "")
                : row.barangay_id
                  ? `Barangay ID ${row.barangay_id}`
                  : "All barangays";
            return `${index + 1}. ${row.program_project_title} — ${total} — ${fund} — ${fyLabel} — ${rowBarangayName} — ${refLabel}`;
          });

          const assistantContent =
            `Top ${rows.length} projects by total (${scopeLabel}; ${fiscalLabel}):\n` +
            listLines.join("\n");

          const citations: ChatCitation[] = rows.map((row, index) => {
            const rowFiscalYear = typeof row.fiscal_year === "number" ? row.fiscal_year : null;
            const rowBarangayName =
              row.barangay_id && topBarangayMap.has(row.barangay_id)
                ? normalizeBarangayLabel(topBarangayMap.get(row.barangay_id) ?? "")
                : aggregationScope.barangayName
                  ? normalizeBarangayLabel(aggregationScope.barangayName)
                  : "All barangays";
            const scopeName =
              row.barangay_id || aggregationScope.barangayIdUsed
                ? `${rowBarangayName} — FY ${rowFiscalYear ?? "Any"} — ${row.program_project_title}`
                : `All barangays — FY ${rowFiscalYear ?? "Any"} — ${row.program_project_title}`;

            return {
              sourceId: `A${index + 1}`,
              aipId: row.aip_id,
              fiscalYear: rowFiscalYear,
              scopeType: row.barangay_id ? "barangay" : "unknown",
              scopeId: row.barangay_id,
              scopeName,
              snippet:
                `Total: ${formatPhpAmount(toNumberOrNull(row.total))} - ` +
                `Fund: ${(row.fund_source ?? "Unspecified").trim() || "Unspecified"} - ` +
                `Schedule: ${formatScheduleRange(row.start_date, row.end_date)} - ` +
                `Ref: ${row.aip_ref_code ?? "N/A"}`,
              insufficient: false,
              metadata: {
                type: "aip_line_item",
                aggregate_type: "top_projects",
                line_item_id: row.line_item_id,
                aip_id: row.aip_id,
                fiscal_year: row.fiscal_year,
                barangay_id: row.barangay_id,
                aip_ref_code: row.aip_ref_code,
                page_no: row.page_no,
                row_no: row.row_no,
                table_no: row.table_no,
                fiscal_year_filter: fiscalYearForAggregation,
                barangay_id_filter: aggregationScope.barangayIdUsed,
              },
            };
          });

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: assistantContent,
            citations,
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: aggregationScope.scopeReason,
            barangay_id_used: aggregationScope.barangayIdUsed,
            match_count_used: null,
            limit_used: aggregationLimit,
            top_candidate_ids: rows.slice(0, 3).map((row) => row.line_item_id),
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        if (aggregationIntent.intent === "totals_by_sector") {
          const { data, error } = await client.rpc("get_totals_by_sector", {
            p_fiscal_year: fiscalYearForAggregation,
            p_barangay_id: aggregationScope.barangayIdUsed,
          });
          if (error) {
            throw new Error(error.message);
          }

          const rows = toTotalsBySectorRows(data);
          const contentLines =
            rows.length === 0
              ? ["No published AIP line items matched the selected filters."]
              : rows.map((row, index) => {
                  const label = [row.sector_code, row.sector_name].filter(Boolean).join(" - ") || "Unspecified sector";
                  return `${index + 1}. ${label}: ${formatPhpAmount(toNumberOrNull(row.sector_total))} (${parseInteger(row.count_items) ?? 0} items)`;
                });

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: `Budget totals by sector (${scopeLabel}; ${fiscalLabel}):\n${contentLines.join("\n")}`,
            citations: [
              makeAggregateCitation("Aggregated from published AIP line items.", {
                aggregated: true,
                source: "aip_line_items",
                aggregate_type: "totals_by_sector",
                fiscal_year_filter: fiscalYearForAggregation,
                barangay_id_filter: aggregationScope.barangayIdUsed,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: aggregationScope.scopeReason,
            barangay_id_used: aggregationScope.barangayIdUsed,
            match_count_used: null,
            limit_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        if (aggregationIntent.intent === "totals_by_fund_source") {
          const { data, error } = await client.rpc("get_totals_by_fund_source", {
            p_fiscal_year: fiscalYearForAggregation,
            p_barangay_id: aggregationScope.barangayIdUsed,
          });
          if (error) {
            throw new Error(error.message);
          }

          const rows = toTotalsByFundSourceRows(data);
          const listOnly = isFundSourceListQuery(content);
          const contentLines =
            rows.length === 0
              ? ["No published AIP line items matched the selected filters."]
              : listOnly
                ? Array.from(
                    new Set(
                      rows
                        .map((row) => (row.fund_source ?? "Unspecified").trim() || "Unspecified")
                        .sort((a, b) => a.localeCompare(b))
                    )
                  ).map((label, index) => `${index + 1}. ${label}`)
                : rows.map((row, index) => {
                    const label = (row.fund_source ?? "Unspecified").trim() || "Unspecified";
                    return `${index + 1}. ${label}: ${formatPhpAmount(toNumberOrNull(row.fund_total))} (${parseInteger(row.count_items) ?? 0} items)`;
                  });

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: listOnly
              ? `Fund sources (${scopeLabel}; ${fiscalLabel}):\n${contentLines.join("\n")}`
              : `Budget totals by fund source (${scopeLabel}; ${fiscalLabel}):\n${contentLines.join("\n")}`,
            citations: [
              makeAggregateCitation("Aggregated from published AIP line items.", {
                aggregated: true,
                source: "aip_line_items",
                aggregate_type: "totals_by_fund_source",
                fiscal_year_filter: fiscalYearForAggregation,
                barangay_id_filter: aggregationScope.barangayIdUsed,
                output_mode: listOnly ? "fund_source_list" : "totals_with_counts",
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "ok",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: aggregationLogIntent,
            route: "aggregate_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: aggregationScope.scopeReason,
            barangay_id_used: aggregationScope.barangayIdUsed,
            match_count_used: null,
            limit_used: null,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: true,
            vector_called: false,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        const yearA = aggregationIntent.yearA ?? null;
        const yearB = aggregationIntent.yearB ?? null;
        if (yearA === null || yearB === null) {
          throw new Error("Aggregation compare years intent requires two years.");
        }

        const scopeMode: CompareScopeMode =
          aggregationScope.barangayIdUsed === null ? "global_barangays" : "single_barangay";
        const yearAResult = await fetchTotalInvestmentProgramTotalsByYear({
          year: yearA,
          scopeMode,
          barangayId: aggregationScope.barangayIdUsed,
          barangayName: aggregationScope.barangayName,
        });
        const yearBResult = await fetchTotalInvestmentProgramTotalsByYear({
          year: yearB,
          scopeMode,
          barangayId: aggregationScope.barangayIdUsed,
          barangayName: aggregationScope.barangayName,
        });
        const compareVerbose = buildCompareYearsVerboseAnswer({
          yearA,
          yearB,
          scopeLabel,
          sourceNote:
            scopeMode === "single_barangay"
              ? `Using sum of barangay totals (aip_totals) for ${scopeLabel}.`
              : "Using sum of barangay totals (aip_totals) across all barangays.",
          yearAResult,
          yearBResult,
        });
        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content: compareVerbose.content,
          citations: [
            makeAggregateCitation("Aggregated from aip_totals (Total Investment Program).", {
              aggregated: true,
              aggregate_type: "compare_years_verbose",
              aggregation_source: "aip_totals_total_investment_program",
              scope_mode: scopeMode,
              year_a: yearA,
              year_b: yearB,
              barangay_id_filter: aggregationScope.barangayIdUsed,
              coverage_year_a_count: yearAResult.coveredCount,
              coverage_year_b_count: yearBResult.coveredCount,
              missing_year_a_count: yearAResult.missingIds.length,
              missing_year_b_count: yearBResult.missingIds.length,
              contributing_aip_ids_year_a_sample: formatIdSample(yearAResult.contributingAipIds),
              contributing_aip_ids_year_a_count: yearAResult.contributingAipIds.length,
              contributing_aip_ids_year_b_sample: formatIdSample(yearBResult.contributingAipIds),
              contributing_aip_ids_year_b_count: yearBResult.contributingAipIds.length,
            }),
          ],
          retrievalMeta: {
            refused: false,
            reason: "ok",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: aggregationLogIntent,
          route: "aggregate_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: aggregationScope.scopeReason,
          barangay_id_used: aggregationScope.barangayIdUsed,
          match_count_used: null,
          limit_used: null,
          top_candidate_ids: [],
          top_candidate_distances: [],
          answered: true,
          vector_called: false,
          aggregation_source: "aip_totals_total_investment_program",
          coverage_year_a_count: yearAResult.coveredCount,
          coverage_year_b_count: yearBResult.coveredCount,
          missing_year_a_count: yearAResult.missingIds.length,
          missing_year_b_count: yearBResult.missingIds.length,
          coverage_barangays: compareVerbose.coverageBarangays,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Aggregation query failed.";
        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content:
            "I couldn't complete the aggregate SQL query due to a temporary system issue. Please try again shortly.",
          citations: [makeSystemCitation("Aggregate SQL query failed.", { error: message })],
          retrievalMeta: {
            refused: true,
            reason: "pipeline_error",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: aggregationLogIntent,
          route: "aggregate_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: aggregationScope.scopeReason,
          barangay_id_used: aggregationScope.barangayIdUsed,
          match_count_used: null,
          limit_used: aggregationLimit,
          top_candidate_ids: [],
          top_candidate_distances: [],
          answered: false,
          vector_called: false,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      }
    }

    if (parsedLineItemQuestion.isUnanswerableFieldQuestion && !parsedLineItemQuestion.isFactQuestion) {
      const refusal = buildRefusalMessage({
        intent: "unanswerable_field",
        queryText: content,
        scopeLabel:
          lineItemScope.barangayIdUsed !== null
            ? normalizeBarangayLabel(scopeBarangayName ?? "your barangay")
            : "All barangays",
        fiscalYear: requestedFiscalYear,
        docLimitField: detectDocLimitFieldFromQuery(parsedLineItemQuestion.normalizedQuestion),
      });
      const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
        sessionId: session.id,
        content: refusal.message,
        citations: [
          makeSystemCitation("Requested field is outside published AIP structured line-item coverage.", {
            reason: refusal.reason,
          }),
        ],
        retrievalMeta: {
          refused: refusal.status === "refusal",
          reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
          status: refusal.status,
          refusalReason: refusal.reason,
          suggestions: refusal.suggestions,
          scopeResolution,
          latencyMs: Date.now() - startedAt,
        },
      });
      logNonTotalsRouting({
        request_id: requestId,
        intent: "unanswerable_field",
        route: "row_sql",
        fiscal_year_parsed: requestedFiscalYear,
        scope_reason: lineItemScope.scopeReason,
        barangay_id_used: lineItemScope.barangayIdUsed,
        match_count_used: null,
        top_candidate_ids: [],
        top_candidate_distances: [],
        answered: refusal.status !== "refusal",
        vector_called: false,
        status: refusal.status,
        refusal_reason: refusal.reason,
      });

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    if (parsedLineItemQuestion.isFactQuestion) {
      let vectorRpcCalled = false;
      try {
        const barangayFilterId = lineItemScope.barangayIdUsed;
        const matchCount = barangayFilterId === null && requestedFiscalYear === null ? 40 : 20;
        const refCode = extractAipRefCode(content);

        if (refCode) {
          let refQuery = client
            .from("aip_line_items")
            .select(
              "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,implementing_agency,start_date,end_date,fund_source,ps,mooe,co,fe,total,expected_output,page_no,row_no,table_no"
            )
            .ilike("aip_ref_code", refCode);

          if (requestedFiscalYear !== null) {
            refQuery = refQuery.eq("fiscal_year", requestedFiscalYear);
          }
          if (barangayFilterId !== null) {
            refQuery = refQuery.eq("barangay_id", barangayFilterId);
          }

          const { data: refData, error: refError } = await refQuery.limit(30);
          if (refError) {
            throw new Error(refError.message);
          }

          let refRows = toLineItemRows(refData);
          if (refRows.length > 0) {
            const admin = supabaseAdmin();
            const candidateAipIds = refRows
              .map((row) => row.aip_id)
              .filter((aipId, index, all) => Boolean(aipId) && all.indexOf(aipId) === index);

            if (candidateAipIds.length > 0) {
              let publishedAipQuery = admin
                .from("aips")
                .select("id")
                .in("id", candidateAipIds)
                .eq("status", "published");

              if (requestedFiscalYear !== null) {
                publishedAipQuery = publishedAipQuery.eq("fiscal_year", requestedFiscalYear);
              }

              if (barangayFilterId !== null) {
                publishedAipQuery = publishedAipQuery.eq("barangay_id", barangayFilterId);
              }

              const { data: publishedAips, error: publishedError } = await publishedAipQuery;
              if (publishedError) {
                throw new Error(publishedError.message);
              }

              const publishedAipIds = new Set(
                (publishedAips ?? [])
                  .map((row) => (row as { id?: string }).id ?? null)
                  .filter((id): id is string => Boolean(id))
              );
              refRows = refRows.filter((row) => publishedAipIds.has(row.aip_id));
            } else {
              refRows = [];
            }
          }

          if (refRows.length === 0) {
            const scopeLabel =
              barangayFilterId !== null
                ? normalizeBarangayLabel(scopeBarangayName ?? "your barangay")
                : "All barangays";
            const refusal = buildRefusalMessage({
              intent: "line_item_fact",
              queryText: content,
              fiscalYear: requestedFiscalYear,
              scopeLabel,
              explicitScopeRequested: scopeResolution.requestedScopes.length > 0,
              scopeResolved: true,
              hadVectorSearch: false,
              foundCandidates: 0,
            });

            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: refusal.message,
              citations: [
                makeSystemCitation("No published line item matched the requested Ref code.", {
                  reason: refusal.reason,
                  ref_code: refCode,
                  fiscal_year: requestedFiscalYear,
                  barangay_id: barangayFilterId,
                }),
              ],
              retrievalMeta: {
                refused: refusal.status === "refusal",
                reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
                status: refusal.status,
                refusalReason: refusal.reason,
                suggestions: refusal.suggestions,
                scopeResolution,
                latencyMs: Date.now() - startedAt,
              },
            });
            logNonTotalsRouting({
              request_id: requestId,
              intent: "line_item_fact",
              route: "row_sql",
              fiscal_year_parsed: requestedFiscalYear,
              scope_reason: lineItemScope.scopeReason,
              barangay_id_used: lineItemScope.barangayIdUsed,
              match_count_used: null,
              top_candidate_ids: [],
              top_candidate_distances: [],
              answered: refusal.status !== "refusal",
              vector_called: false,
              status: refusal.status,
              refusal_reason: refusal.reason,
            });

            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          if (refRows.length === 1) {
            const selectedRow = refRows[0];
            const rowBarangayNameMap = await fetchBarangayNameMap(
              selectedRow.barangay_id ? [selectedRow.barangay_id] : []
            );
            const resolvedRowBarangayName =
              selectedRow.barangay_id && rowBarangayNameMap.has(selectedRow.barangay_id)
                ? rowBarangayNameMap.get(selectedRow.barangay_id) ?? scopeBarangayName
                : scopeBarangayName;

            const scopeDisclosure = buildLineItemScopeDisclosure({
              scopeReason: lineItemScope.scopeReason,
              barangayName: resolvedRowBarangayName,
            });
            const assistantContent = buildLineItemAnswer({
              row: selectedRow,
              fields: parsedLineItemQuestion.factFields,
              scopeDisclosure,
            });

            const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
              sessionId: session.id,
              content: assistantContent,
              citations: [
                {
                  sourceId: "L1",
                  aipId: selectedRow.aip_id,
                  fiscalYear: selectedRow.fiscal_year,
                  scopeType: selectedRow.barangay_id ? "barangay" : "unknown",
                  scopeId: selectedRow.barangay_id,
                  scopeName: buildLineItemCitationScopeName({
                    title: selectedRow.program_project_title,
                    fiscalYear: selectedRow.fiscal_year,
                    barangayName: resolvedRowBarangayName,
                    scopeReason: lineItemScope.scopeReason,
                  }),
                  snippet: buildLineItemCitationSnippet(selectedRow),
                  insufficient: false,
                  metadata: {
                    type: "aip_line_item",
                    line_item_id: selectedRow.id,
                    aip_ref_code: selectedRow.aip_ref_code,
                    page_no: selectedRow.page_no,
                    row_no: selectedRow.row_no,
                    table_no: selectedRow.table_no,
                    aip_id: selectedRow.aip_id,
                    fiscal_year: selectedRow.fiscal_year,
                    barangay_id: selectedRow.barangay_id,
                    total: formatPhpAmount(selectedRow.total),
                    scope_reason: lineItemScope.scopeReason,
                    matched_by: "exact_ref_code",
                  },
                },
              ],
              retrievalMeta: {
                refused: false,
                reason: "ok",
                scopeResolution,
                latencyMs: Date.now() - startedAt,
                contextCount: 1,
              },
            });
            logNonTotalsRouting({
              request_id: requestId,
              intent: "line_item_fact",
              route: "row_sql",
              fiscal_year_parsed: requestedFiscalYear,
              scope_reason: lineItemScope.scopeReason,
              barangay_id_used: lineItemScope.barangayIdUsed,
              match_count_used: null,
              top_candidate_ids: [selectedRow.id],
              top_candidate_distances: [],
              answered: true,
              vector_called: false,
            });

            return NextResponse.json(
              chatResponsePayload({
                sessionId: session.id,
                userMessage,
                assistantMessage,
              }),
              { status: 200 }
            );
          }

          const limitedRows = refRows.slice(0, 3);
          const rowBarangayNameMap = await fetchBarangayNameMap(
            limitedRows
              .map((row) => row.barangay_id)
              .filter((barangayId): barangayId is string => Boolean(barangayId))
          );
          const clarificationPayload: ChatClarificationPayload = {
            id: randomUUID(),
            kind: "line_item_disambiguation",
            prompt: "I found multiple published line items with that Ref code. Which one did you mean?",
            options: limitedRows.map((row, index) => ({
              optionIndex: index + 1,
              lineItemId: row.id,
              title: row.program_project_title,
              refCode: row.aip_ref_code,
              fiscalYear: row.fiscal_year,
              barangayName:
                row.barangay_id && rowBarangayNameMap.has(row.barangay_id)
                  ? normalizeBarangayLabel(rowBarangayNameMap.get(row.barangay_id) ?? "")
                  : scopeBarangayName,
              total: toClarificationTotal(row.total),
            })),
          };

          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: buildClarificationPromptContent(clarificationPayload),
            citations: [
              makeSystemCitation("Multiple published line-item rows share the requested Ref code.", {
                reason: "line_item_ref_ambiguous",
                ref_code: refCode,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "clarification_needed",
              status: "clarification",
              kind: "clarification",
              clarification: {
                ...clarificationPayload,
                context: {
                  factFields: parsedLineItemQuestion.factFields,
                  scopeReason: lineItemScope.scopeReason,
                  barangayName: scopeBarangayName,
                },
              },
              scopeResolution,
              latencyMs: Date.now() - startedAt,
              contextCount: refRows.length,
            },
          });
          logClarificationLifecycle({
            request_id: requestId,
            event: "clarification_created",
            session_id: session.id,
            clarification_id: clarificationPayload.id,
            option_count: clarificationPayload.options.length,
            top_candidate_ids: limitedRows.map((row) => row.id),
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "clarification_needed",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: null,
            top_candidate_ids: limitedRows.map((row) => row.id),
            top_candidate_distances: [],
            answered: false,
            vector_called: false,
          });

          return NextResponse.json(chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }), { status: 200 });
        }

        const embeddedQuery = await requestPipelineQueryEmbedding({ text: content });

        vectorRpcCalled = true;
        const { data: rpcData, error: rpcError } = await client.rpc("match_aip_line_items", {
          p_query_embedding: toPgVectorLiteral(embeddedQuery.embedding),
          p_match_count: matchCount,
          p_fiscal_year: requestedFiscalYear,
          p_barangay_id: barangayFilterId,
        });
        if (rpcError) {
          throw new Error(rpcError.message);
        }

        const ranked = rerankLineItemCandidates({
          question: parsedLineItemQuestion,
          candidates: toLineItemMatchCandidates(rpcData).slice(0, matchCount),
          requestedFiscalYear,
        }).slice(0, 10);

        if (ranked.length === 0) {
          const refusal = buildRefusalMessage({
            intent: "line_item_fact",
            queryText: content,
            fiscalYear: requestedFiscalYear,
            scopeLabel:
              lineItemScope.barangayIdUsed !== null
                ? normalizeBarangayLabel(scopeBarangayName ?? "your barangay")
                : "All barangays",
            hadVectorSearch: true,
            matchCount,
            foundCandidates: 0,
            explicitScopeRequested: scopeResolution.requestedScopes.length > 0,
            scopeResolved: true,
          });
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content: refusal.message,
            citations: [
              makeSystemCitation("No line-item matches found in row-level index.", {
                reason: refusal.reason,
                fiscal_year: requestedFiscalYear,
                barangay_id: barangayFilterId,
              }),
            ],
            retrievalMeta: {
              refused: refusal.status === "refusal",
              reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
              status: refusal.status,
              refusalReason: refusal.reason,
              suggestions: refusal.suggestions,
              scopeResolution,
              latencyMs: Date.now() - startedAt,
              topK: matchCount,
              contextCount: 0,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "line_item_fact",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: matchCount,
            top_candidate_ids: [],
            top_candidate_distances: [],
            answered: refusal.status !== "refusal",
            vector_called: vectorRpcCalled,
            status: refusal.status,
            refusal_reason: refusal.reason,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        const candidateIds = ranked
          .slice(0, 3)
          .map((candidate) => candidate.line_item_id)
          .filter((id, index, all) => all.indexOf(id) === index);
        const topCandidateIds = ranked.slice(0, 3).map((candidate) => candidate.line_item_id);
        const topCandidateDistances = ranked
          .slice(0, 3)
          .map((candidate) => candidate.distance)
          .filter((distance): distance is number => typeof distance === "number");

        const { data: rowData, error: rowError } = await client
          .from("aip_line_items")
          .select(
            "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,implementing_agency,start_date,end_date,fund_source,ps,mooe,co,fe,total,expected_output,page_no,row_no,table_no"
          )
          .in("id", candidateIds);
        if (rowError) {
          throw new Error(rowError.message);
        }

        const rowsById = new Map<string, LineItemRowRecord>(
          toLineItemRows(rowData).map((row) => [row.id, row])
        );

        if (
          shouldAskLineItemClarification({
            question: parsedLineItemQuestion,
            candidates: ranked,
          })
        ) {
          const structuredOptions = buildStructuredClarificationOptions({
            candidates: ranked,
            rowsById,
            defaultBarangayName: scopeBarangayName,
          });
          const clarificationPayload: ChatClarificationPayload = {
            id: randomUUID(),
            kind: "line_item_disambiguation",
            prompt: "Which one did you mean?",
            options: structuredOptions,
          };
          const optionsAsText = buildClarificationOptions({
            candidates: ranked,
            rowsById,
            defaultBarangayName: scopeBarangayName,
            scopeReason: lineItemScope.scopeReason,
          });
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content:
              structuredOptions.length > 0
                ? buildClarificationPromptContent(clarificationPayload)
                : `I found multiple possible line items:\n${optionsAsText
                    .map((option, index) => `${index + 1}. ${option}`)
                    .join("\n")}\nWhich one did you mean?`,
            citations: [
              makeSystemCitation("Multiple plausible line-item candidates require clarification.", {
                reason: "line_item_ambiguous",
                options: structuredOptions.length > 0 ? structuredOptions : optionsAsText,
              }),
            ],
            retrievalMeta: {
              refused: false,
              reason: "clarification_needed",
              status: "clarification",
              kind: "clarification",
              clarification: {
                ...clarificationPayload,
                context: {
                  factFields: parsedLineItemQuestion.factFields,
                  scopeReason: lineItemScope.scopeReason,
                  barangayName: scopeBarangayName,
                },
              },
              scopeResolution,
              latencyMs: Date.now() - startedAt,
              topK: matchCount,
              contextCount: ranked.length,
            },
          });
          logClarificationLifecycle({
            request_id: requestId,
            event: "clarification_created",
            session_id: session.id,
            clarification_id: clarificationPayload.id,
            option_count: clarificationPayload.options.length,
            top_candidate_ids: topCandidateIds,
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "clarification_needed",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: matchCount,
            top_candidate_ids: topCandidateIds,
            top_candidate_distances: topCandidateDistances,
            answered: false,
            vector_called: vectorRpcCalled,
          });

          return NextResponse.json(chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }), { status: 200 });
        }

        const selectedRows = candidateIds
          .map((id) => rowsById.get(id))
          .filter((row): row is LineItemRowRecord => Boolean(row));

        if (selectedRows.length === 0) {
          const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
            sessionId: session.id,
            content:
              "I found relevant line-item references, but I couldn't load the structured row details. Please try again.",
            citations: [makeSystemCitation("Row-level retrieval returned empty result after candidate match.")],
            retrievalMeta: {
              refused: true,
              reason: "insufficient_evidence",
              scopeResolution,
              latencyMs: Date.now() - startedAt,
              topK: matchCount,
              contextCount: ranked.length,
            },
          });
          logNonTotalsRouting({
            request_id: requestId,
            intent: "line_item_fact",
            route: "row_sql",
            fiscal_year_parsed: requestedFiscalYear,
            scope_reason: lineItemScope.scopeReason,
            barangay_id_used: lineItemScope.barangayIdUsed,
            match_count_used: matchCount,
            top_candidate_ids: topCandidateIds,
            top_candidate_distances: topCandidateDistances,
            answered: false,
            vector_called: vectorRpcCalled,
          });

          return NextResponse.json(
            chatResponsePayload({
              sessionId: session.id,
              userMessage,
              assistantMessage,
            }),
            { status: 200 }
          );
        }

        const primaryRow = selectedRows[0];
        const scopeDisclosure = buildLineItemScopeDisclosure({
          scopeReason: lineItemScope.scopeReason,
          barangayName: scopeBarangayName,
        });
        const assistantContent = buildLineItemAnswer({
          row: primaryRow,
          fields: parsedLineItemQuestion.factFields,
          scopeDisclosure,
        });

        const citations: ChatCitation[] = selectedRows.map((row, index) => {
          const rankedCandidate = ranked.find((candidate) => candidate.line_item_id === row.id) ?? null;
          return {
            sourceId: `L${index + 1}`,
            aipId: row.aip_id,
            fiscalYear: row.fiscal_year,
            scopeType: row.barangay_id ? "barangay" : "unknown",
            scopeId: row.barangay_id,
            scopeName: buildLineItemCitationScopeName({
              title: row.program_project_title,
              fiscalYear: row.fiscal_year,
              barangayName: scopeBarangayName,
              scopeReason: lineItemScope.scopeReason,
            }),
            distance: rankedCandidate?.distance ?? null,
            matchScore: rankedCandidate?.score ?? null,
            snippet: buildLineItemCitationSnippet(row),
            insufficient: false,
            metadata: {
              type: "aip_line_item",
              line_item_id: row.id,
              aip_ref_code: row.aip_ref_code,
              page_no: row.page_no,
              row_no: row.row_no,
              table_no: row.table_no,
              aip_id: row.aip_id,
              fiscal_year: row.fiscal_year,
              barangay_id: row.barangay_id,
              total: formatPhpAmount(row.total),
              distance: rankedCandidate?.distance ?? null,
              score: rankedCandidate?.score ?? null,
              scope_reason: lineItemScope.scopeReason,
            },
          };
        });

        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content: assistantContent,
          citations,
          retrievalMeta: {
            refused: false,
            reason: "ok",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
            topK: matchCount,
            contextCount: ranked.length,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: "line_item_fact",
          route: "row_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: lineItemScope.scopeReason,
          barangay_id_used: lineItemScope.barangayIdUsed,
          match_count_used: matchCount,
          top_candidate_ids: topCandidateIds,
          top_candidate_distances: topCandidateDistances,
          answered: true,
          vector_called: vectorRpcCalled,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Structured line-item retrieval request failed.";
        const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
          sessionId: session.id,
          content:
            "I couldn't complete the structured line-item retrieval due to a temporary system issue. Please try again shortly.",
          citations: [makeSystemCitation("Structured line-item retrieval failed.", { error: message })],
          retrievalMeta: {
            refused: true,
            reason: "pipeline_error",
            scopeResolution,
            latencyMs: Date.now() - startedAt,
          },
        });
        logNonTotalsRouting({
          request_id: requestId,
          intent: "line_item_fact",
          route: "row_sql",
          fiscal_year_parsed: requestedFiscalYear,
          scope_reason: lineItemScope.scopeReason,
          barangay_id_used: lineItemScope.barangayIdUsed,
          match_count_used: null,
          top_candidate_ids: [],
          top_candidate_distances: [],
          answered: false,
          vector_called: vectorRpcCalled,
        });

        return NextResponse.json(
          chatResponsePayload({
            sessionId: session.id,
            userMessage,
            assistantMessage,
          }),
          { status: 200 }
        );
      }
    }

    if (isUnsupportedRequestQuery(content)) {
      const refusal = buildRefusalMessage({
        intent: "pipeline_fallback",
        queryText: content,
      });
      const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
        sessionId: session.id,
        content: refusal.message,
        citations: [
          makeSystemCitation("Request is outside supported published AIP data answers.", {
            reason: refusal.reason,
          }),
        ],
        retrievalMeta: {
          refused: refusal.status === "refusal",
          reason: mapRefusalReasonToMetaReason(refusal.status, refusal.reason),
          status: refusal.status,
          refusalReason: refusal.reason,
          suggestions: refusal.suggestions,
          scopeResolution,
          latencyMs: Date.now() - startedAt,
        },
      });
      logNonTotalsRouting({
        request_id: requestId,
        intent: "pipeline_fallback",
        route: "pipeline_fallback",
        fiscal_year_parsed: requestedFiscalYear,
        scope_reason: lineItemScope.scopeReason,
        barangay_id_used: lineItemScope.barangayIdUsed,
        match_count_used: null,
        top_candidate_ids: [],
        top_candidate_distances: [],
        answered: false,
        vector_called: false,
        status: refusal.status,
        refusal_reason: refusal.reason,
      });

      return NextResponse.json(
        chatResponsePayload({
          sessionId: session.id,
          userMessage,
          assistantMessage,
        }),
        { status: 200 }
      );
    }

    let assistantContent = "";
    let assistantCitations: ChatCitation[] = [];
    let assistantMeta: ChatRetrievalMeta = {
      refused: true,
      reason: "unknown",
      scopeResolution,
    };

    try {
      const pipeline = await requestPipelineChatAnswer({
        question: content,
        retrievalScope: scope.retrievalScope,
        topK: 8,
        minSimilarity: 0.3,
      });

      assistantContent = pipeline.answer.trim();
      assistantCitations = normalizePipelineCitations(pipeline.citations);
      assistantMeta = {
        refused: Boolean(pipeline.refused),
        reason: pipeline.retrieval_meta?.reason ?? "unknown",
        topK: pipeline.retrieval_meta?.top_k,
        minSimilarity: pipeline.retrieval_meta?.min_similarity,
        contextCount: pipeline.retrieval_meta?.context_count,
        verifierPassed: pipeline.retrieval_meta?.verifier_passed,
        latencyMs: Date.now() - startedAt,
        scopeResolution,
        intentClassification: frontendIntentClassification ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pipeline chat request failed.";
      assistantContent =
        "I couldn't complete the response due to a temporary system issue. Please try again in a few moments.";
      assistantCitations = [makeSystemCitation("Pipeline request failed.", { error: message })];
      assistantMeta = {
        refused: true,
        reason: "pipeline_error",
        scopeResolution,
        latencyMs: Date.now() - startedAt,
        intentClassification: frontendIntentClassification ?? undefined,
      };
    }

    if (!assistantContent) {
      assistantContent = "I can't provide a grounded answer right now.";
    }

    if (assistantCitations.length === 0) {
      assistantCitations = [makeSystemCitation("No retrieval citations were produced for this response.")];
      assistantMeta = {
        ...assistantMeta,
        refused: true,
        reason: assistantMeta.reason === "ok" ? "validation_failed" : assistantMeta.reason,
      };
    }

    const assistantMessage = await appendAssistantMessage({
        actor: privilegedActor,
      sessionId: session.id,
      content: assistantContent,
      citations: assistantCitations,
      retrievalMeta: assistantMeta,
    });
    logNonTotalsRouting({
      request_id: requestId,
      intent: "pipeline_fallback",
      route: "pipeline_fallback",
      fiscal_year_parsed: requestedFiscalYear,
      scope_reason: lineItemScope.scopeReason,
      barangay_id_used: lineItemScope.barangayIdUsed,
      match_count_used: null,
      top_candidate_ids: [],
      top_candidate_distances: [],
      answered: !assistantMeta.refused,
      vector_called: false,
    });

    return NextResponse.json(
      chatResponsePayload({
        sessionId: session.id,
        userMessage,
        assistantMessage,
      }),
      { status: 200 }
    );
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected chatbot error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

