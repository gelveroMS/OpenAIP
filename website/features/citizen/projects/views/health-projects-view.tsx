"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import CitizenExplainerCard from "@/features/citizen/components/citizen-explainer-card";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";
import HealthProjectCard from "@/features/projects/health/components/health-project-card";
import type { HealthProject } from "@/lib/repos/projects/types";
import {
  filterProjectsByScopeOption,
  filterProjectsByYearAndQuery,
  getProjectLguOptions,
  getProjectYearsDescending,
} from "@/lib/selectors/projects/project-list";
import ProjectFilters from "../components/project-filters";

type HealthProjectsViewProps = {
  projects: HealthProject[];
};

export default function HealthProjectsView({ projects }: HealthProjectsViewProps) {
  const years = useMemo(() => getProjectYearsDescending(projects), [projects]);
  const lguOptions = useMemo(() => getProjectLguOptions(projects), [projects]);

  const [yearFilter, setYearFilter] = useState<string>(String(years[0] ?? "all"));
  const [scopeFilter, setScopeFilter] = useState<string>("All LGUs");
  const [query, setQuery] = useState<string>("");

  const filteredProjects = useMemo(() => {
    const scopedProjects = filterProjectsByScopeOption(projects, scopeFilter);
    return filterProjectsByYearAndQuery(scopedProjects, { yearFilter, query });
  }, [projects, scopeFilter, yearFilter, query]);

  return (
    <section className="space-y-6">
      <CitizenPageHero
        title="Health Projects"
        subtitle="View projects focused on public health, including medical services, health facilities, and community wellness programs."
        imageSrc="/citizen-dashboard/hero2.webp"
        eyebrow="OpenAIP"
      />

      <CitizenExplainerCard title="What are Health Projects?">
        <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
          Health projects are initiatives funded by local government to improve healthcare
          access, preventive programs, and public wellness services.
        </p>
      </CitizenExplainerCard>

      <ProjectFilters
        fiscalYears={years}
        fiscalYearFilter={yearFilter}
        onFiscalYearChange={setYearFilter}
        scopeOptions={lguOptions}
        scopeFilter={scopeFilter}
        onScopeChange={setScopeFilter}
        query={query}
        onQueryChange={setQuery}
      />

      <p className="text-xs text-slate-500">
        Showing {filteredProjects.length} result{filteredProjects.length !== 1 ? "s" : ""}
      </p>

      <div className="space-y-5">
        {filteredProjects.map((project) => (
          <HealthProjectCard
            key={project.id}
            project={project}
            useLogoFallback
            actionSlot={
              <Button className="bg-[#022437] hover:bg-[#022437]/90 text-white" asChild>
                <Link href={`/projects/health/${project.id}`}>View Details</Link>
              </Button>
            }
          />
        ))}
      </div>
    </section>
  );
}
