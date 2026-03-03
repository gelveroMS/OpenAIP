import { AipManagementView } from "@/features/aip";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getAipRepo } from "@/lib/repos/aip/repo.server";

const BarangayAIPS = async () => {
  const actor = await getActorContext();
  const aipRepo = getAipRepo({ defaultScope: "barangay" });
  const records = await aipRepo.listVisibleAips(
    { scope: "barangay", visibility: "my" },
    actor ?? undefined
  );
  return <AipManagementView scope="barangay" records={records} />;
};

export default BarangayAIPS;
