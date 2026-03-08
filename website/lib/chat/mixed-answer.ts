import type {
  QueryPlanResponseMode,
  SemanticTaskExecutionResult,
  StructuredTaskExecutionResult,
} from "@/lib/chat/query-plan-types";

export type MixedAnswerBuildResult = {
  content: string;
  responseMode: QueryPlanResponseMode;
  narrativeIncluded: boolean;
};

function formatStructuredSections(results: StructuredTaskExecutionResult[]): string[] {
  const sections: string[] = [];
  for (const result of results) {
    if (result.status !== "ok" && result.status !== "empty") continue;
    sections.push(result.summary.trim());
  }
  return sections.filter(Boolean);
}

function formatSemanticSections(results: SemanticTaskExecutionResult[]): string[] {
  return results
    .filter((result) => result.status === "ok" || result.status === "partial")
    .map((result) => result.answer.trim())
    .filter(Boolean);
}

export function buildMixedAnswer(input: {
  structuredResults: StructuredTaskExecutionResult[];
  semanticResults: SemanticTaskExecutionResult[];
}): MixedAnswerBuildResult {
  const structuredSections = formatStructuredSections(input.structuredResults);
  const semanticSections = formatSemanticSections(input.semanticResults);

  const narrativeIncluded = semanticSections.length > 0;

  if (structuredSections.length === 0 && semanticSections.length === 0) {
    return {
      content:
        "I could not produce a grounded mixed response from the current structured and document evidence.",
      responseMode: "refuse",
      narrativeIncluded: false,
    };
  }

  if (structuredSections.length === 0) {
    return {
      content: semanticSections.join("\n\n"),
      responseMode: "full",
      narrativeIncluded,
    };
  }

  if (semanticSections.length === 0) {
    return {
      content:
        `${structuredSections.join("\n\n")}\n\n` +
        "I could not find enough narrative chunk evidence to add a cited explanation.",
      responseMode: "partial",
      narrativeIncluded: false,
    };
  }

  return {
    content:
      "Computed results from structured published AIP data:\n" +
      `${structuredSections.join("\n\n")}\n\n` +
      "Narrative evidence from published AIP chunks:\n" +
      semanticSections.join("\n\n"),
    responseMode: "full",
    narrativeIncluded,
  };
}
