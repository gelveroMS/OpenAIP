import { LandingContentView } from "@/features/citizen/landing-content";
import { getCachedCitizenLandingContent } from "@/lib/repos/landing-content/public-cache.server";

type DashboardSearchParams = Promise<{
  scope_type?: string;
  scope_id?: string;
  fiscal_year?: string;
}>;

const CitizenDashboardPage = async ({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) => {
  const params = await searchParams;
  const parsedFiscalYear = Number(params.fiscal_year);

  const result = await getCachedCitizenLandingContent({
    scopeType:
      params.scope_type === "city" || params.scope_type === "barangay"
        ? params.scope_type
        : null,
    scopeId: params.scope_id ?? null,
    fiscalYear:
      Number.isInteger(parsedFiscalYear) && parsedFiscalYear >= 2000 && parsedFiscalYear <= 2100
        ? parsedFiscalYear
        : null,
  });

  return <LandingContentView vm={result.vm} />;
};

export default CitizenDashboardPage;
