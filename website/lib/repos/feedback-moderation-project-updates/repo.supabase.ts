import { withCsrfHeader } from "@/lib/security/csrf";
import type {
  FeedbackModerationProjectUpdatesRepo,
  FeedbackModerationProjectUpdatesSeed,
  ProjectUpdateModerationInput,
} from "./repo";

type ProjectUpdateModerationAction = "hide" | "unhide";

type ProjectUpdateModerationActionBody = {
  action: ProjectUpdateModerationAction;
  input: ProjectUpdateModerationInput;
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

async function loadSeedData(): Promise<FeedbackModerationProjectUpdatesSeed> {
  const response = await fetch("/api/admin/project-updates-moderation", {
    method: "GET",
    cache: "no-store",
  });
  return parseJsonOrThrow<FeedbackModerationProjectUpdatesSeed>(
    response,
    "Failed to load project update moderation dataset."
  );
}

async function performAction(
  action: ProjectUpdateModerationAction,
  input: ProjectUpdateModerationInput
): Promise<FeedbackModerationProjectUpdatesSeed> {
  const response = await fetch(
    "/api/admin/project-updates-moderation",
    withCsrfHeader({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        input,
      } satisfies ProjectUpdateModerationActionBody),
    })
  );

  return parseJsonOrThrow<FeedbackModerationProjectUpdatesSeed>(
    response,
    "Failed to process project update moderation action."
  );
}

export function createSupabaseFeedbackModerationProjectUpdatesRepo(): FeedbackModerationProjectUpdatesRepo {
  return {
    async getSeedData() {
      return loadSeedData();
    },
    async hideUpdate(input) {
      return performAction("hide", input);
    },
    async unhideUpdate(input) {
      return performAction("unhide", input);
    },
  };
}
