import { NextResponse } from "next/server";
import type { Json, RoleType } from "@/lib/contracts/databasev2";
import { enrichChatCitationsWithProjectLinks } from "@/lib/chat/citation-enrichment.server";
import type {
  PipelineChatCitation,
  RetrievalFiltersPayload,
  RetrievalScopePayload,
  ScopeFallbackPayload,
} from "@/lib/chat/types";
import { requestPipelineChatAnswer } from "@/lib/chat/pipeline-client";
import { getChatRepo } from "@/lib/repos/chat/repo.server";
import type {
  ChatCitation,
  ChatMessage,
  ChatRetrievalMeta,
  ChatScopeResolution,
} from "@/lib/repos/chat/types";
import { getTypedAppSetting, isUserBlocked } from "@/lib/settings/app-settings";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { assertPrivilegedWriteAccess, isInvariantError } from "@/lib/security/invariants";
import {
  consumeChatQuota,
  insertAssistantChatMessage,
  toPrivilegedActorContextFromProfile,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { isCitizenProfileComplete } from "@/lib/auth/citizen-profile-completion";

const MESSAGE_CONTENT_LIMIT = 12000;
const RETRIEVAL_FILTER_YEAR_PATTERN = /\b(20\d{2})\b/g;
const RETRIEVAL_FILTER_MULTI_YEAR_CUE_PATTERN =
  /\b(compare|comparison|trend|across|between|vs|versus|from\s+20\d{2}\s+to\s+20\d{2})\b/i;

type ReplyRequestBody = {
  session_id?: string;
  user_message?: string;
  sessionId?: string;
  content?: string;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "assistant" | "system" | "user";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
};

type ProfileScopeRow = {
  id: string;
  role: RoleType;
  full_name: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ChatQuotaResult = {
  allowed: boolean;
  reason: string;
};

type ScopeType = "barangay" | "city";

function buildFollowUps(userMessage: string): string[] {
  const lowered = userMessage.toLowerCase();
  if (lowered.includes("project")) {
    return [
      "Show the top funded projects for this scope.",
      "Break down the budget by sector for the same fiscal year.",
      "Compare this project's funding against last fiscal year.",
    ];
  }

  if (lowered.includes("budget") || lowered.includes("allocation")) {
    return [
      "Show the total allocation by sector.",
      "List the biggest line items in this scope.",
      "Compare this fiscal year against the previous year.",
    ];
  }

  return [
    "Show me the total investment for this fiscal year.",
    "List key projects in this scope.",
    "What line items support this answer?",
  ];
}

function buildGlobalScopeContext(): {
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

function buildRetrievalFilters(input: {
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
      projectRefCode: citation.project_ref_code ?? null,
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
  suggestions: string[];
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
    suggestions: input.suggestions,
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
  actor: NonNullable<ReturnType<typeof toPrivilegedActorContextFromProfile>>;
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

function makeFallbackUserMessage(sessionId: string, content: string): ChatMessage {
  return {
    id: `user_echo_${Date.now()}`,
    sessionId,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    citations: null,
    retrievalMeta: null,
  };
}

function toResponseMessage(message: ChatMessage) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    citations: (message.citations as Json) ?? null,
    retrievalMeta: (message.retrievalMeta as Json) ?? null,
    createdAt: message.createdAt,
  };
}

async function consumeCitizenQuota(input: {
  actor: NonNullable<ReturnType<typeof toPrivilegedActorContextFromProfile>>;
  userId: string;
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
}): Promise<ChatQuotaResult> {
  const quota = await consumeChatQuota({
    actor: input.actor,
    userId: input.userId,
    maxRequests: input.maxRequests,
    timeWindow: input.timeWindow,
    route: "citizen_chat_reply",
  });
  return {
    allowed: quota.allowed,
    reason: quota.reason,
  };
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const body = (await request.json().catch(() => null)) as ReplyRequestBody | null;
    const sessionId =
      (typeof body?.sessionId === "string" ? body.sessionId : body?.session_id)?.trim() ?? "";
    const userMessage =
      (typeof body?.content === "string" ? body.content : body?.user_message)?.trim() ?? "";

    if (!sessionId || !userMessage) {
      return NextResponse.json(
        { error: "Missing required fields: session_id/user_message or sessionId/content" },
        { status: 400 }
      );
    }

    if (userMessage.length > MESSAGE_CONTENT_LIMIT) {
      return NextResponse.json(
        { error: `Message exceeds ${MESSAGE_CONTENT_LIMIT} characters.` },
        { status: 400 }
      );
    }

    const server = await supabaseServer();
    const { data: authData, error: authError } = await server.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;

    if (await isUserBlocked(userId)) {
      return NextResponse.json(
        { error: "Your account is currently blocked from chatbot usage." },
        { status: 403 }
      );
    }

    const { data: sessionData, error: sessionError } = await server
      .from("chat_sessions")
      .select("id,title,context")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 400 });
    }

    if (!sessionData) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: profileData, error: profileError } = await server
      .from("profiles")
      .select("id,role,full_name,barangay_id,city_id,municipality_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (!profileData) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const profile = profileData as ProfileScopeRow;
    if (profile.role !== "citizen") {
      return NextResponse.json({ error: "Only citizens can use this endpoint." }, { status: 403 });
    }
    if (!isCitizenProfileComplete(profile)) {
      return NextResponse.json(
        { error: "Complete your profile before using the AI Assistant." },
        { status: 403 }
      );
    }

    const privilegedActor = toPrivilegedActorContextFromProfile({
      userId,
      role: profile.role,
      barangayId: profile.barangay_id,
      cityId: profile.city_id,
      municipalityId: profile.municipality_id,
    });
    if (!privilegedActor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertPrivilegedWriteAccess({
      actor: privilegedActor,
      allowlistedRoles: ["citizen"],
      scopeByRole: { citizen: "barangay" },
      requireScopeId: true,
      message: "Unauthorized",
    });

    const rateLimitPolicy = await getTypedAppSetting("controls.chatbot_rate_limit");
    const quota = await consumeCitizenQuota({
      actor: privilegedActor,
      userId,
      maxRequests: rateLimitPolicy.maxRequests,
      timeWindow: rateLimitPolicy.timeWindow,
    });
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly.", reason: quota.reason },
        { status: 429 }
      );
    }

    const { retrievalScope, scopeResolution } = buildGlobalScopeContext();

    const repo = getChatRepo();
    const priorMessages = await repo.listMessages(sessionId);
    const scopeFallback = deriveLastSuccessfulScope(priorMessages);
    const latestUserMessage = [...priorMessages].reverse().find((message) => message.role === "user");

    const suggestions = buildFollowUps(userMessage);
    let assistantContent = "";
    let assistantCitations: ChatCitation[] = [];
    let assistantMeta: ChatRetrievalMeta;

    try {
      const pipeline = await requestPipelineChatAnswer({
        question: userMessage,
        retrievalScope,
        retrievalMode: "qa",
        retrievalFilters: buildRetrievalFilters({
          message: userMessage,
          retrievalScope,
        }),
        scopeFallback,
        topK: 4,
        minSimilarity: 0.3,
        timeoutMs: 60000,
      });

      assistantContent = pipeline.answer.trim();
      assistantCitations = normalizePipelineCitations(pipeline.citations);
      if (assistantCitations.length > 0) {
        try {
          assistantCitations = await enrichChatCitationsWithProjectLinks({
            client: server,
            citations: assistantCitations,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown enrichment error";
          console.warn("[citizen-chat] citation enrichment failed", {
            message,
            sessionId,
            userId,
          });
        }
      }
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
        scopeResolution,
        suggestions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pipeline chat request failed.";
      console.error("[citizen-chat] pipeline chat request failed", {
        message,
        sessionId,
        userId,
      });
      assistantContent =
        "I couldn't complete the response due to a temporary system issue. Please try again in a few moments.";
      assistantCitations = [makeSystemCitation("Pipeline request failed.", { error: message })];
      assistantMeta = {
        refused: true,
        reason: "pipeline_error",
        status: "refusal",
        refusalDetail: message,
        scopeResolution,
        routeFamily: "pipeline_fallback",
        suggestions,
      };
    }

    const assistantMessage = await appendAssistantMessage({
      actor: privilegedActor,
      sessionId,
      content: assistantContent,
      citations: assistantCitations,
      retrievalMeta: assistantMeta,
    });

    return NextResponse.json({
      sessionId,
      userMessage: toResponseMessage(latestUserMessage ?? makeFallbackUserMessage(sessionId, userMessage)),
      assistantMessage: toResponseMessage(assistantMessage),
    });
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
