import type { ActorContext } from "@/lib/domain/actor-context";
import { ACTIVITY_LOG_FIXTURE } from "@/mocks/fixtures/audit/activity-log.fixture";
import { getAuditFeedForActor } from "@/lib/repos/audit/queries";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runAuditServiceTests() {
  const admin: ActorContext = {
    userId: "admin_001",
    role: "admin",
    scope: { kind: "none" },
  };
  const barangayOfficial: ActorContext = {
    userId: "user_001",
    role: "barangay_official",
    scope: { kind: "barangay", id: "brgy_mamadid" },
  };
  const cityOfficial: ActorContext = {
    userId: "user_002",
    role: "city_official",
    scope: { kind: "city", id: "city_001" },
  };
  const citizen: ActorContext = {
    userId: "citizen_001",
    role: "citizen",
    scope: { kind: "barangay", id: "brgy_mamadid" },
  };

  const adminFeed = await getAuditFeedForActor(admin);
  const expectedAdmin = ACTIVITY_LOG_FIXTURE.filter(
    (row) => !row.action.startsWith("privileged_")
  );
  assert(
    adminFeed.length === expectedAdmin.length,
    "Expected admin to receive all non-privileged activity logs"
  );

  const barangayFeed = await getAuditFeedForActor(barangayOfficial);
  const expectedBarangay = ACTIVITY_LOG_FIXTURE.filter(
    (row) =>
      row.actorRole === "barangay_official" &&
      row.scope?.scope_type === "barangay" &&
      row.scope.barangay_id === "brgy_mamadid"
  );
  assert(
    barangayFeed.length === expectedBarangay.length,
    "Expected barangay official to receive same-barangay barangay-official activity logs"
  );
  assert(
    barangayFeed.some((row) => row.actorId !== barangayOfficial.userId),
    "Expected barangay feed to include co-official actions in the same barangay"
  );
  assert(
    barangayFeed.every((row) => row.scope?.scope_type === "barangay"),
    "Expected barangay feed to include only barangay-scoped activity rows"
  );
  assert(
    barangayFeed.every((row) => row.scope?.barangay_id === "brgy_mamadid"),
    "Expected barangay feed to exclude other barangays"
  );

  type ActivityFixtureRow = (typeof ACTIVITY_LOG_FIXTURE)[number];
  const cityVisibilityRows: ActivityFixtureRow[] = [
    {
      id: "city_visibility_same_city",
      actorId: "user_city_peer",
      actorRole: "city_official",
      action: "published",
      entityType: "aips",
      entityId: "aip-city-same-1",
      scope: {
        scope_type: "city",
        barangay_id: null,
        city_id: "city_001",
        municipality_id: null,
      },
      metadata: { source: "workflow" },
      createdAt: "2026-02-28T03:00:00.000Z",
    },
    {
      id: "city_visibility_other_city",
      actorId: "user_city_other",
      actorRole: "city_official",
      action: "published",
      entityType: "aips",
      entityId: "aip-city-other-1",
      scope: {
        scope_type: "city",
        barangay_id: null,
        city_id: "city_002",
        municipality_id: null,
      },
      metadata: { source: "workflow" },
      createdAt: "2026-02-28T02:59:00.000Z",
    },
  ];

  ACTIVITY_LOG_FIXTURE.push(...cityVisibilityRows);
  try {
    const cityFeed = await getAuditFeedForActor(cityOfficial);
    const cityIds = new Set(cityFeed.map((row) => row.id));

    assert(
      cityIds.has("city_visibility_same_city"),
      "Expected city official feed to include same-city co-official actions"
    );
    assert(
      !cityIds.has("city_visibility_other_city"),
      "Expected city official feed to exclude logs from other cities"
    );
    assert(
      cityFeed.every(
        (row) =>
          row.actorRole === "city_official" &&
          row.scope?.scope_type === "city" &&
          row.scope.city_id === "city_001"
      ),
      "Expected city official feed to contain only city-official logs from the same city"
    );
  } finally {
    for (let index = ACTIVITY_LOG_FIXTURE.length - 1; index >= 0; index -= 1) {
      if (cityVisibilityRows.some((row) => row.id === ACTIVITY_LOG_FIXTURE[index].id)) {
        ACTIVITY_LOG_FIXTURE.splice(index, 1);
      }
    }
  }

  const citizenFeed = await getAuditFeedForActor(citizen);
  assert(citizenFeed.length === 0, "Expected citizen to receive no activity logs");

  const privilegedRows: ActivityFixtureRow[] = [
    {
      id: "privileged_hidden_admin",
      actorId: "admin_001",
      actorRole: "admin",
      action: "privileged_chat_quota_consumed",
      entityType: "profiles",
      entityId: "citizen_001",
      scope: {
        scope_type: "none",
        barangay_id: null,
        city_id: null,
        municipality_id: null,
      },
      metadata: {
        source: "privileged",
      },
      createdAt: "2026-02-28T04:00:00.000Z",
    },
    {
      id: "privileged_hidden_barangay",
      actorId: "user_001",
      actorRole: "barangay_official",
      action: "privileged_project_media_uploaded",
      entityType: "projects",
      entityId: "project-001",
      scope: {
        scope_type: "barangay",
        barangay_id: "brgy_mamadid",
        city_id: null,
        municipality_id: null,
      },
      metadata: {
        source: "privileged",
      },
      createdAt: "2026-02-28T04:01:00.000Z",
    },
  ];

  ACTIVITY_LOG_FIXTURE.push(...privilegedRows);
  try {
    const adminWithPrivileged = await getAuditFeedForActor(admin);
    assert(
      !adminWithPrivileged.some((row) => row.id === "privileged_hidden_admin"),
      "Expected admin feed to suppress privileged_* rows"
    );

    const barangayWithPrivileged = await getAuditFeedForActor(barangayOfficial);
    assert(
      !barangayWithPrivileged.some((row) => row.id === "privileged_hidden_barangay"),
      "Expected barangay feed to suppress privileged_* rows"
    );
  } finally {
    for (let index = ACTIVITY_LOG_FIXTURE.length - 1; index >= 0; index -= 1) {
      if (privilegedRows.some((row) => row.id === ACTIVITY_LOG_FIXTURE[index].id)) {
        ACTIVITY_LOG_FIXTURE.splice(index, 1);
      }
    }
  }
}

