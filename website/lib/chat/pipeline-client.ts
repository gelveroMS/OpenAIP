import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import type { PipelineChatAnswer, RetrievalScopePayload } from "./types";

const DEFAULT_TIMEOUT_MS = 30000;
const PIPELINE_AUDIENCE = "website-backend";

function requireEnv(name: "PIPELINE_API_BASE_URL" | "PIPELINE_HMAC_SECRET"): string {
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

export async function requestPipelineChatAnswer(input: {
  question: string;
  retrievalScope: RetrievalScopePayload;
  topK?: number;
  minSimilarity?: number;
  timeoutMs?: number;
}): Promise<PipelineChatAnswer> {
  const baseUrl = requireEnv("PIPELINE_API_BASE_URL").replace(/\/+$/, "");
  const rawBody = JSON.stringify({
    question: input.question,
    retrieval_scope: input.retrievalScope,
    top_k: input.topK ?? 8,
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
