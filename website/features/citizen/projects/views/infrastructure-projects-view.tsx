"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import CitizenExplainerCard from "@/features/citizen/components/citizen-explainer-card";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";
import InfrastructureProjectCard from "@/features/projects/infrastructure/components/infrastructure-project-card";
import type { InfrastructureProject } from "@/lib/repos/projects/types";
import {
  filterProjectsByScopeOption,
  filterProjectsByYearAndQuery,
  getProjectLguOptions,
  getProjectYearsDescending,
} from "@/lib/selectors/projects/project-list";
import ProjectFilters from "../components/project-filters";

type InfrastructureProjectsViewProps = {
  projects: InfrastructureProject[];
};

export default function InfrastructureProjectsView({
  projects,
}: InfrastructureProjectsViewProps) {
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
        title="Infrastructure Projects"
        subtitle="Explore infrastructure projects funded by AIPs, including roads, drainage, public facilities, and community upgrades."
        imageSrc="/citizen-dashboard/hero2.webp"
        eyebrow="OpenAIP"
      />

      <CitizenExplainerCard title="What are Infrastructure Projects?">
        <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
          Infrastructure projects cover public works and facilities that improve safety, mobility,
          and access to essential services across communities.
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
          <InfrastructureProjectCard
            key={project.id}
            project={project}
            useLogoFallback
            actionSlot={
              <Button className="bg-[#022437] hover:bg-[#022437]/90 text-white" asChild>
                <Link href={`/projects/infrastructure/${project.id}`}>View Details</Link>
              </Button>
            }
          />
        ))}
      </div>
    </section>
  );
}
