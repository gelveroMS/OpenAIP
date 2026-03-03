import { withCsrfHeader } from "@/lib/security/csrf";
import type {
  FeedbackModerationActionInput,
  FeedbackModerationDataset,
  FeedbackModerationRepo,
} from "./types";

type FeedbackModerationAction = "hide" | "unhide";

type FeedbackModerationActionBody = {
  action: FeedbackModerationAction;
  input: FeedbackModerationActionInput;
};

async function parseJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | T | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : null;
    throw new Error(typeof message === "string" && message ? message : fallbackMessage);
  }
  return payload as T;
}

async function loadDataset(): Promise<FeedbackModerationDataset> {
  const response = await fetch("/api/admin/feedback-moderation", {
    method: "GET",
    cache: "no-store",
  });
  return parseJsonOrThrow<FeedbackModerationDataset>(
    response,
    "Failed to load feedback moderation dataset."
  );
}

async function performAction(
  action: FeedbackModerationAction,
  input: FeedbackModerationActionInput
): Promise<FeedbackModerationDataset> {
  const response = await fetch(
    "/api/admin/feedback-moderation",
    withCsrfHeader({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        input,
      } satisfies FeedbackModerationActionBody),
    })
  );
  return parseJsonOrThrow<FeedbackModerationDataset>(
    response,
    "Failed to process feedback moderation action."
  );
}

export function createSupabaseFeedbackModerationRepo(): FeedbackModerationRepo {
  return {
    async listDataset() {
      return loadDataset();
    },
    async hideFeedback(input) {
      return performAction("hide", input);
    },
    async unhideFeedback(input) {
      return performAction("unhide", input);
    },
  };
}
