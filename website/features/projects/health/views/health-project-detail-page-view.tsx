/**
 * Health Project Detail Page View Component
 * 
 * Comprehensive detail page for health projects.
 * Displays project information and integrates shared project updates functionality.
 * Adapts health-specific update data to the shared update interface.
 * 
 * @module feature/projects/health/health-project-detail-page-view
 */

"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { HealthProject, ProjectUpdateUi } from "@/features/projects/types";
import ProjectInformationCard from "../components/project-information-card";
import { Badge } from "@/components/ui/badge";
import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";
import { getProjectStatusBadgeClass } from "@/features/projects/utils/status-badges";
import { ProjectUpdatesSection } from "../../shared/update-view";
import { FeedbackThread, LguProjectFeedbackThread } from "../../shared/feedback";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * HealthProjectDetailPageView Component
 * 
 * Main detail view for health projects.
 * Features:
 * - Breadcrumb navigation
 * - Project title and status badge
 * - Project information card
 * - Shared project updates section (timeline + form)
 * 
 * Adapts health-specific update format to shared ProjectUpdate type
 * for compatibility with shared update components.
 * 
 * @param aipYear - The AIP year for context
 * @param project - Complete health project data
 * @param scope - Administrative scope (city or barangay)
 */
export default function HealthProjectDetailPageView({
  aipYear,
  project,
  scope = "barangay"
}: {
  aipYear: number;
  project: HealthProject;
  scope?: "city" | "barangay" | "citizen";
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = searchParams.get("tab");
  const threadId = searchParams.get("thread");
  const commentId = searchParams.get("comment");
  const updateId = searchParams.get("update");
  const activeTab = tab === "feedback" || tab === "comments" ? "feedback" : "updates";
  const projectsListHref =
    scope === "citizen" ? "/projects/health" : `/${scope}/projects/health`;

  const breadcrumb = [
    { label: "Health Project", href: projectsListHref },
    { label: "Detail & Updates", href: "#" },
  ];

  // ✅ Adapt Health updates to shared ProjectUpdate (only fields needed by shared UI)
  const initialUpdates: ProjectUpdateUi[] = (project.updates ?? []).map((u: HealthProject["updates"][number]): ProjectUpdateUi => ({
    id: u.id,
    title: u.title,
    date: u.date,
    description: u.description,
    progressPercent: u.progressPercent ?? 0,
    photoUrls: u.photoUrls,
    attendanceCount: u.attendanceCount,
    isHidden: u.isHidden,
    isRedacted: u.isRedacted,
    hiddenReason: u.hiddenReason ?? null,
    violationCategory: u.violationCategory ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-stretch sm:gap-4">
        <div className="min-w-0">
          <BreadcrumbNav items={breadcrumb} />

          <h1 className="mt-2 break-words text-2xl font-bold text-slate-900 md:text-3xl">{project.title}</h1>
        </div>

        <div className="flex flex-col items-start sm:items-end">
          <Badge variant="outline" className={`rounded-full ${getProjectStatusBadgeClass(project.status)} sm:mt-auto`}>
            {project.status}
          </Badge>
        </div>
      </div>

      <ProjectInformationCard
        aipYear={aipYear}
        project={project}
        scope={scope}
        useLogoFallback={scope === "barangay" || scope === "citizen"}
      />

      {/* ✅ Shared updates UI (timeline + form) */}
      <div className="min-w-0">
        <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              const params = new URLSearchParams(searchParams.toString());
              if (value === "feedback") {
                params.set("tab", "feedback");
                params.delete("thread");
                params.delete("comment");
                params.delete("update");
              } else {
                params.set("tab", "updates");
                params.delete("thread");
                params.delete("comment");
              }
              const query = params.toString();
              router.replace(query ? `${pathname}?${query}` : pathname, {
                scroll: false,
              });
            }}
          >
            <TabsList className="h-10 w-max min-w-max gap-2 bg-transparent p-0">
              <TabsTrigger
                value="updates"
                className="h-9 shrink-0 rounded-lg px-3 text-xs font-medium text-slate-500 data-[state=active]:border data-[state=active]:border-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-sm sm:px-4 sm:text-sm"
              >
                Updates Timeline
              </TabsTrigger>
              <TabsTrigger
                value="feedback"
                className="h-9 shrink-0 rounded-lg px-3 text-xs font-medium text-slate-500 data-[state=active]:border data-[state=active]:border-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-sm sm:px-4 sm:text-sm"
              >
                Feedback
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {activeTab === "updates" ? (
        scope === "citizen" ? (
          <ProjectUpdatesSection
            initialUpdates={initialUpdates}
            allowPosting={false}
            selectedUpdateId={updateId}
          />
        ) : (
          <ProjectUpdatesSection
            initialUpdates={initialUpdates}
            allowPosting
            projectId={project.id}
            scope={scope}
            projectKind="health"
            participantsTargetTotal={project.totalTargetParticipants ?? 0}
            selectedUpdateId={updateId}
          />
        )
      ) : (
        <div id="feedback" className="scroll-mt-24">
          {scope === "citizen" ? (
            <FeedbackThread projectId={project.id} />
          ) : (
            <LguProjectFeedbackThread
              projectId={project.id}
              scope={scope}
              selectedThreadId={threadId}
              selectedFeedbackId={commentId}
            />
          )}
        </div>
      )}

    </div>
  );
}
