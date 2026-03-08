import { buildMixedAnswer } from "@/lib/chat/mixed-answer";
import type {
  QueryPlan,
  QueryPlanResponseMode,
  SemanticTaskExecutionResult,
  StructuredTaskExecutionResult,
} from "@/lib/chat/query-plan-types";
import type { ChatCitation } from "@/lib/repos/chat/types";

function dedupeCitations(citations: ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  const unique: ChatCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.sourceId}|${citation.chunkId ?? ""}|${citation.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  return unique;
}

function hintsFromStructured(results: StructuredTaskExecutionResult[]): string[] {
  const years: string[] = [];
  const refs: string[] = [];
  const sectors: string[] = [];
  const projects: string[] = [];

  const seen = new Set<string>();
  for (const result of results) {
    if (result.status !== "ok") continue;
    for (const hint of result.conditioningHints) {
      const normalized = hint.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (/\b(?:fy\s*)?20\d{2}\b/i.test(normalized)) {
        if (years.length < 2) years.push(normalized);
        continue;
      }
      if (/\bref\s+[a-z0-9-]+\b/i.test(normalized)) {
        if (refs.length < 2) refs.push(normalized);
        continue;
      }
      if (/\bsector\b/i.test(normalized)) {
        if (sectors.length < 2) sectors.push(normalized);
        continue;
      }
      if (projects.length < 3) {
        projects.push(normalized);
      }
    }
  }

  return [...years, ...projects, ...sectors, ...refs].slice(0, 9);
}

function isStructuredLimitedStatus(status: StructuredTaskExecutionResult["status"]): boolean {
  return status === "clarify" || status === "unsupported" || status === "error";
}

export type ExecuteMixedPlanResult = {
  responseMode: QueryPlanResponseMode;
  content: string;
  citations: ChatCitation[];
  verifierMode: "structured" | "retrieval" | "mixed";
  structuredExpectedSnapshot: unknown;
  structuredRenderedSnapshot: unknown;
  narrativeIncluded: boolean;
  semanticConditioningApplied: boolean;
  semanticConditioningHintCount: number;
  selectiveMultiQueryTriggered: boolean;
  selectiveMultiQueryVariantCount: number;
  diagnostics: string[];
};

export async function executeMixedPlan(input: {
  plan: QueryPlan;
  executeStructuredTask: (task: QueryPlan["structuredTasks"][number]) => Promise<StructuredTaskExecutionResult>;
  executeSemanticTask: (task: QueryPlan["semanticTasks"][number], hints: string[]) => Promise<SemanticTaskExecutionResult>;
}): Promise<ExecuteMixedPlanResult> {
  const diagnostics: string[] = [];
  const structuredResults: StructuredTaskExecutionResult[] = [];

  for (const task of input.plan.structuredTasks) {
    const result = await input.executeStructuredTask(task);
    structuredResults.push(result);
    diagnostics.push(`structured:${task.kind}:${result.status}`);
  }

  const structuredLimitTaskIds = new Set(
    structuredResults
      .filter((result) => isStructuredLimitedStatus(result.status))
      .map((result) => result.taskId)
  );
  const requiredStructuredBlockers = input.plan.semanticTasks.filter((task) =>
    (task.dependsOnStructuredTaskIds ?? []).some((taskId) => structuredLimitTaskIds.has(taskId))
  );

  if (requiredStructuredBlockers.length > 0) {
    const blockerResult = structuredResults.find((result) => structuredLimitTaskIds.has(result.taskId));
    const prompt =
      blockerResult?.clarificationPrompt ??
      "Please clarify the missing comparison frame before I answer the explanation part.";
    return {
      responseMode: "clarify",
      content: prompt,
      citations: [],
      verifierMode: "structured",
      structuredExpectedSnapshot: structuredResults.map((entry) => entry.structuredSnapshot),
      structuredRenderedSnapshot: structuredResults.map(
        (entry) => entry.renderedStructuredSnapshot ?? entry.structuredSnapshot
      ),
      narrativeIncluded: false,
      semanticConditioningApplied: false,
      semanticConditioningHintCount: 0,
      selectiveMultiQueryTriggered: false,
      selectiveMultiQueryVariantCount: 0,
      diagnostics: [...diagnostics, "semantic_blocked_by_structured_dependency"],
    };
  }

  const conditioningHints = hintsFromStructured(structuredResults);
  const semanticResults: SemanticTaskExecutionResult[] = [];

  for (const task of input.plan.semanticTasks) {
    const semantic = await input.executeSemanticTask(task, conditioningHints);
    semanticResults.push(semantic);
    diagnostics.push(`semantic:${task.kind}:${semantic.status}`);
  }

  const mixedAnswer = buildMixedAnswer({
    structuredResults,
    semanticResults,
  });
  const structuredLimitationsPresent = structuredResults.some((result) =>
    isStructuredLimitedStatus(result.status)
  );
  const semanticProduced = semanticResults.some(
    (result) => result.status === "ok" || result.status === "partial"
  );

  const structuredCitations: ChatCitation[] = structuredResults.flatMap((result) =>
    result.citations.map((citation) => ({
      sourceId: citation.sourceId,
      snippet: citation.snippet,
      metadata: citation.metadata,
      scopeType: "system",
      scopeName: "Structured SQL",
      insufficient: false,
    }))
  );
  const semanticCitations: ChatCitation[] = semanticResults.flatMap((result) =>
    result.citations.map((citation) => ({
      sourceId: citation.sourceId,
      snippet: citation.snippet,
      metadata: citation.metadata,
      insufficient: false,
    }))
  );

  const citations = dedupeCitations([...structuredCitations, ...semanticCitations]);
  const narrativeIncluded = mixedAnswer.narrativeIncluded;

  let verifierMode: ExecuteMixedPlanResult["verifierMode"] = "mixed";
  if (!narrativeIncluded) {
    verifierMode = "structured";
  } else if (structuredResults.length === 0) {
    verifierMode = "retrieval";
  }

  const selectiveMultiQueryTriggered = semanticResults.some(
    (entry) => entry.retrievalMeta?.multiQueryTriggered === true
  );
  const selectiveMultiQueryVariantCount = semanticResults.reduce(
    (sum, entry) => sum + (entry.retrievalMeta?.multiQueryVariantCount ?? 0),
    0
  );

  const adjustedResponseMode: QueryPlanResponseMode =
    structuredLimitationsPresent && semanticProduced && mixedAnswer.responseMode === "full"
      ? "partial"
      : mixedAnswer.responseMode;
  const adjustedContent =
    adjustedResponseMode === "partial" && semanticProduced && structuredLimitationsPresent
      ? `${mixedAnswer.content}\n\nI could not fully compute one structured subtask, so this is a partial mixed response.`
      : mixedAnswer.content;

  return {
    responseMode: adjustedResponseMode,
    content: adjustedContent,
    citations,
    verifierMode,
    structuredExpectedSnapshot: structuredResults.map((entry) => entry.structuredSnapshot),
    structuredRenderedSnapshot: structuredResults.map(
      (entry) => entry.renderedStructuredSnapshot ?? entry.structuredSnapshot
    ),
    narrativeIncluded,
    semanticConditioningApplied: conditioningHints.length > 0,
    semanticConditioningHintCount: conditioningHints.length,
    selectiveMultiQueryTriggered,
    selectiveMultiQueryVariantCount,
    diagnostics,
  };
}
