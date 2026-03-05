import { describe, expect, it } from "vitest";
import { EMBED_SKIP_NO_ARTIFACT_MESSAGE } from "@/lib/constants/embedding";
import type { AipHeader } from "../types";
import { getAipChatbotReadinessStatus } from "./chatbot-readiness";

function makeEmbedding(
  overrides: Partial<NonNullable<AipHeader["embedding"]>> = {}
): NonNullable<AipHeader["embedding"]> {
  return {
    runId: "run-001",
    status: "succeeded",
    overallProgressPct: null,
    progressMessage: null,
    errorMessage: null,
    updatedAt: "2026-03-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("getAipChatbotReadinessStatus", () => {
  it("maps missing embedding to needs embedding", () => {
    const status = getAipChatbotReadinessStatus(undefined);

    expect(status.kind).toBe("needs_embedding");
    expect(status.label).toBe("Needs embedding");
    expect(status.title).toBe("Needs Embedding");
  });

  it("maps queued/running embedding to currently embedding", () => {
    const queued = getAipChatbotReadinessStatus(
      makeEmbedding({
        status: "queued",
        overallProgressPct: 32.8,
      })
    );
    const running = getAipChatbotReadinessStatus(
      makeEmbedding({
        status: "running",
        overallProgressPct: 71.2,
      })
    );

    expect(queued.kind).toBe("embedding");
    expect(queued.label).toBe("Currently embedding");
    expect(queued.progressPct).toBe(33);

    expect(running.kind).toBe("embedding");
    expect(running.title).toBe("Currently Embedding");
    expect(running.progressPct).toBe(71);
  });

  it("maps failed embedding to failed to embed", () => {
    const status = getAipChatbotReadinessStatus(
      makeEmbedding({
        status: "failed",
        errorMessage: "Embedding pipeline timeout.",
      })
    );

    expect(status.kind).toBe("failed");
    expect(status.label).toBe("Failed to embed");
    expect(status.message).toContain("timeout");
  });

  it("maps succeeded embedding to chatbot ready", () => {
    const status = getAipChatbotReadinessStatus(
      makeEmbedding({
        status: "succeeded",
      })
    );

    expect(status.kind).toBe("chatbot_ready");
    expect(status.label).toBe("Chatbot ready");
    expect(status.title).toBe("Chatbot Ready");
  });

  it("maps succeeded skipped embedding to needs embedding", () => {
    const status = getAipChatbotReadinessStatus(
      makeEmbedding({
        status: "succeeded",
        progressMessage: EMBED_SKIP_NO_ARTIFACT_MESSAGE,
      })
    );

    expect(status.kind).toBe("needs_embedding");
    expect(status.label).toBe("Needs embedding");
    expect(status.message).toContain("skipped");
  });
});
