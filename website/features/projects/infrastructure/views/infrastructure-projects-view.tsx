/**
 * Infrastructure Projects View Component
 * 
 * Main listing and management interface for infrastructure projects.
 * Provides filtering, searching, and overview of all infrastructure initiatives
 * under the Annual Investment Program.
 * 
 * @module feature/projects/infrastructure/infrastructure-projects-view
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import InfrastructureProjectCard from "../components/infrastructure-project-card";
import type { InfrastructureProject } from "@/features/projects/types";
import { Search } from "lucide-react";
import {
  filterProjectsByYearAndQuery,
  getProjectYearsDescending,
} from "@/lib/selectors/projects/project-list";

/**
 * InfrastructureProjectsView Component
 * 
 * Displays and manages the list of infrastructure projects.
 * Features:
 * - Year-based filtering
 * - Full-text search (title, description, office, contractor, funding)
 * - Project count display
 * - Responsive card-based layout
 * - Breadcrumb navigation
 * 
 * @param projects - Array of infrastructure projects to display
 * @param scope - Administrative scope (city or barangay)
 */
export default function InfrastructureProjectsView({
  projects,
  scope = "barangay"
}: {
  projects: InfrastructureProject[];
  scope?: "city" | "barangay";
}) {
  const years = useMemo(() => getProjectYearsDescending(projects), [projects]);

  const [year, setYear] = useState<string>(String(years[0] ?? "all"));
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(
    () => filterProjectsByYearAndQuery(projects, { yearFilter: year, query }),
    [projects, year, query]
  );

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden md:space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-slate-400">
        Projects / <span className="text-slate-600">Infrastructure Project</span>
      </div>

      {/* Header */}
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-slate-900 md:text-3xl">Infrastructure Project</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage, monitor, and update infrastructure programs and initiatives under the Annual Investment Program.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl px-0 py-1 sm:py-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)] md:items-end md:gap-4 lg:ml-auto lg:w-fit lg:grid-cols-[140px_420px]">
          <div className="w-full space-y-2">
            <div className="text-xs text-slate-500">Filter by Year</div>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full min-w-0 space-y-2 md:w-auto lg:w-[420px]">
            <div className="text-xs text-slate-500">Search Projects</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by project name or keyword"
                className="h-11 w-full border-slate-200 bg-white pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm text-slate-500">Showing {filtered.length} projects</div>

      {/* List */}
      <div className="space-y-4 md:space-y-5">
        {filtered.map((p) => (
          <InfrastructureProjectCard
            key={p.id}
            project={p}
            useLogoFallback={scope === "barangay"}
            actionSlot={
              <Button className="bg-[#022437] hover:bg-[#022437]/90" asChild>
                <Link href={`/${scope}/projects/infrastructure/${p.id}`}>View Project</Link>
              </Button>
            }
          />
        ))}
      </div>
    </div>
  );
}
