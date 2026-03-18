"use client";

import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AipDetails, AipProjectDetails } from "@/features/citizen/aips/types";
import { formatCurrency } from "@/features/citizen/aips/data/aips.data";
import { FeedbackThread } from "@/features/projects/shared/feedback";

function LabelValue({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="break-words text-sm text-slate-800">{value?.trim() || "N/A"}</p>
    </div>
  );
}

export default function CitizenAipProjectDetailView({
  aip,
  project,
}: {
  aip: AipDetails;
  project: AipProjectDetails;
}) {
  const hasAiIssues = project.aiIssues.length > 0;
  const hasUnaddressedAiIssues = hasAiIssues && !project.hasLguNote;

  return (
    <section className="space-y-4 md:space-y-6 overflow-x-hidden">
      <BreadcrumbNav
        items={[
          { label: "AIPs", href: "/aips" },
          { label: `FY ${aip.fiscalYear}`, href: `/aips/${encodeURIComponent(aip.id)}` },
          { label: `Project ${project.projectRefCode}` },
        ]}
      />

      <Card className="border-slate-200">
        <CardHeader className="space-y-3 px-4 pb-3 pt-4 sm:space-y-4 sm:px-6 sm:pb-4 sm:pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                AIP Project Detail
              </p>
              <CardTitle className="break-words text-2xl text-slate-900 sm:text-3xl">{project.title}</CardTitle>
              <p className="break-words text-sm text-slate-600">{aip.lguLabel} | FY {aip.fiscalYear}</p>
            </div>

            <div className="flex min-w-0 flex-wrap gap-2">
              <Badge variant="outline" className="max-w-full break-words">{project.projectRefCode}</Badge>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 capitalize">
                {project.category}
              </Badge>
              <Badge className="max-w-full break-words bg-[#5ba6cb] text-white">{project.sector}</Badge>
            </div>
          </div>

          <p className="break-words text-sm leading-relaxed text-slate-700">{project.description}</p>
        </CardHeader>

        <CardContent className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
          <div
            className={`rounded-lg border p-4 ${
              hasAiIssues ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <p className={`text-sm font-semibold ${hasAiIssues ? "text-rose-800" : "text-emerald-800"}`}>
              {hasAiIssues
                ? "AI flagged this project for potential issues."
                : "No AI-detected issues for this project."}
            </p>
            {hasAiIssues ? (
              <>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800/90">
                  {project.aiIssues.map((issue, index) => (
                    <li key={`${issue}-${index}`}>{issue}</li>
                  ))}
                </ul>
                {hasUnaddressedAiIssues ? (
                  <p className="mt-3 text-sm font-medium text-rose-900">
                    This AI-flagged project has not been addressed by an LGU feedback note yet.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <LabelValue label="Implementing Agency" value={project.implementingAgency} />
          <LabelValue label="Source of Funds" value={project.sourceOfFunds} />
          <LabelValue label="Expected Output" value={project.expectedOutput} />
          <LabelValue
            label="Total Amount"
            value={Number.isFinite(project.totalAmount) ? formatCurrency(project.totalAmount) : null}
          />
          <LabelValue label="Start Date" value={project.startDate} />
          <LabelValue label="Completion Date" value={project.completionDate} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 md:space-y-6">
        <FeedbackThread
          projectId={project.projectId}
          rootFilter="citizen"
          title="Citizen Feedback"
          description="Citizen discussions for this AIP project."
          emptyStateText="No citizen feedback yet. Be the first to share your thoughts."
        />

        <FeedbackThread
          projectId={project.projectId}
          rootFilter="workflow"
          readOnly
          title="LGU Workflow Feedback"
          description="Official workflow feedback from the AIP submission and review process."
          emptyStateText="No workflow feedback was recorded for this project."
        />
      </div>
    </section>
  );
}
