import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import type {
  PipelineChatAnswer,
  PipelineIntentClassification,
  PipelineIntentType,
  RetrievalFiltersPayload,
  RetrievalModePayload,
  RetrievalScopePayload,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30000;
const PIPELINE_INTENT_TYPES: readonly PipelineIntentType[] = [
  "GREETING",
  "THANKS",
  "COMPLAINT",
  "CLARIFY",
  "TOTAL_AGGREGATION",
  "CATEGORY_AGGREGATION",
  "LINE_ITEM_LOOKUP",
  "PROJECT_DETAIL",
  "DOCUMENT_EXPLANATION",
  "OUT_OF_SCOPE",
  "SCOPE_NEEDS_CLARIFICATION",
  "UNKNOWN",
] as const;
const PIPELINE_AUDIENCE = "website-backend";

function requireEnv(
  name: "PIPELINE_API_BASE_URL" | "PIPELINE_HMAC_SECRET" | "PIPELINE_INTERNAL_TOKEN"
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function buildPipelineSignatureHeaders(rawBody: string): Record<string, string> {
  const aud = PIPELINE_AUDIENCE;
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const secret = requireEnv("PIPELINE_HMAC_SECRET");
  const canonical = `${aud}|${ts}|${nonce}|${rawBody}`;
  const sig = createHmac("sha256", secret).update(canonical).digest("hex");

  return {
    "x-pipeline-aud": aud,
    "x-pipeline-ts": ts,
    "x-pipeline-nonce": nonce,
    "x-pipeline-sig": sig,
  };
}

function parsePipelineResponse(payload: unknown): PipelineChatAnswer {
  if (!payload || typeof payload !== "object") {
    throw new Error("Pipeline response is invalid.");
  }

  const data = payload as Record<string, unknown>;
  const answer = typeof data.answer === "string" ? data.answer : "";
  const refused = typeof data.refused === "boolean" ? data.refused : false;
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const retrievalMeta =
    data.retrieval_meta && typeof data.retrieval_meta === "object"
      ? (data.retrieval_meta as PipelineChatAnswer["retrieval_meta"])
      : { reason: "unknown" as const };

  if (!answer.trim()) {
    throw new Error("Pipeline response missing answer.");
  }

  return {
    answer,
    refused,
    citations: citations as PipelineChatAnswer["citations"],
    retrieval_meta: retrievalMeta,
  };
}

function parseEmbeddingResponse(payload: unknown): {
  embedding: number[];
  model: string;
  dimensions: number;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Embedding response is invalid.");
  }

  const data = payload as Record<string, unknown>;
  const embedding = Array.isArray(data.embedding) ? data.embedding : [];
  if (!embedding.length || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Embedding response missing numeric vector.");
  }

  const model = typeof data.model === "string" && data.model.trim() ? data.model : "unknown";
  const dimensions =
    typeof data.dimensions === "number" && Number.isFinite(data.dimensions)
      ? data.dimensions
      : embedding.length;

  return {
    embedding: embedding as number[],
    model,
    dimensions,
  };
}

function isPipelineIntentType(value: unknown): value is PipelineIntentType {
  return typeof value === "string" && PIPELINE_INTENT_TYPES.includes(value as PipelineIntentType);
}

function parseIntentResponse(payload: unknown): PipelineIntentClassification {
  if (!payload || typeof payload !== "object") {
    throw new Error("Intent response is invalid.");
  }

  const data = payload as Record<string, unknown>;
  const intent = isPipelineIntentType(data.intent) ? data.intent : "UNKNOWN";
  const top2Intent =
    data.top2_intent === null || data.top2_intent === undefined
      ? null
      : isPipelineIntentType(data.top2_intent)
        ? data.top2_intent
        : null;

  return {
    intent,
    confidence:
      typeof data.confidence === "number" && Number.isFinite(data.confidence)
        ? data.confidence
        : 0,
    top2_intent: top2Intent,
    top2_confidence:
      typeof data.top2_confidence === "number" && Number.isFinite(data.top2_confidence)
        ? data.top2_confidence
        : null,
    margin:
      typeof data.margin === "number" && Number.isFinite(data.margin)
        ? data.margin
        : 0,
    method:
      data.method === "rule" || data.method === "semantic" || data.method === "none"
        ? data.method
        : "none",
  };
}

export async function requestPipelineChatAnswer(input: {
  question: string;
  retrievalScope: RetrievalScopePayload;
  retrievalMode?: RetrievalModePayload;
  retrievalFilters?: RetrievalFiltersPayload;
  topK?: number;
  minSimilarity?: number;
  timeoutMs?: number;
}): Promise<PipelineChatAnswer> {
  const baseUrl = requireEnv("PIPELINE_API_BASE_URL").replace(/\/+$/, "");
  const retrievalMode = input.retrievalMode ?? "qa";
  const defaultTopK = retrievalMode === "overview" ? 6 : 4;
  const rawBody = JSON.stringify({
    question: input.question,
    retrieval_scope: input.retrievalScope,
    retrieval_mode: retrievalMode,
    retrieval_filters: input.retrievalFilters ?? { publication_status: "published" },
    top_k: input.topK ?? defaultTopK,
    min_similarity: input.minSimilarity ?? 0.3,
  });
  const signedHeaders = buildPipelineSignatureHeaders(rawBody);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/chat/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedHeaders,
      },
      body: rawBody,
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await response
      .json()
      .catch(() => ({ message: "Failed to parse pipeline response." }));

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : response.statusText;
      throw new Error(`Pipeline chat request failed (${response.status}): ${detail}`);
    }

    return parsePipelineResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestPipelineQueryEmbedding(input: {
  text: string;
  modelName?: string;
  timeoutMs?: number;
}): Promise<{ embedding: number[]; model: string; dimensions: number }> {
  const baseUrl = requireEnv("PIPELINE_API_BASE_URL").replace(/\/+$/, "");
  const rawBody = JSON.stringify({
    text: input.text,
    model_name: input.modelName,
  });
  const signedHeaders = buildPipelineSignatureHeaders(rawBody);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/chat/embed-query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedHeaders,
      },
      body: rawBody,
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await response
      .json()
      .catch(() => ({ message: "Failed to parse embedding response." }));

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : response.statusText;
      throw new Error(`Pipeline embedding request failed (${response.status}): ${detail}`);
    }

    return parseEmbeddingResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestPipelineIntentClassify(input: {
  text: string;
  timeoutMs?: number;
}): Promise<PipelineIntentClassification> {
  const baseUrl = requireEnv("PIPELINE_API_BASE_URL").replace(/\/+$/, "");
  const token = requireEnv("PIPELINE_INTERNAL_TOKEN");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/intent/classify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pipeline-token": token,
      },
      body: JSON.stringify({
        text: input.text,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await response
      .json()
      .catch(() => ({ message: "Failed to parse intent response." }));

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : response.statusText;
      throw new Error(`Pipeline intent request failed (${response.status}): ${detail}`);
    }

    return parseIntentResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}
