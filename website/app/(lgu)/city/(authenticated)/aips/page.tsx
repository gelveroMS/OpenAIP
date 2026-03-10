import { AipManagementView } from "@/features/aip";
import { getAipRepo } from "@/lib/repos/aip/repo.server";

const CityAIPS = async () => {
  try {
    const aipRepo = getAipRepo({ defaultScope: "city" });
    const records = await aipRepo.listVisibleAips({
      scope: "city",
      visibility: "my",
    });
    return <AipManagementView scope="city" records={records} />;
  } catch (error) {
    console.error("[CITY_AIPS_PAGE][LIST_VISIBLE_AIPS_FAILED]", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export default CityAIPS;
