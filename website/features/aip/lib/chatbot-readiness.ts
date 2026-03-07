import { isEmbedSkipNoArtifactMessage } from "@/lib/constants/embedding";
import type { AipHeader } from "../types";

export type AipChatbotReadinessKind =
  | "chatbot_ready"
  | "embedding"
  | "failed"
  | "needs_embedding";

export type AipChatbotReadinessTone = "success" | "info" | "danger" | "warning";

export type AipChatbotReadinessViewModel = {
  kind: AipChatbotReadinessKind;
  label: string;
  title: string;
  message: string;
  tone: AipChatbotReadinessTone;
  progressPct: number | null;
};

function clampProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getAipChatbotReadinessStatus(
  embedding: AipHeader["embedding"]
): AipChatbotReadinessViewModel {
  if (!embedding) {
    return {
      kind: "needs_embedding",
      label: "Needs embedding",
      title: "Needs Embedding",
      message:
        "Embedding has not started yet. Start embedding to enable chatbot queries.",
      tone: "warning",
      progressPct: null,
    };
  }

  if (embedding.status === "queued" || embedding.status === "running") {
    return {
      kind: "embedding",
      label: "Currently embedding",
      title: "Currently Embedding",
      message:
        embedding.progressMessage ??
        "Embedding is in progress. This AIP will be queryable through the chatbot when complete.",
      tone: "info",
      progressPct: clampProgress(embedding.overallProgressPct),
    };
  }

  if (embedding.status === "failed") {
    return {
      kind: "failed",
      label: "Failed to embed",
      title: "Failed to Embed",
      message:
        embedding.errorMessage ??
        "Embedding failed. Retry embedding to enable chatbot queries.",
      tone: "danger",
      progressPct: null,
    };
  }

  if (isEmbedSkipNoArtifactMessage(embedding.progressMessage)) {
    return {
      kind: "needs_embedding",
      label: "Needs embedding",
      title: "Needs Embedding",
      message:
        "Embedding was skipped because no categorize artifact was available. Start embedding when artifacts are ready.",
      tone: "warning",
      progressPct: null,
    };
  }

  return {
    kind: "chatbot_ready",
    label: "Chatbot ready",
    title: "Chatbot Ready",
    message:
      embedding.progressMessage ??
      "This AIP is embedded and can now be queried through the chatbot.",
    tone: "success",
    progressPct: null,
  };
}
