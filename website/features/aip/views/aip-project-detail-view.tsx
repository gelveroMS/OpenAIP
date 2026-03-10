"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  deriveSectorFromRefCode,
  diffProjectEditableFields,
  formatDiffValue,
  projectEditableFieldsFromRow,
  PROJECT_FIELD_LABELS,
} from "@/lib/repos/aip/project-review";
import type {
  AipHeader,
  AipProjectEditPatch,
  AipProjectEditableFields,
  AipProjectFeedbackMessage,
  AipProjectFeedbackThread,
  AipProjectReviewDetail,
} from "@/lib/repos/aip/repo";
import type { RoleType } from "@/lib/contracts/databasev2";
import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitAipProjectReviewAction } from "../actions/aip-projects.actions";
import { getAipStatusBadgeClass } from "../utils";
import { LguProjectFeedbackThread } from "@/features/projects/shared/feedback";

type ReviewSubmitPayload = {
  reason: string;
  changes?: AipProjectEditPatch;
  resolution: "disputed" | "confirmed" | "comment_only";
};

type ProjectBreadcrumbItem = {
  label: string;
  href?: string;
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

function formatFeedbackDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

function feedbackRoleLabel(role: RoleType | null | undefined): string {
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official" || role === "municipal_official" || role === "admin") {
    return "Reviewer";
  }
  if (role === "citizen") return "Citizen";
  return "Official";
}

function feedbackAuthorLabel(message: AipProjectFeedbackMessage): string {
  if (message.authorName?.trim()) return message.authorName.trim();
  if (message.source === "ai") return "AI";
  return feedbackRoleLabel(message.authorRole);
}

function feedbackKindLabel(kind: AipProjectFeedbackMessage["kind"]): string {
  return kind.replaceAll("_", " ");
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function FeedbackMessageCard({
  message,
  isReply,
}: {
  message: AipProjectFeedbackMessage;
  isReply?: boolean;
}) {
  const showKindBadge = message.kind !== "lgu_note";
  return (
    <div
      className={`rounded-md border p-3 ${isReply ? "border-slate-200 bg-slate-50" : "border-slate-300 bg-white"}`}
    >
      {showKindBadge ? (
        <Badge variant="outline" className="h-5 rounded-full text-[10px] capitalize">
          {feedbackKindLabel(message.kind)}
        </Badge>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <span>{feedbackAuthorLabel(message)}</span>
        <span className="text-slate-400">|</span>
        <span>{formatFeedbackDate(message.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
    </div>
  );
}

function FeedbackThreadCard({ thread }: { thread: AipProjectFeedbackThread }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <FeedbackMessageCard message={thread.root} />
      {thread.replies.length ? (
        <div className="space-y-2 pl-3">
          {thread.replies.map((reply) => (
            <FeedbackMessageCard key={reply.id} message={reply} isReply />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AipProjectDetailView({
  scope = "barangay",
  aip,
  detail,
  breadcrumbItems,
  forceReadOnly = false,
  readOnlyMessage,
  showOfficialCommentPanel = true,
}: {
  scope?: "city" | "barangay";
  aip: AipHeader;
  detail: AipProjectReviewDetail;
  breadcrumbItems?: ProjectBreadcrumbItem[];
  forceReadOnly?: boolean;
  readOnlyMessage?: string;
  showOfficialCommentPanel?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canComment =
    !forceReadOnly && (aip.status === "draft" || aip.status === "for_revision");
  const isCityOwnedAip = aip.scope === "city";
  const isPublished = aip.status === "published";
  const selectedThreadId = searchParams.get("thread");
  const selectedFeedbackId = searchParams.get("comment");

  const [project, setProject] = React.useState(detail.project);
  const [draft, setDraft] = React.useState<AipProjectEditableFields>(
    projectEditableFieldsFromRow(detail.project)
  );
  const [feedbackThreads, setFeedbackThreads] = React.useState(detail.feedbackThreads);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProject(detail.project);
    setDraft(projectEditableFieldsFromRow(detail.project));
    setFeedbackThreads(detail.feedbackThreads);
    setReason("");
    setSubmitting(false);
    setSubmitError(null);
  }, [detail]);

  const originalDetectedIssues = React.useMemo(
    () => detail.project.errors ?? detail.project.aiIssues ?? [],
    [detail.project]
  );
  const hasOriginalAiIssues = originalDetectedIssues.length > 0;
  const initial = React.useMemo(() => projectEditableFieldsFromRow(project), [project]);
  const diff = React.useMemo(
    () => diffProjectEditableFields(initial, draft),
    [draft, initial]
  );
  const hasChanges = diff.length > 0;
  const showReasonPanel = hasOriginalAiIssues || hasChanges;
  const patch = React.useMemo(() => {
    if (!hasChanges) return undefined;
    return getChangedPatch(draft, diff);
  }, [draft, diff, hasChanges]);

  const defaultResolution =
    project.reviewStatus === "ai_flagged" ? "disputed" : "comment_only";
  const derivedSector = deriveSectorFromRefCode(draft.aipRefCode);

  const defaultBreadcrumb = [
    { label: "AIP Management", href: `/${scope}/aips` },
    {
      label: aip.title,
      href: `/${scope}/aips/${aip.id}?focus=${encodeURIComponent(project.id)}`,
    },
    {
      label: `Project ${project.projectRefCode}`,
    },
  ];
  const breadcrumb = breadcrumbItems ?? defaultBreadcrumb;
  const lockedCommentMessage =
    forceReadOnly
      ? (readOnlyMessage ??
        "Project editing is disabled because this AIP is owned by a barangay.")
      : "Feedback can only be added when the AIP status is Draft or For Revision.";
  const shouldShowOfficialCommentPanel = showOfficialCommentPanel && !isPublished;
  const workflowFeedbackThreads = React.useMemo(
    () => feedbackThreads.filter((thread) => thread.root.authorRole !== "citizen"),
    [feedbackThreads]
  );

  async function handleSubmit(payload: ReviewSubmitPayload) {
    if (!canComment) return;
    const trimmedReason = payload.reason.trim();
    if (!trimmedReason) return;

    try {
      setSubmitting(true);
      setSubmitError(null);
      const updated = await submitAipProjectReviewAction({
        projectId: project.id,
        aipId: aip.id,
        reason: trimmedReason,
        changes: payload.changes,
        resolution: payload.resolution,
      });

      setProject(updated);
      setDraft(projectEditableFieldsFromRow(updated));
      setReason("");
      router.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <BreadcrumbNav items={breadcrumb} />

      <Card className="border-slate-200 bg-card">
        <CardContent className="flex items-center justify-between gap-4 px-6 py-0">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">{project.programProjectDescription}</h1>
            <p className="text-xs text-slate-500">Ref code: {project.projectRefCode}</p>
          </div>

          <Badge
            variant="outline"
            className={`rounded-full ${getAipStatusBadgeClass(aip.status)}`}
          >
            {aip.status}
          </Badge>
        </CardContent>
      </Card>

      <div
        className={`rounded-lg border p-4 ${
          hasOriginalAiIssues
            ? "border-red-200 bg-red-50"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div
          className={`text-sm font-semibold ${
            hasOriginalAiIssues ? "text-red-800" : "text-emerald-800"
          }`}
        >
          Detected Issues (AI)
        </div>
        {hasOriginalAiIssues ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800/90">
            {originalDetectedIssues.map((issue, index) => (
              <li key={`${issue}-${index}`}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-emerald-800/90">
            No AI-detected issues were found for this project.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <div className="rounded-lg border border-slate-200 bg-card p-4">
            <div className="text-sm font-semibold text-slate-900">Project Information</div>

            <div className="mt-4 space-y-4">
              <FieldGrid>
                <div className="space-y-2">
                  <Label htmlFor="aip-ref-code">AIP Reference Code</Label>
                  <Input
                    id="aip-ref-code"
                    value={draft.aipRefCode}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        aipRefCode: event.target.value,
                      }))
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
                    setDraft((prev) => ({
                      ...prev,
                      programProjectDescription: event.target.value,
                    }))
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
                      setDraft((prev) => ({
                        ...prev,
                        category: event.target.value as AipProjectEditableFields["category"],
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        implementingAgency: event.target.value.trim()
                          ? event.target.value
                          : null,
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        startDate: event.target.value.trim() ? event.target.value : null,
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        completionDate: event.target.value.trim() ? event.target.value : null,
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        expectedOutput: event.target.value.trim() ? event.target.value : null,
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        sourceOfFunds: event.target.value.trim() ? event.target.value : null,
                      }))
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
                      setDraft((prev) => ({
                        ...prev,
                        personalServices: parseNumberInput(event.target.value),
                      }))
                    }
                    disabled={!canComment}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mooe">MOOE</Label>
                  <Input
                    id="mooe"
                    type="number"
                    value={toNumberInputValue(
                      draft.maintenanceAndOtherOperatingExpenses
                    )}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        maintenanceAndOtherOperatingExpenses: parseNumberInput(
                          event.target.value
                        ),
                      }))
                    }
                    disabled={!canComment}
                  />
                </div>
              </FieldGrid>

              <FieldGrid>
                {!isCityOwnedAip ? (
                  <div className="space-y-2">
                    <Label htmlFor="financial-expenses">Financial Expenses</Label>
                    <Input
                      id="financial-expenses"
                      type="number"
                      value={toNumberInputValue(draft.financialExpenses)}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          financialExpenses: parseNumberInput(event.target.value),
                        }))
                      }
                      disabled={!canComment}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="capital-outlay">Capital Outlay</Label>
                  <Input
                    id="capital-outlay"
                    type="number"
                    value={toNumberInputValue(draft.capitalOutlay)}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        capitalOutlay: parseNumberInput(event.target.value),
                      }))
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
                    setDraft((prev) => ({
                      ...prev,
                      total: parseNumberInput(event.target.value),
                    }))
                  }
                  disabled={!canComment}
                />
              </div>

              {isCityOwnedAip ? (
                <>
                  <FieldGrid>
                    <div className="space-y-2">
                      <Label htmlFor="climate-adaptation">Climate Change Adaptation</Label>
                      <Input
                        id="climate-adaptation"
                        value={toInputValue(draft.climateChangeAdaptation)}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            climateChangeAdaptation: event.target.value.trim()
                              ? event.target.value
                              : null,
                          }))
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
                          setDraft((prev) => ({
                            ...prev,
                            climateChangeMitigation: event.target.value.trim()
                              ? event.target.value
                              : null,
                          }))
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
                          setDraft((prev) => ({
                            ...prev,
                            ccTopologyCode: event.target.value.trim()
                              ? event.target.value
                              : null,
                          }))
                        }
                        disabled={!canComment}
                      />
                    </div>
                  </FieldGrid>

                  <div className="space-y-2">
                    <Label htmlFor="prm-ncr-lgu-rm-objective-results-indicator">
                      PRM/NCR LGU + RM Objective + Results Indicator
                    </Label>
                    <Textarea
                      id="prm-ncr-lgu-rm-objective-results-indicator"
                      value={toInputValue(draft.prmNcrLguRmObjectiveResultsIndicator)}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          prmNcrLguRmObjectiveResultsIndicator: event.target.value.trim()
                            ? event.target.value
                            : null,
                        }))
                      }
                      className="min-h-[110px]"
                      disabled={!canComment}
                    />
                  </div>
                </>
              ) : null}

            </div>
          </div>
        </div>

        <div className="space-y-4">
          {shouldShowOfficialCommentPanel ? (
            <div className="rounded-lg border border-slate-200 bg-card p-4">
              <div className="text-sm font-semibold text-slate-900">
                Official Comment / Justification
              </div>

              {!canComment ? (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {lockedCommentMessage}
                </div>
              ) : showReasonPanel ? (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    Provide your justification before saving.
                  </p>

                  {diff.length > 0 ? (
                    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-700">
                        Detected field changes
                      </div>
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
                    onClick={() =>
                      void handleSubmit({
                        reason,
                        resolution: defaultResolution,
                        changes: patch,
                      })
                    }
                    disabled={submitting || !reason.trim() || (!hasOriginalAiIssues && !hasChanges)}
                  >
                    {submitting ? "Submitting..." : "Save Review"}
                  </Button>
                </>
              ) : (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  No issues detected. Edit one or more fields to enable the required
                  justification comment.
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-lg border bg-card border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-900">Workflow Feedback</div>
            <p className="mt-1 text-xs text-slate-500">
              Official and reviewer feedback from the AIP submission workflow.
            </p>

            <div className="mt-3 space-y-3">
              {workflowFeedbackThreads.length ? (
                workflowFeedbackThreads.map((thread) => (
                  <FeedbackThreadCard key={thread.root.id} thread={thread} />
                ))
              ) : (
                <div className="rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  No workflow feedback for this project yet.
                </div>
              )}
            </div>
          </div>

          {isPublished ? (
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Citizen Feedback</div>
              <p className="mt-1 text-xs text-slate-500">
                Citizen feedback threads for this published project. Officials can reply.
              </p>

              <div className="mt-3">
                <LguProjectFeedbackThread
                  projectId={project.id}
                  scope={scope}
                  selectedThreadId={selectedThreadId}
                  selectedFeedbackId={selectedFeedbackId}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
