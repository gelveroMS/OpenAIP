import CitizenBudgetAllocationView from "@/features/citizen/budget-allocation/views/budget-allocation-view";
import { getCitizenBudgetAllocationInitialPayload } from "@/lib/repos/citizen-budget-allocation/repo.server";

const CitizenBudgetAllocationPage = async () => {
  const initialData = await getCitizenBudgetAllocationInitialPayload();

  return <CitizenBudgetAllocationView initialData={initialData} />;
};

export default CitizenBudgetAllocationPage;
