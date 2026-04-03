import { NextResponse } from "next/server";
import type {
  PipelineChatCitation,
  RetrievalFiltersPayload,
  RetrievalScopePayload,
  ScopeFallbackPayload,
} from "@/lib/chat/types";
import { requestPipelineChatAnswer } from "@/lib/chat/pipeline-client";
import { getLguChatAuthFailure } from "@/lib/chat/lgu-route-auth";
import type { Json } from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getChatRepo } from "@/lib/repos/chat/repo.server";
import type { ChatCitation, ChatMessage, ChatRetrievalMeta, ChatScopeResolution } from "@/lib/repos/chat/types";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { assertActorPresent, assertPrivilegedWriteAccess, isInvariantError } from "@/lib/security/invariants";
import { getTypedAppSetting, isUserBlocked } from "@/lib/settings/app-settings";
import {
  consumeChatQuota,
  insertAssistantChatMessage,
  type PrivilegedActorContext,
  toPrivilegedActorContext,
} from "@/lib/supabase/privileged-ops";

const MAX_MESSAGE_LENGTH = 12000;
const RETRIEVAL_FILTER_YEAR_PATTERN = /\b(20\d{2})\b/g;
const RETRIEVAL_FILTER_MULTI_YEAR_CUE_PATTERN =
  /\b(compare|comparison|trend|across|between|vs|versus|from\s+20\d{2}\s+to\s+20\d{2})\b/i;

type PostBody = {
  sessionId?: string;
  content?: string;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "assistant";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
};

type ScopeType = "barangay" | "city";

function resolveExpectedRouteKind(request: Request): "barangay" | "city" {
  const pathname = new URL(request.url).pathname.toLowerCase();
  return pathname.includes("/api/city/chat/") ? "city" : "barangay";
}

function normalizeUserMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_MESSAGE_LENGTH);
}

function deriveSingleFiscalYearFilter(message: string): number | undefined {
  const parsedYears = Array.from(message.matchAll(RETRIEVAL_FILTER_YEAR_PATTERN))
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((year) => Number.isInteger(year));
  const uniqueYears = Array.from(new Set(parsedYears));
  if (uniqueYears.length !== 1) {
    return undefined;
  }
  if (RETRIEVAL_FILTER_MULTI_YEAR_CUE_PATTERN.test(message)) {
    return undefined;
  }
  return uniqueYears[0];
}

function detectDocumentTypeFromText(message: string): string | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes("baip")) return "BAIP";
  if (normalized.includes("aip")) return "AIP";
  return undefined;
}

function buildPipelineRetrievalFilters(input: {
  message: string;
  retrievalScope: RetrievalScopePayload;
}): RetrievalFiltersPayload {
  const filters: RetrievalFiltersPayload = {
    publication_status: "published",
  };

  const fiscalYear = deriveSingleFiscalYearFilter(input.message);
  if (typeof fiscalYear === "number") {
    filters.fiscal_year = fiscalYear;
  }

  const docType = detectDocumentTypeFromText(input.message);
  if (docType) {
    filters.document_type = docType;
  }

  if (input.retrievalScope.targets.length === 1) {
    const target = input.retrievalScope.targets[0];
    filters.scope_type = target.scope_type;
    filters.scope_name = target.scope_name;
  }

  return filters;
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

function normalizePipelineMeta(input: {
  pipelineMeta: Record<string, unknown> | null | undefined;
  refused: boolean;
  scopeResolution: ChatScopeResolution;
}): ChatRetrievalMeta {
  const raw = (input.pipelineMeta ?? {}) as Record<string, unknown>;

  const reason =
    typeof raw.reason === "string"
      ? (raw.reason as ChatRetrievalMeta["reason"])
      : input.refused
        ? "insufficient_evidence"
        : "ok";

  const statusFromRaw = typeof raw.status === "string" ? raw.status : null;
  const status: ChatRetrievalMeta["status"] =
    statusFromRaw === "answer" || statusFromRaw === "clarification" || statusFromRaw === "refusal"
      ? statusFromRaw
      : reason === "clarification_needed"
        ? "clarification"
        : input.refused
          ? "refusal"
          : "answer";

  const routeFamilyRaw = typeof raw.route_family === "string" ? raw.route_family : null;
  const routeFamily: ChatRetrievalMeta["routeFamily"] =
    routeFamilyRaw === "sql_totals" ||
    routeFamilyRaw === "aggregate_sql" ||
    routeFamilyRaw === "row_sql" ||
    routeFamilyRaw === "metadata_sql" ||
    routeFamilyRaw === "pipeline_fallback" ||
    routeFamilyRaw === "mixed_plan" ||
    routeFamilyRaw === "conversational" ||
    routeFamilyRaw === "unknown"
      ? routeFamilyRaw
      : "pipeline_fallback";

  const merged: ChatRetrievalMeta & Record<string, unknown> = {
    ...raw,
    refused: input.refused,
    reason,
    status,
    scopeResolution: input.scopeResolution,
    routeFamily,
    topK: typeof raw.top_k === "number" ? raw.top_k : undefined,
    minSimilarity: typeof raw.min_similarity === "number" ? raw.min_similarity : undefined,
    contextCount: typeof raw.context_count === "number" ? raw.context_count : undefined,
  };
  return merged;
}

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

async function appendAssistantMessage(input: {
  actor: PrivilegedActorContext;
  sessionId: string;
  content: string;
  citations: ChatCitation[];
  retrievalMeta: ChatRetrievalMeta;
}): Promise<ChatMessage> {
  const row = (await insertAssistantChatMessage({
    actor: input.actor,
    sessionId: input.sessionId,
    content: input.content,
    citations: input.citations as unknown as Json,
    retrievalMeta: input.retrievalMeta as unknown as Json,
  })) as ChatMessageRow;
  return toChatMessage(row);
}

function chatResponsePayload(input: {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}) {
  return {
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    assistantMessage: input.assistantMessage,
  };
}

function buildClassifierScopeContext(): {
  retrievalScope: RetrievalScopePayload;
  scopeResolution: ChatScopeResolution;
} {
  return {
    retrievalScope: {
      mode: "global",
      targets: [],
    },
    scopeResolution: {
      mode: "global",
      requestedScopes: [],
      resolvedTargets: [],
      unresolvedScopes: [],
      ambiguousScopes: [],
    },
  };
}

function normalizeScopeType(value: unknown): ScopeType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "barangay" || normalized === "city") return normalized;
  return null;
}

function normalizeScopeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function extractScopeIdFromCitations(input: {
  citations: ChatCitation[] | null | undefined;
  scopeType: ScopeType;
  scopeName: string;
}): string | null {
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const desiredScopeName = input.scopeName.toLowerCase();
  let fallbackScopeId: string | null = null;

  for (const citation of citations) {
    const citationScopeType = normalizeScopeType((citation as Record<string, unknown>).scopeType ?? null);
    const citationScopeName = normalizeScopeName((citation as Record<string, unknown>).scopeName ?? null);
    const citationScopeId =
      normalizeScopeName((citation as Record<string, unknown>).scopeId ?? null) ??
      normalizeScopeName((citation as Record<string, unknown>).scope_id ?? null);
    if (!citationScopeType || !citationScopeId) {
      continue;
    }
    if (citationScopeType !== input.scopeType) {
      continue;
    }
    if (citationScopeName && citationScopeName.toLowerCase() === desiredScopeName) {
      return citationScopeId;
    }
    if (!fallbackScopeId) {
      fallbackScopeId = citationScopeId;
    }
  }

  return fallbackScopeId;
}

function extractScopeFallbackFromAssistantMessage(message: ChatMessage): ScopeFallbackPayload | null {
  if (message.role !== "assistant") {
    return null;
  }
  const meta = message.retrievalMeta;
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const rawMeta = meta as Record<string, unknown>;
  const status = typeof rawMeta.status === "string" ? rawMeta.status.trim().toLowerCase() : "";
  if (status !== "answer") {
    return null;
  }

  const rawEntities =
    rawMeta.entities && typeof rawMeta.entities === "object" && !Array.isArray(rawMeta.entities)
      ? (rawMeta.entities as Record<string, unknown>)
      : {};

  let scopeType =
    normalizeScopeType(rawEntities.scope_type ?? null) ??
    normalizeScopeType(rawEntities.scopeType ?? null) ??
    null;
  let scopeName =
    normalizeScopeName(rawEntities.scope_name ?? null) ??
    normalizeScopeName(rawEntities.scopeName ?? null) ??
    null;

  if (!scopeType || !scopeName) {
    const barangay = normalizeScopeName(rawEntities.barangay ?? null);
    const city = normalizeScopeName(rawEntities.city ?? null);
    if (barangay) {
      scopeType = "barangay";
      scopeName = barangay;
    } else if (city) {
      scopeType = "city";
      scopeName = city;
    }
  }

  if (!scopeType || !scopeName) {
    return null;
  }

  const scopeId = extractScopeIdFromCitations({
    citations: message.citations ?? [],
    scopeType,
    scopeName,
  });
  return {
    scope_type: scopeType,
    scope_name: scopeName,
    scope_id: scopeId,
  };
}

function deriveLastSuccessfulScope(messages: ChatMessage[]): ScopeFallbackPayload | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = extractScopeFallbackFromAssistantMessage(messages[index]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    const expectedRoute = resolveExpectedRouteKind(request);
    const authFailure = getLguChatAuthFailure(expectedRoute, actor, "messages");
    if (authFailure) {
      return NextResponse.json({ message: authFailure.message }, { status: authFailure.status });
    }
    assertActorPresent(actor, "Authentication required.");

    assertPrivilegedWriteAccess({
      actor,
      allowlistedRoles: ["barangay_official", "city_official"],
      scopeByRole: {
        barangay_official: "barangay",
        city_official: "city",
      },
      requireScopeId: true,
      message: "Forbidden. Missing required LGU scope.",
    });

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const content = normalizeUserMessage(body.content);
    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!content) {
      return NextResponse.json({ message: "Message content is required." }, { status: 400 });
    }

    if (await isUserBlocked(actor.userId)) {
      return NextResponse.json(
        { message: "Your account is currently blocked from chatbot usage." },
        { status: 403 }
      );
    }

    const privilegedActor = toPrivilegedActorContext(actor);
    if (!privilegedActor) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const rateLimitPolicy = await getTypedAppSetting("controls.chatbot_rate_limit");
    const quota = await consumeChatQuota({
      actor: privilegedActor,
      userId: actor.userId,
      maxRequests: rateLimitPolicy.maxRequests,
      timeWindow: rateLimitPolicy.timeWindow,
      route: "lgu_chat_messages",
    });
    if (!quota.allowed) {
      return NextResponse.json(
        { message: "Rate limit exceeded. Please try again shortly.", reason: quota.reason },
        { status: 429 }
      );
    }

    const repo = getChatRepo();
    const session = requestedSessionId
      ? await repo.getSession(requestedSessionId)
      : await repo.createSession(actor.userId, {});

    if (!session || session.userId !== actor.userId) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const priorMessages = await repo.listMessages(session.id);
    const scopeFallback = deriveLastSuccessfulScope(priorMessages);
    const userMessage = await repo.appendUserMessage(session.id, content);
    const scope = buildClassifierScopeContext();

    let assistantContent = "";
    let assistantCitations: ChatCitation[] = [];
    let assistantMeta: ChatRetrievalMeta;

    try {
      const pipeline = await requestPipelineChatAnswer({
        question: content,
        retrievalScope: scope.retrievalScope,
        retrievalMode: "qa",
        retrievalFilters: buildPipelineRetrievalFilters({
          message: content,
          retrievalScope: scope.retrievalScope,
        }),
        scopeFallback,
        topK: 4,
        minSimilarity: 0.3,
        timeoutMs: 60000,
      });

      assistantContent = pipeline.answer.trim();
      assistantCitations = normalizePipelineCitations(pipeline.citations);
      if (!assistantContent) {
        assistantContent = "I can't provide a grounded answer right now.";
      }
      if (assistantCitations.length === 0) {
        assistantCitations = [
          makeSystemCitation("No retrieval citations were produced for this response."),
        ];
      }

      assistantMeta = normalizePipelineMeta({
        pipelineMeta: (pipeline.retrieval_meta ?? null) as Record<string, unknown> | null,
        refused: Boolean(pipeline.refused),
        scopeResolution: scope.scopeResolution,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pipeline chat request failed.";
      console.error("[lgu-chat] pipeline chat request failed", {
        message,
        sessionId: session.id,
        userId: actor.userId,
      });
      assistantContent =
        "I couldn't complete the response due to a temporary system issue. Please try again in a few moments.";
      assistantCitations = [makeSystemCitation("Pipeline request failed.", { error: message })];
      assistantMeta = {
        refused: true,
        reason: "pipeline_error",
        status: "refusal",
        refusalDetail: message,
        scopeResolution: scope.scopeResolution,
        routeFamily: "pipeline_fallback",
      };
    }

    const assistantMessage = await appendAssistantMessage({
      actor: privilegedActor,
      sessionId: session.id,
      content: assistantContent,
      citations: assistantCitations,
      retrievalMeta: assistantMeta,
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
