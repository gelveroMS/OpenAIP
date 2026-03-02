/**
 * Health Project Information Card Component
 * 
 * Displays detailed information about a health project in a card format.
 * Includes project image, description, and key metrics.
 * Provides navigation to add additional information.
 * 
 * @module feature/projects/health/project-information-card
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { HealthProject } from "@/features/projects/types";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Users, Hash, Building2, Calendar, DollarSign, Plus, MapPin } from "lucide-react";
import Link from "next/link";
import { formatPeso } from "@/lib/formatting";
import { PRIMARY_BUTTON_CLASS } from "@/constants/theme";
import {
  DEFAULT_PROJECT_IMAGE_SRC,
  PROJECT_LOGO_FALLBACK_SRC,
  resolveProjectImageSource,
} from "@/features/projects/shared/project-image";
import { toDateRangeLabel } from "@/features/projects/shared/project-date";

/**
 * ProjectInformationCard Component (Health)
 * 
 * Displays comprehensive project information including:
 * - Project image
 * - Title and description
 * - Target participants (specific and total)
 * - Implementing office
 * - Schedule/date information
 * - Budget allocation
 * - Add Information action button
 * 
 * @param aipYear - The AIP year for context
 * @param project - Complete health project data
 * @param scope - Administrative scope (city or barangay) for routing
 */
export default function ProjectInformationCard({
  project,
  scope = "barangay",
  useLogoFallback = true,
}: {
  aipYear: number;
  project: HealthProject;
  scope?: "city" | "barangay" | "citizen";
  useLogoFallback?: boolean;
}) {
  const [imageSrc, setImageSrc] = useState<string>(
    () =>
      resolveProjectImageSource(project.imageUrl, {
        useLogoFallback,
        defaultSource: DEFAULT_PROJECT_IMAGE_SRC,
      }) ?? DEFAULT_PROJECT_IMAGE_SRC
  );

  useEffect(() => {
    setImageSrc(
      resolveProjectImageSource(project.imageUrl, {
        useLogoFallback,
        defaultSource: DEFAULT_PROJECT_IMAGE_SRC,
      }) ?? DEFAULT_PROJECT_IMAGE_SRC
    );
  }, [project.imageUrl, useLogoFallback]);

  const healthDate =
    toDateRangeLabel(project.startDate, project.targetCompletionDate) ?? "N/A";

  return (
    <Card className="border-slate-200">
      <CardContent className="px-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Project Information</h2>
          {scope !== "citizen" ? (
            <Button asChild className={PRIMARY_BUTTON_CLASS}>
              <Link href={`/${scope}/projects/health/${project.id}/add-information`}>
                <Plus className="w-4 h-4 mr-2" />
                Add Information
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Project Image */}
          <div className="lg:w-96 shrink-0">
            <div className="relative w-full aspect-4/3 rounded-lg overflow-hidden">
              <Image
                src={imageSrc}
                alt={project.title}
                fill
                className="object-cover"
                onError={() => {
                  if (!useLogoFallback) return;
                  setImageSrc((current) =>
                    current === PROJECT_LOGO_FALLBACK_SRC
                      ? current
                      : PROJECT_LOGO_FALLBACK_SRC
                  );
                }}
              />
            </div>
          </div>

          {/* Project Details */}
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-slate-900 mb-3">
              {project.title}
            </h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {project.description || "No description available."}
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Target Participants:</span>
                <span className="font-medium text-slate-900">{project.targetParticipants ?? "N/A"}</span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Hash className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Total:</span>
                <span className="font-medium text-slate-900">
                  {project.totalTargetParticipants?.toLocaleString() ?? "N/A"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Building2 className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Office:</span>
                <span className="font-medium text-slate-900">
                  {project.implementingOffice || "Barangay Health Office"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">LGU:</span>
                <span className="font-medium text-slate-900">
                  {project.lguLabel ?? "N/A"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Date:</span>
                <span className="font-medium text-slate-900">
                  {healthDate}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <DollarSign className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Budget:</span>
                <span className="font-semibold text-[#022437]">
                  {project.budgetAllocated != null ? formatPeso(project.budgetAllocated) : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
