import {
  CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS,
  CONTEXTUAL_REWRITE_MAX_USER_TURNS,
} from "@/lib/chat/contextual-query-rewrite";
import { getMixedTaskCaps } from "@/lib/chat/query-plan-builder";

type StrategyFlags = {
  CHAT_CONTEXTUAL_REWRITE_ENABLED: boolean;
  CHAT_SEMANTIC_REPEAT_CACHE_ENABLED: boolean;
  CHAT_METADATA_SQL_ROUTE_ENABLED: boolean;
  CHAT_SPLIT_VERIFIER_POLICY_ENABLED: boolean;
  CHAT_MIXED_QUERY_PLANNER_ENABLED: boolean;
  CHAT_MIXED_QUERY_EXECUTION_ENABLED: boolean;
};

export type ChatStrategyCalibrationSnapshot = {
  rewrite_max_user_turns: number;
  rewrite_max_assistant_turns: number;
  mixed_max_structured_tasks: number;
  mixed_max_semantic_tasks: number;
};

export type ChatStrategyConfigSnapshot = {
  flags: StrategyFlags;
  calibration: ChatStrategyCalibrationSnapshot;
};

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  return value.trim().toLowerCase() === "true";
}

export function getChatStrategyConfigSnapshot(): ChatStrategyConfigSnapshot {
  const mixedCaps = getMixedTaskCaps();
  return {
    flags: {
      CHAT_CONTEXTUAL_REWRITE_ENABLED: boolEnv("CHAT_CONTEXTUAL_REWRITE_ENABLED", false),
      CHAT_SEMANTIC_REPEAT_CACHE_ENABLED: boolEnv("CHAT_SEMANTIC_REPEAT_CACHE_ENABLED", false),
      CHAT_METADATA_SQL_ROUTE_ENABLED: process.env.CHAT_METADATA_SQL_ROUTE_ENABLED !== "false",
      CHAT_SPLIT_VERIFIER_POLICY_ENABLED: process.env.CHAT_SPLIT_VERIFIER_POLICY_ENABLED !== "false",
      CHAT_MIXED_QUERY_PLANNER_ENABLED: boolEnv("CHAT_MIXED_QUERY_PLANNER_ENABLED", false),
      CHAT_MIXED_QUERY_EXECUTION_ENABLED: boolEnv("CHAT_MIXED_QUERY_EXECUTION_ENABLED", false),
    },
    calibration: {
      rewrite_max_user_turns: CONTEXTUAL_REWRITE_MAX_USER_TURNS,
      rewrite_max_assistant_turns: CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS,
      mixed_max_structured_tasks: mixedCaps.mixed_max_structured_tasks,
      mixed_max_semantic_tasks: mixedCaps.mixed_max_semantic_tasks,
    },
  };
}
