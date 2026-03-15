"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Building2, ChevronDown, Heart, Search, TrendingUp } from "lucide-react";
import type { DashboardQueryState, DashboardSector, DashboardProject } from "@/features/dashboard/types/dashboard-types";
import { hasProjectErrors } from "@/features/dashboard/utils/dashboard-selectors";
import { useEffect, useMemo, useState } from "react";
import type { ProjectCategory } from "@/lib/contracts/databasev2/enums";

const TOP_FUNDED_LIMIT = 10;
const URL_SYNC_DEBOUNCE_MS = 150;

export function TopFundedProjectsSection({
  queryState,
  sectors,
  projects,
}: {
  queryState: DashboardQueryState;
  sectors: DashboardSector[];
  projects: DashboardProject[];
}) {
  const [searchText, setSearchText] = useState(queryState.tableQ);
  const [category, setCategory] = useState<ProjectCategory | "all">(queryState.tableCategory);
  const [sector, setSector] = useState<string | "all">(queryState.tableSector);

  useEffect(() => {
    setSearchText(queryState.tableQ);
  }, [queryState.tableQ]);

  useEffect(() => {
    setCategory(queryState.tableCategory);
  }, [queryState.tableCategory]);

  useEffect(() => {
    setSector(queryState.tableSector);
  }, [queryState.tableSector]);

  const rows = useMemo(
    () =>
      filterTopFundedRows(projects, {
        searchText,
        category,
        sectorCode: sector,
      }),
    [projects, searchText, category, sector]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const normalizedSearch = searchText.trim();

      if (normalizedSearch) params.set("tableQ", normalizedSearch);
      else params.delete("tableQ");

      if (category !== "all") params.set("category", category);
      else params.delete("category");

      if (sector !== "all") params.set("sector", sector);
      else params.delete("sector");

      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl !== currentUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    }, URL_SYNC_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchText, category, sector]);

  return (
    <Card className="bg-card text-card-foreground border border-border rounded-xl py-3 sm:py-4">
      <CardHeader className="grid-rows-[auto] items-center gap-0 border-b border-border px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2 leading-none text-lg font-medium text-foreground">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Top Funded Projects
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 sm:px-5">
        <TopProjectsFilters
          sectors={sectors}
          searchText={searchText}
          category={category}
          sector={sector}
          onSearchTextChange={setSearchText}
          onCategoryChange={setCategory}
          onSectorChange={setSector}
        />
        <TopProjectsTable rows={rows} sectors={sectors} />
      </CardContent>
    </Card>
  );
}

export function TopProjectsFilters({
  sectors,
  searchText,
  category,
  sector,
  onSearchTextChange,
  onCategoryChange,
  onSectorChange,
}: {
  sectors: DashboardSector[];
  searchText: string;
  category: ProjectCategory | "all";
  sector: string | "all";
  onSearchTextChange: (value: string) => void;
  onCategoryChange: (value: ProjectCategory | "all") => void;
  onSectorChange: (value: string | "all") => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="tableQ"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.currentTarget.value)}
          placeholder="Search projects..."
          className="h-10 rounded-lg border-0 bg-secondary pl-9 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>
      <div className="relative">
        <select
          name="category"
          value={category}
          onChange={(event) => onCategoryChange(parseCategoryFilter(event.currentTarget.value))}
          className="h-10 w-full appearance-none rounded-lg border-0 bg-secondary px-3 pr-8 text-sm text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <option value="all">All Categories</option>
          <option value="health">Health</option>
          <option value="infrastructure">Infrastructure</option>
          <option value="other">Other</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="relative">
        <select
          name="sector"
          value={sector}
          onChange={(event) => onSectorChange(event.currentTarget.value || "all")}
          className="h-10 w-full appearance-none rounded-lg border-0 bg-secondary px-3 pr-8 text-sm text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <option value="all">All Types</option>
          {sectors.map((sector) => (
            <option key={sector.code} value={sector.code}>{sector.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

function parseCategoryFilter(value: string): ProjectCategory | "all" {
  if (value === "health" || value === "infrastructure" || value === "other") {
    return value;
  }
  return "all";
}

function filterTopFundedRows(
  projects: DashboardProject[],
  input: { searchText: string; category: ProjectCategory | "all"; sectorCode: string | "all" }
): DashboardProject[] {
  const normalizedQuery = input.searchText.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    if (input.category !== "all" && project.category !== input.category) return false;
    if (input.sectorCode !== "all" && project.sectorCode !== input.sectorCode) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      project.programProjectDescription,
      project.aipRefCode,
      project.healthProgramName ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  return [...filtered]
    .sort((left, right) => {
      if (left.total === null && right.total === null) return 0;
      if (left.total === null) return 1;
      if (right.total === null) return -1;
      return right.total - left.total;
    })
    .slice(0, TOP_FUNDED_LIMIT);
}

function toCurrency(value: number): string {
  return value.toLocaleString("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
}

export function TopProjectsTable({
  rows,
  sectors,
}: {
  rows: DashboardProject[];
  sectors: DashboardSector[];
}) {
  const resolveRawTypeLabel = (sectorCode: string): string => sectors.find((sector) => sector.code === sectorCode)?.label ?? sectorCode;
  const resolveTypeLabel = (project: DashboardProject): "Infrastructure" | "Health" | "Others" => {
    const raw = resolveRawTypeLabel(project.sectorCode).toLowerCase();
    if (raw.includes("health") || project.category === "health") return "Health";
    if (raw.includes("infra") || project.category === "infrastructure") return "Infrastructure";
    return "Others";
  };
  const isHealthType = (typeLabel: string): boolean => /health/i.test(typeLabel);
  const resolveCategoryLabel = (project: DashboardProject): "Economic" | "Social" | "General" | "Other" => {
    const sectorLabel = resolveRawTypeLabel(project.sectorCode).toLowerCase();
    if (sectorLabel.includes("economic")) return "Economic";
    if (sectorLabel.includes("social") || project.category === "health") return "Social";
    if (sectorLabel.includes("general") || project.category === "infrastructure") return "General";
    return "Other";
  };
  const statusLabel = (project: DashboardProject): "Flagged" | "In Progress" | "Planned" => {
    if (hasProjectErrors(project.errors)) return "Flagged";
    if (project.isHumanEdited) return "In Progress";
    return "Planned";
  };
  const categoryBadgeClass = (categoryLabel: ReturnType<typeof resolveCategoryLabel>) => {
    if (categoryLabel === "Economic") return "bg-mediumseagreen-200 text-mediumseagreen-100";
    if (categoryLabel === "Social") return "bg-dodgerblue-200 text-dodgerblue-100";
    if (categoryLabel === "General") return "bg-[#DCE5E8] text-[#1A677D]";
    return "bg-secondary text-foreground";
  };

  return (
    <div className="max-h-[353.8px] max-w-full overflow-auto rounded-xl border border-border [scrollbar-width:thin]">
      <table className="w-full min-w-[620px] text-xs text-foreground sm:text-sm md:min-w-[780px]">
        <thead className="sticky top-0 z-10 bg-secondary text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Project Name</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Budget</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((project, index) => {
            const categoryLabel = resolveCategoryLabel(project);
            const typeLabel = resolveTypeLabel(project);
            return (
              <tr key={project.id} className="border-b border-border text-sm hover:bg-accent">
                <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                <td className="px-3 py-2">
                  <div className="max-w-[180px] truncate sm:max-w-[280px] md:max-w-[300px]">
                    {project.programProjectDescription}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge className={`rounded-md border border-transparent text-xs font-medium ${categoryBadgeClass(categoryLabel)}`}>
                    {categoryLabel}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge className="rounded-md border border-border bg-card text-xs text-muted-foreground">
                    {isHealthType(typeLabel) ? <Heart className="mr-1 h-3 w-3" /> : <Building2 className="mr-1 h-3 w-3" />}
                    {typeLabel}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{toCurrency(project.total ?? 0)}</td>
                <td className="px-3 py-2">
                  <Badge className="rounded-md border border-border bg-card text-muted-foreground">
                    {statusLabel(project)}
                  </Badge>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No projects match your filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
