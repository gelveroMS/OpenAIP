import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseAdmin = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

import { listPublicAipFeedback } from "@/app/api/citizen/aips/_feedback-shared";

type MockRow = Record<string, unknown>;

type AdminDataset = {
  profiles: MockRow[];
  barangays: MockRow[];
  cities: MockRow[];
  municipalities: MockRow[];
  activity_log: MockRow[];
};

let adminDataset: AdminDataset;

function compareValues(left: unknown, right: unknown): number {
  const leftValue = left === null || typeof left === "undefined" ? "" : String(left);
  const rightValue = right === null || typeof right === "undefined" ? "" : String(right);
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function createThenableQuery(
  initialRows: MockRow[],
  eqCalls?: Array<[string, unknown]>
) {
  let rows = [...initialRows];

  const query = {
    eq(column: string, value: unknown) {
      if (eqCalls) eqCalls.push([column, value]);
      rows = rows.filter((row) => row[column] === value);
      return query;
    },
    in(column: string, values: unknown[]) {
      const allowed = new Set(values);
      rows = rows.filter((row) => allowed.has(row[column]));
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      const ascending = options?.ascending ?? true;
      rows = [...rows].sort((left, right) => {
        const result = compareValues(left[column], right[column]);
        return ascending ? result : -result;
      });
      return query;
    },
    then<TResult1 = { data: MockRow[]; error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: MockRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createAdminClient() {
  return {
    from(table: string) {
      return {
        select: () => {
          if (table === "profiles") return createThenableQuery(adminDataset.profiles);
          if (table === "barangays") return createThenableQuery(adminDataset.barangays);
          if (table === "cities") return createThenableQuery(adminDataset.cities);
          if (table === "municipalities") return createThenableQuery(adminDataset.municipalities);
          if (table === "activity_log") return createThenableQuery(adminDataset.activity_log);
          throw new Error(`Unexpected admin table: ${table}`);
        },
      };
    },
  };
}

function createFeedbackListClient(input: {
  feedbackRows: MockRow[];
  reviewRows?: MockRow[];
}) {
  const eqCalls: Array<[string, unknown]> = [];
  const feedbackRows = input.feedbackRows;
  const reviewRows = input.reviewRows ?? [];

  return {
    eqCalls,
    client: {
      from: (table: string) => ({
        select: () => {
          if (table === "feedback") return createThenableQuery(feedbackRows, eqCalls);
          if (table === "aip_reviews") return createThenableQuery(reviewRows);
          throw new Error(`Unexpected client table: ${table}`);
        },
      }),
    },
  };
}

describe("listPublicAipFeedback", () => {
  beforeEach(() => {
    adminDataset = {
      profiles: [],
      barangays: [],
      cities: [],
      municipalities: [],
      activity_log: [],
    };
    mockSupabaseAdmin.mockReset();
    mockSupabaseAdmin.mockImplementation(() => createAdminClient());
  });

  it("returns hidden feedback rows with policy placeholder text", async () => {
    const { client, eqCalls } = createFeedbackListClient({
      feedbackRows: [
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
      ],
      reviewRows: [],
    });

    const items = await listPublicAipFeedback(client as never, "aip-1");

    expect(items).toHaveLength(1);
    expect(items[0]?.isHidden).toBe(true);
    expect(items[0]?.body).toBe("This comment has been hidden due to policy violation.");
    expect(items[0]?.id).toBe("fb-hidden");
    expect(eqCalls).not.toContainEqual(["is_public", true]);
  });

  it("adds city revision remarks as workflow roots and threads barangay replies under them", async () => {
    adminDataset = {
      ...adminDataset,
      profiles: [
        {
          id: "city-user-1",
          full_name: "Cedie James A. City",
          role: "city_official",
          barangay_id: null,
          city_id: "city-1",
          municipality_id: null,
        },
        {
          id: "brgy-user-1",
          full_name: "Cedie James A. Brgy",
          role: "barangay_official",
          barangay_id: "brgy-1",
          city_id: null,
          municipality_id: null,
        },
      ],
      cities: [{ id: "city-1", name: "Mamatid" }],
      barangays: [{ id: "brgy-1", name: "Mamatid" }],
    };

    const { client } = createFeedbackListClient({
      feedbackRows: [
        {
          id: "fb-brgy-reply",
          target_type: "aip",
          aip_id: "aip-1",
          parent_feedback_id: null,
          kind: "lgu_note",
          body: "Fixed total mismatch",
          author_id: "brgy-user-1",
          is_public: true,
          created_at: "2026-03-22T08:28:00.000Z",
        },
      ],
      reviewRows: [
        {
          id: "review-1",
          aip_id: "aip-1",
          action: "request_revision",
          note: "Fix the total mismatch first.",
          reviewer_id: "city-user-1",
          created_at: "2026-03-22T08:26:00.000Z",
        },
      ],
    });

    const items = await listPublicAipFeedback(client as never, "aip-1");

    const root = items.find((item) => item.id === "aip-review-review-1");
    const reply = items.find((item) => item.id === "fb-brgy-reply");

    expect(root).toBeTruthy();
    expect(root?.body).toBe("Fix the total mismatch first.");
    expect(root?.parentFeedbackId).toBeNull();
    expect(root?.author.role).toBe("city_official");
    expect(root?.author.fullName).toBe("Cedie James A. City");

    expect(reply).toBeTruthy();
    expect(reply?.parentFeedbackId).toBe("aip-review-review-1");
  });

  it("maps barangay replies to the correct revision cycle boundaries", async () => {
    adminDataset = {
      ...adminDataset,
      profiles: [
        {
          id: "city-user-1",
          full_name: "City Reviewer One",
          role: "city_official",
          barangay_id: null,
          city_id: "city-1",
          municipality_id: null,
        },
        {
          id: "city-user-2",
          full_name: "City Reviewer Two",
          role: "city_official",
          barangay_id: null,
          city_id: "city-1",
          municipality_id: null,
        },
        {
          id: "brgy-user-1",
          full_name: "Barangay Official",
          role: "barangay_official",
          barangay_id: "brgy-1",
          city_id: null,
          municipality_id: null,
        },
      ],
      cities: [{ id: "city-1", name: "Mamatid" }],
      barangays: [{ id: "brgy-1", name: "Mamatid" }],
    };

    const { client } = createFeedbackListClient({
      feedbackRows: [
        {
          id: "fb-before",
          target_type: "aip",
          aip_id: "aip-1",
          parent_feedback_id: null,
          kind: "lgu_note",
          body: "Reply before revision cycle",
          author_id: "brgy-user-1",
          is_public: true,
          created_at: "2026-03-20T09:00:00.000Z",
        },
        {
          id: "fb-cycle-1",
          target_type: "aip",
          aip_id: "aip-1",
          parent_feedback_id: null,
          kind: "lgu_note",
          body: "Reply for cycle one",
          author_id: "brgy-user-1",
          is_public: true,
          created_at: "2026-03-22T10:00:00.000Z",
        },
        {
          id: "fb-cycle-2",
          target_type: "aip",
          aip_id: "aip-1",
          parent_feedback_id: null,
          kind: "lgu_note",
          body: "Reply for cycle two",
          author_id: "brgy-user-1",
          is_public: true,
          created_at: "2026-03-23T10:00:00.000Z",
        },
      ],
      reviewRows: [
        {
          id: "review-1",
          aip_id: "aip-1",
          action: "request_revision",
          note: "Cycle one note",
          reviewer_id: "city-user-1",
          created_at: "2026-03-22T08:00:00.000Z",
        },
        {
          id: "review-2",
          aip_id: "aip-1",
          action: "request_revision",
          note: "Cycle two note",
          reviewer_id: "city-user-2",
          created_at: "2026-03-23T09:00:00.000Z",
        },
      ],
    });

    const items = await listPublicAipFeedback(client as never, "aip-1");
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get("fb-before")?.parentFeedbackId).toBeNull();
    expect(byId.get("fb-cycle-1")?.parentFeedbackId).toBe("aip-review-review-1");
    expect(byId.get("fb-cycle-2")?.parentFeedbackId).toBe("aip-review-review-2");
  });

  it("uses reviewer fallback metadata when reviewer profile is missing", async () => {
    adminDataset = {
      ...adminDataset,
      profiles: [
        {
          id: "brgy-user-1",
          full_name: "Barangay Official",
          role: "barangay_official",
          barangay_id: "brgy-1",
          city_id: null,
          municipality_id: null,
        },
      ],
      barangays: [{ id: "brgy-1", name: "Mamatid" }],
    };

    const { client } = createFeedbackListClient({
      feedbackRows: [
        {
          id: "fb-brgy-reply",
          target_type: "aip",
          aip_id: "aip-1",
          parent_feedback_id: null,
          kind: "lgu_note",
          body: "Fixed issue",
          author_id: "brgy-user-1",
          is_public: true,
          created_at: "2026-03-22T08:28:00.000Z",
        },
      ],
      reviewRows: [
        {
          id: "review-1",
          aip_id: "aip-1",
          action: "request_revision",
          note: "Please fix totals.",
          reviewer_id: "missing-reviewer-profile",
          created_at: "2026-03-22T08:26:00.000Z",
        },
      ],
    });

    const items = await listPublicAipFeedback(client as never, "aip-1");
    const root = items.find((item) => item.id === "aip-review-review-1");

    expect(root).toBeTruthy();
    expect(root?.author.fullName).toBe("City Reviewer");
    expect(root?.author.role).toBe("city_official");
    expect(root?.author.roleLabel).toBe("City Official");
    expect(root?.author.lguLabel).toBe("City of Unknown");
  });
});
