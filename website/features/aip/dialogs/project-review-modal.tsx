"use client";

import * as React from "react";
import {
  deriveSectorFromRefCode,
  diffProjectEditableFields,
  formatDiffValue,
  projectEditableFieldsFromRow,
  PROJECT_FIELD_LABELS,
} from "@/lib/repos/aip/project-review";
import type {
  AipProjectEditPatch,
  AipProjectEditableFields,
  AipProjectRow,
} from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ReviewSubmitPayload = {
  reason: string;
  changes?: AipProjectEditPatch;
  resolution: "disputed" | "confirmed" | "comment_only";
};

function toInputValue(value: string | null): string {
  return value ?? "";
}

function toNumberInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replaceAll(",", "").replaceAll("\u20b1", "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseErrorsInput(value: string): string[] | null {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length ? lines : null;
}

function getChangedPatch(
  draft: AipProjectEditableFields,
  diff: Array<{ key: keyof AipProjectEditableFields }>
): AipProjectEditPatch {
  const patch: AipProjectEditPatch = {};
  const target = patch as Record<
    keyof AipProjectEditableFields,
    AipProjectEditableFields[keyof AipProjectEditableFields] | undefined
  >;
  for (const item of diff) {
    target[item.key] = draft[item.key];
  }
  return patch;
}

function ReviewPanel({
  project,
}: {
  project: AipProjectRow;
}) {
  const hasAiIssues = (project.errors?.length ?? project.aiIssues?.length ?? 0) > 0;

  if (hasAiIssues) {
    const issues = project.errors ?? project.aiIssues ?? [];
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
        <div className="font-semibold text-red-700">Detected Issues (AI)</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700/90">
          {issues.length ? issues.map((issue, index) => <li key={index}>{issue}</li>) : <li>No issues listed.</li>}
        </ul>
      </div>
    );
  }

  if (project.reviewStatus === "reviewed") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        <div className="font-semibold text-amber-700">Latest Official Review Comment</div>
        <p className="mt-2 whitespace-pre-wrap text-amber-800">
          {project.officialComment ?? "No comment recorded."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
      No issues detected by AI. Edit any field to provide a correction and justification.
    </div>
  );
}

function FieldGrid({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

export function ProjectReviewModal({
  open,
  onOpenChange,
  project,
  onSubmit,
  canComment = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: AipProjectRow | null;
  onSubmit: (payload: ReviewSubmitPayload) => Promise<void>;
  canComment?: boolean;
}) {
  const [draft, setDraft] = React.useState<AipProjectEditableFields | null>(null);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(project ? projectEditableFieldsFromRow(project) : null);
    setReason("");
    setSubmitting(false);
    setSubmitError(null);
  }, [open, project]);

  const hasAiIssues = (project?.errors?.length ?? project?.aiIssues?.length ?? 0) > 0;

  const diff = React.useMemo(() => {
    if (!project || !draft) return [];
    const initial = projectEditableFieldsFromRow(project);
    return diffProjectEditableFields(initial, draft);
  }, [project, draft]);

  const hasChanges = diff.length > 0;
  const showReasonPanel = hasAiIssues || hasChanges;

  const patch = React.useMemo(() => {
    if (!draft || !hasChanges) return undefined;
    return getChangedPatch(draft, diff);
  }, [draft, diff, hasChanges]);

  if (!project || !draft) return null;

  const defaultResolution =
    project.reviewStatus === "ai_flagged" ? "disputed" : "comment_only";
  const derivedSector = deriveSectorFromRefCode(draft.aipRefCode);

  async function handleSubmit() {
    if (!canComment) return;
    const trimmedReason = reason.trim();
    if (!showReasonPanel || !trimmedReason) return;

    try {
      setSubmitting(true);
      setSubmitError(null);
      await onSubmit({
        reason: trimmedReason,
        resolution: defaultResolution,
        changes: patch,
      });
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {hasAiIssues ? "Error Review - Project Details" : "Project Details"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Project Information</div>

              <div className="mt-4 space-y-4">
                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="aip-ref-code">AIP Reference Code</Label>
                    <Input
                      id="aip-ref-code"
                      value={draft.aipRefCode}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              aipRefCode: event.target.value,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Sector (Derived)</Label>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {derivedSector}
                    </div>
                  </div>
                </FieldGrid>

                <div className="space-y-2">
                  <Label htmlFor="description">Program/Project Description</Label>
                  <Textarea
                    id="description"
                    value={draft.programProjectDescription}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? {
                            ...prev,
                            programProjectDescription: event.target.value,
                          }
                          : prev
                      )
                    }
                    className="min-h-[90px]"
                    disabled={!canComment}
                  />
                </div>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <select
                      id="category"
                      value={draft.category}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              category: event.target.value as AipProjectEditableFields["category"],
                            }
                            : prev
                        )
                      }
                      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                      disabled={!canComment}
                    >
                      <option value="health">health</option>
                      <option value="infrastructure">infrastructure</option>
                      <option value="other">other</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="implementing-agency">Implementing Agency</Label>
                    <Input
                      id="implementing-agency"
                      value={toInputValue(draft.implementingAgency)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              implementingAgency: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      value={toInputValue(draft.startDate)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              startDate: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="completion-date">Completion Date</Label>
                    <Input
                      id="completion-date"
                      value={toInputValue(draft.completionDate)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              completionDate: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="expected-output">Expected Output</Label>
                    <Input
                      id="expected-output"
                      value={toInputValue(draft.expectedOutput)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              expectedOutput: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-of-funds">Source of Funds</Label>
                    <Input
                      id="source-of-funds"
                      value={toInputValue(draft.sourceOfFunds)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              sourceOfFunds: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="personal-services">Personal Services</Label>
                    <Input
                      id="personal-services"
                      type="number"
                      value={toNumberInputValue(draft.personalServices)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              personalServices: parseNumberInput(event.target.value),
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mooe">MOOE</Label>
                    <Input
                      id="mooe"
                      type="number"
                      value={toNumberInputValue(draft.maintenanceAndOtherOperatingExpenses)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              maintenanceAndOtherOperatingExpenses: parseNumberInput(event.target.value),
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="financial-expenses">Financial Expenses</Label>
                    <Input
                      id="financial-expenses"
                      type="number"
                      value={toNumberInputValue(draft.financialExpenses)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              financialExpenses: parseNumberInput(event.target.value),
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="capital-outlay">Capital Outlay</Label>
                    <Input
                      id="capital-outlay"
                      type="number"
                      value={toNumberInputValue(draft.capitalOutlay)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              capitalOutlay: parseNumberInput(event.target.value),
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <div className="space-y-2">
                  <Label htmlFor="total">Total</Label>
                  <Input
                    id="total"
                    type="number"
                    value={toNumberInputValue(draft.total)}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? {
                            ...prev,
                            total: parseNumberInput(event.target.value),
                          }
                          : prev
                      )
                    }
                    disabled={!canComment}
                  />
                </div>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="climate-adaptation">Climate Change Adaptation</Label>
                    <Input
                      id="climate-adaptation"
                      value={toInputValue(draft.climateChangeAdaptation)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              climateChangeAdaptation: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="climate-mitigation">Climate Change Mitigation</Label>
                    <Input
                      id="climate-mitigation"
                      value={toInputValue(draft.climateChangeMitigation)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              climateChangeMitigation: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>

                <FieldGrid>
                  <div className="space-y-2">
                    <Label htmlFor="cc-topology">CC Topology Code</Label>
                    <Input
                      id="cc-topology"
                      value={toInputValue(draft.ccTopologyCode)}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              ccTopologyCode: event.target.value.trim() ? event.target.value : null,
                            }
                            : prev
                        )
                      }
                      disabled={!canComment}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-errors">AI Issues (one per line)</Label>
                    <Textarea
                      id="ai-errors"
                      value={(draft.errors ?? []).join("\n")}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev
                            ? {
                              ...prev,
                              errors: parseErrorsInput(event.target.value),
                            }
                            : prev
                        )
                      }
                      className="min-h-[110px]"
                      disabled={!canComment}
                    />
                  </div>
                </FieldGrid>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <ReviewPanel project={project} />

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Official Comment / Justification</div>

              {!canComment ? (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Feedback can only be added when the AIP status is Draft or For Revision.
                </div>
              ) : showReasonPanel ? (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    Provide your justification before saving.
                  </p>

                  {diff.length > 0 ? (
                    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-700">Detected field changes</div>
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {diff.map((item) => (
                          <li key={item.key}>
                            {PROJECT_FIELD_LABELS[item.key]}:{" "}
                            <span className="font-medium">{formatDiffValue(item.before)}</span>
                            {" -> "}
                            <span className="font-medium">{formatDiffValue(item.after)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain what changed (or why you are disputing/confirming AI findings)."
                    className="mt-3 min-h-[130px]"
                  />

                  {submitError ? (
                    <p className="mt-2 text-xs text-rose-600">{submitError}</p>
                  ) : null}

                  <Button
                    className="mt-3 w-full bg-[#022437] hover:bg-[#022437]/90"
                    onClick={handleSubmit}
                    disabled={submitting || !reason.trim()}
                  >
                    {submitting ? "Submitting..." : "Save Review"}
                  </Button>
                </>
              ) : (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  No issues detected. Edit one or more fields to enable the required justification comment.
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
