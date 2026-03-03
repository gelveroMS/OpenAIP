import { createMockAuditRepo } from "@/lib/repos/audit/repo.mock";
import { ACTIVITY_LOG_FIXTURE } from "@/mocks/fixtures/audit/activity-log.fixture";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function removeFixtureRows(ids: string[]) {
  for (let index = ACTIVITY_LOG_FIXTURE.length - 1; index >= 0; index -= 1) {
    if (ids.includes(ACTIVITY_LOG_FIXTURE[index].id)) {
      ACTIVITY_LOG_FIXTURE.splice(index, 1);
    }
  }
}

export async function runAuditAdminPaginationTests() {
  type ActivityFixtureRow = (typeof ACTIVITY_LOG_FIXTURE)[number];

  const injectedRows: ActivityFixtureRow[] = [
    {
      id: "admin_page_1",
      actorId: "citizen_for_page_1",
      actorRole: "citizen",
      action: "feedback_created",
      entityType: "feedback",
      entityId: "feedback_admin_page_1",
      scope: {
        scope_type: "barangay",
        barangay_id: "brgy_mamadid",
        city_id: null,
        municipality_id: null,
      },
      metadata: {
        actor_name: "Citizen Page One",
        details: "special search token page one",
      },
      createdAt: "2026-02-28T12:00:00.000Z",
    },
    {
      id: "admin_page_2",
      actorId: "city_for_page_2",
      actorRole: "city_official",
      action: "project_updated",
      entityType: "project",
      entityId: "project_admin_page_2",
      scope: {
        scope_type: "city",
        barangay_id: null,
        city_id: "city_001",
        municipality_id: null,
      },
      metadata: {
        actor_name: "City Page Two",
        details: "special search token page two",
      },
      createdAt: "2026-02-28T11:59:00.000Z",
    },
    {
      id: "admin_year_2025",
      actorId: "citizen_2025",
      actorRole: "citizen",
      action: "feedback_created",
      entityType: "feedback",
      entityId: "feedback_2025",
      scope: {
        scope_type: "barangay",
        barangay_id: "brgy_mamadid",
        city_id: null,
        municipality_id: null,
      },
      metadata: {
        actor_name: "Citizen 2025",
        details: "year filter seed",
      },
      createdAt: "2025-06-10T10:00:00.000Z",
    },
  ];

  ACTIVITY_LOG_FIXTURE.push(...injectedRows);

  try {
    const repo = createMockAuditRepo();

    const pageOne = await repo.listActivityPage({
      page: 1,
      pageSize: 2,
      role: "all",
      year: "all",
      event: "all",
      q: "",
    });
    const pageTwo = await repo.listActivityPage({
      page: 2,
      pageSize: 2,
      role: "all",
      year: "all",
      event: "all",
      q: "",
    });

    assert(pageOne.total === pageTwo.total, "Expected stable total across pages.");
    assert(pageOne.rows.length === 2, "Expected first page size to match.");
    assert(pageTwo.rows.length > 0, "Expected second page to have rows.");
    const pageOneIds = new Set(pageOne.rows.map((row) => row.id));
    assert(
      pageTwo.rows.every((row) => !pageOneIds.has(row.id)),
      "Expected page two to return non-overlapping rows."
    );

    const citizenOnly = await repo.listActivityPage({
      page: 1,
      pageSize: 20,
      role: "citizen",
      year: "all",
      event: "all",
      q: "",
    });
    assert(
      citizenOnly.rows.every((row) => row.actorRole === "citizen"),
      "Expected citizen role filter to return only citizen rows."
    );

    const lguOnly = await repo.listActivityPage({
      page: 1,
      pageSize: 20,
      role: "lgu_officials",
      year: "all",
      event: "all",
      q: "",
    });
    assert(
      lguOnly.rows.every(
        (row) =>
          row.actorRole === "barangay_official" ||
          row.actorRole === "city_official" ||
          row.actorRole === "municipal_official"
      ),
      "Expected LGU role filter to exclude admin/citizen rows."
    );

    const year2025 = await repo.listActivityPage({
      page: 1,
      pageSize: 20,
      role: "all",
      year: 2025,
      event: "all",
      q: "",
    });
    assert(
      year2025.rows.every((row) => new Date(row.createdAt).getUTCFullYear() === 2025),
      "Expected year filter to include only matching years."
    );

    const feedbackCreated = await repo.listActivityPage({
      page: 1,
      pageSize: 20,
      role: "all",
      year: "all",
      event: "feedback_created",
      q: "",
    });
    assert(
      feedbackCreated.rows.every((row) => row.action === "feedback_created"),
      "Expected event filter to include only matching actions."
    );

    const searched = await repo.listActivityPage({
      page: 1,
      pageSize: 20,
      role: "all",
      year: "all",
      event: "all",
      q: "special search token",
    });
    assert(
      searched.rows.length >= 2,
      "Expected search query to match multiple seeded audit rows."
    );
  } finally {
    removeFixtureRows(injectedRows.map((row) => row.id));
  }
}
