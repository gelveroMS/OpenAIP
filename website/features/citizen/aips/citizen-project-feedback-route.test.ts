import { describe, expect, it } from "vitest";
import { resolveProjectByIdOrRef } from "@/app/api/citizen/feedback/_shared";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const AIP_ID = "22222222-2222-4222-8222-222222222222";
type ProjectLookupClient = Parameters<typeof resolveProjectByIdOrRef>[0];

type MockProjectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  category: "health" | "infrastructure" | "other";
  created_at: string;
};

type MockAipRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
};

function createFeedbackLookupClient(input: {
  project: MockProjectRow | null;
  aip: MockAipRow | null;
}) {
  return {
    from(table: string) {
      if (table === "projects") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (column !== "id") {
                  return { data: null, error: { message: "Unsupported projects filter" } };
                }

                if (!input.project || input.project.id !== value) {
                  return { data: null, error: null };
                }

                return { data: input.project, error: null };
              },
            }),
          }),
        };
      }

      if (table === "aips") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (column !== "id") {
                  return { data: null, error: { message: "Unsupported aips filter" } };
                }

                if (!input.aip || input.aip.id !== value) {
                  return { data: null, error: null };
                }

                return { data: input.aip, error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("Citizen project feedback lookup", () => {
  it("accepts published projects with category 'other'", async () => {
    const client = createFeedbackLookupClient({
      project: {
        id: PROJECT_ID,
        aip_id: AIP_ID,
        aip_ref_code: "1000-001-000-001",
        category: "other",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      aip: {
        id: AIP_ID,
        status: "published",
      },
    });

    const resolved = await resolveProjectByIdOrRef(
      client as unknown as ProjectLookupClient,
      PROJECT_ID
    );

    expect(resolved.id).toBe(PROJECT_ID);
    expect(resolved.aipId).toBe(AIP_ID);
    expect(resolved.category).toBe("other");
    expect(resolved.aipStatus).toBe("published");
  });
});
