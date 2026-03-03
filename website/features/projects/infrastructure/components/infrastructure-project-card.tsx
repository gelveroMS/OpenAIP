/**
 * Infrastructure Project Card Component
 * 
 * Displays a comprehensive card view for infrastructure projects.
 * Shows project image, details, timeline, contractor information, funding, and status.
 * Provides navigation to detailed project view.
 * 
 * @module feature/projects/infrastructure/infrastructure-project-card
 */

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { InfrastructureProject } from "@/features/projects/types";
import {
  CalendarDays,
  Building2,
  User,
  PhilippinePeso,
  Landmark,
  MapPin,
} from "lucide-react";
import { formatPeso } from "@/lib/formatting";
import { getProjectStatusBadgeClass } from "@/features/projects/utils/status-badges";
import {
  DEFAULT_PROJECT_IMAGE_SRC,
  PROJECT_LOGO_FALLBACK_SRC,
  resolveProjectImageSource,
} from "@/features/projects/shared/project-image";
import { toDateRangeLabel } from "@/features/projects/shared/project-date";

/**
 * InfrastructureProjectCard Component
 * 
 * Renders a detailed card for infrastructure projects including:
 * - Project image
 * - Title and description
 * - Start date and target completion
 * - Implementing office and contractor
 * - Contract cost and funding source
 * - Status badge
 * - Optional action slot for route-aware CTA
 * 
 * @param project - The infrastructure project data to display
 * @param actionSlot - Optional action element (e.g. View button)
 */
export default function InfrastructureProjectCard({ 
  project,
  actionSlot,
  useLogoFallback = true,
}: { 
  project: InfrastructureProject;
  actionSlot?: ReactNode;
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
    <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="px-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr] lg:items-stretch">
          {/* fixed image + cover */}
          <div className="relative h-[260px] w-full overflow-hidden rounded-xl bg-slate-100 lg:h-full">
                <Image
                    src={imageSrc}
                    alt={project.title}
                    fill
                    className={
                      imageSrc === PROJECT_LOGO_FALLBACK_SRC
                        ? "object-contain object-center p-6"
                        : "object-cover object-center"
                    }
                    sizes="(max-width: 1024px) 100vw, 420px"
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
          <div className="flex min-w-0 flex-col">
              <div className="rounded-xl border border-slate-200 px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-lg font-semibold leading-snug text-slate-900">
                      {project.title}
                    </h3>
                    <p className="mt-3 break-words text-sm leading-6 text-slate-600">
                      {project.description}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={`self-start rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap sm:ml-3 sm:shrink-0 ${getProjectStatusBadgeClass(project.status)}`}
                  >
                    {project.status}
                  </Badge>
                </div>

                <div className="mt-4 flex flex-col gap-2.5 text-sm text-slate-700">
                  <div className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">Date:</span>{" "}
                      <span className="font-medium">{dateRange}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">LGU:</span>{" "}
                      <span className="font-medium">{project.lguLabel ?? "N/A"}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">Office:</span>{" "}
                      <span className="font-medium">{project.implementingOffice || "N/A"}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">Contractor:</span>{" "}
                      <span className="font-medium">{project.contractorName || "N/A"}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <PhilippinePeso className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">Contract Cost:</span>{" "}
                      <span className="font-semibold text-[#022437]">
                        {project.contractCost > 0 ? formatPeso(project.contractCost) : "N/A"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-slate-500">Funding:</span>{" "}
                      <span className="font-medium">{project.fundingSource || "N/A"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {actionSlot ? <div className="flex justify-end pt-3">{actionSlot}</div> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
