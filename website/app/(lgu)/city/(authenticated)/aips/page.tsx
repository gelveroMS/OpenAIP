import { AipManagementView } from "@/features/aip";
import { getAipRepo } from "@/lib/repos/aip/repo.server";

const CityAIPS = async () => {
  let records: Awaited<ReturnType<ReturnType<typeof getAipRepo>["listVisibleAips"]>>;
  try {
    const aipRepo = getAipRepo({ defaultScope: "city" });
    records = await aipRepo.listVisibleAips({
      scope: "city",
      visibility: "my",
    });
  } catch (error) {
    console.error("[CITY_AIPS_PAGE][LIST_VISIBLE_AIPS_FAILED]", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return <AipManagementView scope="city" records={records} />;
};

export default CityAIPS;
