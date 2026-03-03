import { describe, expect, it } from "vitest";
import { listPublicAipFeedback } from "@/app/api/citizen/aips/_feedback-shared";

function createFeedbackListClient(rows: Array<Record<string, unknown>>) {
  const eqCalls: Array<[string, unknown]> = [];

  const chain = {
    data: rows,
    error: null,
    eq(column: string, value: unknown) {
      eqCalls.push([column, value]);
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
  };

  return {
    eqCalls,
    client: {
      from: () => ({
        select: () => chain,
      }),
    },
  };
}

describe("listPublicAipFeedback", () => {
  it("returns hidden feedback rows with policy placeholder text", async () => {
    const { client, eqCalls } = createFeedbackListClient([
      {
        id: "fb-hidden",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "question",
        body: "Original hidden text",
        author_id: null,
        is_public: false,
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const items = await listPublicAipFeedback(client as never, "aip-1");

    expect(items).toHaveLength(1);
    expect(items[0]?.isHidden).toBe(true);
    expect(items[0]?.body).toBe("This comment has been hidden due to policy violation.");
    expect(items[0]?.id).toBe("fb-hidden");
    expect(eqCalls).not.toContainEqual(["is_public", true]);
  });
});
