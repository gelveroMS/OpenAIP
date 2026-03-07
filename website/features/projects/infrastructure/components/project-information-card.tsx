/**
 * Infrastructure Project Information Card Component
 * 
 * Displays detailed information about an infrastructure project in a card format.
 * Includes project image, description, and key metrics specific to infrastructure.
 * Provides navigation to add additional information.
 * 
 * @module feature/projects/infrastructure/project-information-card
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { InfrastructureProject } from "@/features/projects/types";
import Image from "next/image";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  User,
  Calendar,
  PhilippinePeso,
  Landmark,
  Plus,
  MapPin,
} from "lucide-react";
import { formatPeso } from "@/lib/formatting";
import { PRIMARY_BUTTON_CLASS } from "@/constants/theme";
import {
  DEFAULT_PROJECT_IMAGE_SRC,
  PROJECT_LOGO_FALLBACK_SRC,
  resolveProjectImageSource,
} from "@/features/projects/shared/project-image";
import { toDateRangeLabel } from "@/features/projects/shared/project-date";
import { isProjectMediaProxyUrl } from "@/lib/projects/media";

/**
 * InfrastructureProjectInformationCard Component
 * 
 * Displays comprehensive infrastructure project information including:
 * - Project image
 * - Description
 * - Implementing office
 * - Contractor name
 * - Start date and target completion
 * - Funding source
 * - Contract cost
 * - Add Information action button
 * 
 * @param aipYear - The AIP year for context
 * @param project - Complete infrastructure project data
 * @param scope - Administrative scope (city or barangay) for routing
 */
export default function InfrastructureProjectInformationCard({
  project,
  scope = "barangay",
  useLogoFallback = true,
}: {
  aipYear: number;
  project: InfrastructureProject;
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

  const dateRange = toDateRangeLabel(project.startDate, project.targetCompletionDate) ?? "N/A";

  return (
    <Card className="border-slate-200">
      <CardContent className="px-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Project Information</h2>
          {scope !== "citizen" ? (
            <Button asChild className={PRIMARY_BUTTON_CLASS}>
              <Link href={`/${scope}/projects/infrastructure/${project.id}/add-information`}>
                <Plus className="w-4 h-4 mr-2" />
                Add Information
              </Link>
            </Button>
          ) : null}

        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Project Image */}
          <div className="lg:w-96 shrink-0">
            <div className="relative w-full aspect-4/3 rounded-lg overflow-hidden bg-slate-100">
              <Image
                src={imageSrc}
                alt={project.title}
                fill
                className="object-cover object-center"
                sizes="(min-width: 1024px) 384px, 100vw"
                unoptimized={isProjectMediaProxyUrl(imageSrc) ? true : undefined}
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

            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {project.description ||
                "Infrastructure project aimed at improving community access, safety, and quality of public facilities."}
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Building2 className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Implementing Office:</span>
                <span className="font-medium text-slate-900">
                  {project.implementingOffice || (scope === "city" ? "City Engineering Office" : "Barangay Engineering Office")}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <User className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Contractor:</span>
                <span className="font-medium text-slate-900">
                  {project.contractorName || "N/A"}
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
                  {dateRange}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Landmark className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Funding Source:</span>
                <span className="font-medium text-slate-900">
                  {project.fundingSource || "N/A"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <PhilippinePeso className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">Contract Cost:</span>
                <span className="font-semibold text-[#022437]">
                  {project.contractCost != null ? formatPeso(project.contractCost) : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
