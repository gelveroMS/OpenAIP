import { describe, expect, it } from "vitest";
import {
  getChatStrategyConfigSnapshot,
  type ChatStrategyConfigSnapshot,
} from "@/lib/chat/chat-strategy-config";
import {
  CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS,
  CONTEXTUAL_REWRITE_MAX_USER_TURNS,
} from "@/lib/chat/contextual-query-rewrite";

describe("chat strategy config snapshot", () => {
  it("returns active flags and calibration tunables", () => {
    process.env.CHAT_CONTEXTUAL_REWRITE_ENABLED = "true";
    process.env.CHAT_SEMANTIC_REPEAT_CACHE_ENABLED = "true";
    process.env.CHAT_METADATA_SQL_ROUTE_ENABLED = "true";
    process.env.CHAT_SPLIT_VERIFIER_POLICY_ENABLED = "true";
    process.env.CHAT_MIXED_QUERY_PLANNER_ENABLED = "true";
    process.env.CHAT_MIXED_QUERY_EXECUTION_ENABLED = "false";
    process.env.CHAT_MIXED_MAX_STRUCTURED_TASKS = "4";
    process.env.CHAT_MIXED_MAX_SEMANTIC_TASKS = "2";

    const snapshot: ChatStrategyConfigSnapshot = getChatStrategyConfigSnapshot();

    expect(snapshot.flags.CHAT_CONTEXTUAL_REWRITE_ENABLED).toBe(true);
    expect(snapshot.flags.CHAT_SEMANTIC_REPEAT_CACHE_ENABLED).toBe(true);
    expect(snapshot.flags.CHAT_METADATA_SQL_ROUTE_ENABLED).toBe(true);
    expect(snapshot.flags.CHAT_SPLIT_VERIFIER_POLICY_ENABLED).toBe(true);
    expect(snapshot.flags.CHAT_MIXED_QUERY_PLANNER_ENABLED).toBe(true);
    expect(snapshot.flags.CHAT_MIXED_QUERY_EXECUTION_ENABLED).toBe(false);

    expect(snapshot.calibration.rewrite_max_user_turns).toBe(CONTEXTUAL_REWRITE_MAX_USER_TURNS);
    expect(snapshot.calibration.rewrite_max_assistant_turns).toBe(
      CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS
    );
    expect(snapshot.calibration.mixed_max_structured_tasks).toBe(4);
    expect(snapshot.calibration.mixed_max_semantic_tasks).toBe(2);
  });
});
