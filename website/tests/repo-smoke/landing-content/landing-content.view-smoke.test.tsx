import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingContentView from "@/features/citizen/landing-content/views/landing-content-view";
import { createMockLandingContentRepo } from "@/lib/repos/landing-content/repo.mock";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAppearsInOrder(markup: string, snippets: string[]) {
  let previousIndex = -1;

  for (const snippet of snippets) {
    const index = markup.indexOf(snippet);
    assert(index >= 0, `Expected snippet "${snippet}" in markup`);
    assert(index > previousIndex, `Expected snippet "${snippet}" to appear after previous snippet`);
    previousIndex = index;
  }
}

export async function runLandingContentViewSmokeTests() {
  const repo = createMockLandingContentRepo();
  const result = await repo.getLandingContent();
  const html = renderToStaticMarkup(<LandingContentView vm={result.vm} />);

  assert(html.length > 0, "Expected rendered HTML output");

  assertAppearsInOrder(html, [
    "Know Where",
    "Every Peso Goes.",
    "Every allocation.",
    "LGU Budget Overview",
    "How Funds Are Distributed",
    "Health Projects",
    "Total Healthcare Budget",
    "Total Beneficiaries",
    "View Project",
    "Infrastructure Development",
    "Total Infrastructure Budget",
    "Your Voice Matters.",
    "Feedback Category Summary",
    "Commend",
    "Suggestion",
    "Concern",
    "Question",
    "Ask Questions, Get Answers",
  ]);
}
