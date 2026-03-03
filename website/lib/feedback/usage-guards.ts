import "server-only";

import { getTypedAppSetting, isUserBlocked } from "@/lib/settings/app-settings";

type FeedbackQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          gte: (
            column: string,
            value: string
          ) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

export class FeedbackUsageError extends Error {
  readonly status: 403 | 429;
  readonly code: "blocked" | "rate_limited";

  constructor(input: { status: 403 | 429; code: "blocked" | "rate_limited"; message: string }) {
    super(input.message);
    this.name = "FeedbackUsageError";
    this.status = input.status;
    this.code = input.code;
  }
}

export class FeedbackBlockedUserError extends FeedbackUsageError {
  constructor() {
    super({
      status: 403,
      code: "blocked",
      message: "Your account is currently blocked from posting feedback.",
    });
    this.name = "FeedbackBlockedUserError";
  }
}

export class FeedbackRateLimitExceededError extends FeedbackUsageError {
  constructor() {
    super({
      status: 429,
      code: "rate_limited",
      message: "Comment rate limit exceeded. Please try again later.",
    });
    this.name = "FeedbackRateLimitExceededError";
  }
}

export function isFeedbackUsageError(error: unknown): error is FeedbackUsageError {
  return error instanceof FeedbackUsageError;
}

function resolveWindowStart(timeWindow: "hour" | "day"): Date {
  const start = new Date();
  if (timeWindow === "day") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setTime(start.getTime() - 60 * 60 * 1000);
  }
  return start;
}

async function countRecentFeedbackByAuthor(
  client: FeedbackQueryClient,
  input: {
    authorId: string;
    timeWindow: "hour" | "day";
  }
): Promise<number> {
  const start = resolveWindowStart(input.timeWindow);
  const { data, error } = await client
    .from("feedback")
    .select("id")
    .eq("author_id", input.authorId)
    .eq("source", "human")
    .gte("created_at", start.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data.length : 0;
}

export async function assertFeedbackUsageAllowed(input: {
  client: FeedbackQueryClient;
  userId: string;
}): Promise<void> {
  if (await isUserBlocked(input.userId)) {
    throw new FeedbackBlockedUserError();
  }

  const settings = await getTypedAppSetting("controls.comment_rate_limit");
  const recentCount = await countRecentFeedbackByAuthor(input.client, {
    authorId: input.userId,
    timeWindow: settings.timeWindow,
  });

  if (recentCount >= settings.maxComments) {
    throw new FeedbackRateLimitExceededError();
  }
}
