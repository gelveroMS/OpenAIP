/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const rootDir = path.resolve(__dirname, "..", "..");
const serverOnlyShim = path.join(__dirname, "server-only-shim.js");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === "server-only") {
    return serverOnlyShim;
  }
  if (request.startsWith("@/")) {
    const mapped = path.join(rootDir, request.slice(2));
    return originalResolve.call(this, mapped, parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

function registerTypeScriptExtension(ext) {
  require.extensions[ext] = function compile(module, filename) {
    const ts = require("typescript");
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    });
    module._compile(output.outputText, filename);
  };
}

registerTypeScriptExtension(".ts");
registerTypeScriptExtension(".tsx");

const { createMockFeedbackRepo } = require("@/lib/repos/feedback/repo.mock");
const { createMockChatRepo } = require("@/lib/repos/chat/repo.mock");
const { projectService } = require("@/lib/repos/projects/queries");
const { getProjectsRepo } = require("@/lib/repos/projects/repo.server");
const { mapUserToActorContext } = require("@/lib/domain/actor-context");
const {
  createMockFeedbackThreadsRepo: createMockFeedbackThreadRepo,
} = require("@/lib/repos/feedback/repo.mock");
const { listComments } = require("@/lib/repos/feedback/legacy");
const {
  runCommentRepoSelectorTests,
} = require("@/tests/repo-smoke/feedback/commentRepo.selector.test");
const {
  runCommentThreadHighlightTests,
} = require("@/tests/repo-smoke/feedback/commentThread.highlight.test");
const {
  runCommentThreadAccordionListTests,
} = require("@/tests/repo-smoke/feedback/commentThreadAccordionList.test");
const {
  runFeedbackDedupeTests,
} = require("@/tests/repo-smoke/feedback/dedupe.test");
const {
  runFeedbackInboxFilterTests,
} = require("@/tests/repo-smoke/feedback/inbox-filter.test");
const {
  runFeedbackRouteTargetTests,
} = require("@/tests/repo-smoke/feedback/feedback-route-targets.test");
const {
  runFeedbackCommentReplyAuditLogTests,
} = require("@/tests/repo-smoke/feedback/comment-reply-activity-log.test");
const {
  runProjectMapperTests,
} = require("@/tests/repo-smoke/projects/projects.mappers.test");
const {
  runProjectRepoTests,
} = require("@/tests/repo-smoke/projects/projects.repo.mock.test");
const {
  runDashboardRepoSelectorTests,
} = require("@/tests/repo-smoke/dashboard/dashboard.repo.selector.test");
const {
  runDashboardMapperTests,
} = require("@/tests/repo-smoke/dashboard/dashboard.mappers.test");
const {
  runDashboardProjectUpdateLogsTests,
} = require("@/tests/repo-smoke/dashboard/dashboard.project-update-logs.test");
const {
  runChatRepoTests,
} = require("@/tests/repo-smoke/chat/chat.repo.mock.test");
const {
  runAuditServiceTests,
} = require("@/tests/repo-smoke/audit/audit.queries.test");
const {
  runAuditCrudDedupeTests,
} = require("@/tests/repo-smoke/audit/audit.dedupe.test");
const {
  runAuditAdminPaginationTests,
} = require("@/tests/repo-smoke/audit/audit.admin-pagination.test");
const {
  getAuditFeedForActor,
} = require("@/lib/repos/audit/queries");
const {
  ACTIVITY_LOG_FIXTURE,
} = require("@/mocks/fixtures/audit/activity-log.fixture");
const {
  runSubmissionsServiceTests,
} = require("@/tests/repo-smoke/submissions/submissions.queries.test");
const {
  runSubmissionsReviewRepoTests,
} = require("@/tests/repo-smoke/submissions/submissions.repo.mock.test");
const {
  runLandingContentRepoMockTests,
} = require("@/tests/repo-smoke/landing-content/landing-content.repo.mock.test");
const {
  runLandingContentViewSmokeTests,
} = require("@/tests/repo-smoke/landing-content/landing-content.view-smoke.test");
const {
  getCitySubmissionsFeedForActor,
} = require("@/lib/repos/submissions/queries");
const {
  runRepoSelectorOverrideTests,
} = require("@/tests/repo-smoke/shared/selector.override.test");
const { getCommentRepo } = require("@/lib/repos/feedback/repo.server");
const { getFeedbackRepo } = require("@/lib/repos/feedback/repo.server");
const { getFeedbackThreadsRepo } = require("@/lib/repos/feedback/repo.server");
const { getCommentTargetLookup } = require("@/lib/repos/feedback/repo.server");
const { getAuditRepo } = require("@/lib/repos/audit/repo.server");
const { getChatRepo } = require("@/lib/repos/chat/repo.server");
const { getAdminDashboardRepo } = require("@/lib/repos/admin-dashboard/repo");
const { getAipMonitoringRepo } = require("@/lib/repos/aip-monitoring/repo");
const { getFeedbackModerationRepo } = require("@/lib/repos/feedback-moderation/repo");
const {
  getFeedbackModerationProjectUpdatesRepo,
} = require("@/lib/repos/feedback-moderation-project-updates/repo");
const { getUsageControlsRepo } = require("@/lib/repos/usage-controls/repo");
const {
  getSystemAdministrationRepo,
} = require("@/lib/repos/system-administration/repo");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests(testCases) {
  let failures = 0;

  for (const testCase of testCases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`FAIL ${testCase.name}: ${message}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

const tests = [
  {
    name: "ProjectsRepo.listByAip returns array",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      process.env.NEXT_PUBLIC_APP_ENV = "dev";
      try {
        const repo = getProjectsRepo();
        const result = await repo.listByAip("unknown");
        assert(Array.isArray(result), "Expected array result");
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
      }
    },
  },
  {
    name: "ProjectsRepo.getById unknown returns null",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      process.env.NEXT_PUBLIC_APP_ENV = "dev";
      try {
        const repo = getProjectsRepo();
        const result = await repo.getById("unknown");
        assert(result === null, "Expected null for unknown project id");
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
      }
    },
  },
  {
    name: "FeedbackRepo.listForAip returns array",
    async run() {
      const repo = createMockFeedbackRepo();
      const result = await repo.listForAip("unknown");
      assert(Array.isArray(result), "Expected array result");
    },
  },
  {
    name: "FeedbackRepo.update unknown returns null",
    async run() {
      const repo = createMockFeedbackRepo();
      const result = await repo.update("unknown", { body: "noop" });
      assert(result === null, "Expected null for unknown feedback id");
    },
  },
  {
    name: "ChatRepo.appendUserMessage increases message count",
    async run() {
      const repo = createMockChatRepo();
      const session = await repo.createSession("user_001");
      const before = await repo.listMessages(session.id);
      await repo.appendUserMessage(session.id, "hello");
      const after = await repo.listMessages(session.id);
      assert(
        after.length === before.length + 1,
        "Expected message count to increase by 1"
      );
    },
  },
  {
    name: "ChatRepo.getSession unknown returns null",
    async run() {
      const repo = createMockChatRepo();
      const result = await repo.getSession("unknown");
      assert(result === null, "Expected null for unknown session id");
    },
  },
  {
    name: "projectService.getHealthProjects returns expected count",
    async run() {
      const results = await projectService.getHealthProjects();
      assert(Array.isArray(results), "Expected array result");
      assert(results.length === 8, "Expected 8 health projects from mock data");
    },
  },
  {
    name: "projectService publishedOnly filters health/infrastructure counts",
    async run() {
      const healthResults = await projectService.getHealthProjects({ publishedOnly: true });
      const infraResults = await projectService.getInfrastructureProjects({ publishedOnly: true });
      assert(healthResults.length === 4, "Expected 4 published health projects from mock data");
      assert(
        infraResults.length === 5,
        "Expected 5 published infrastructure projects from mock data"
      );
    },
  },
  {
    name: "projectService publishedOnly hides non-published direct project access",
    async run() {
      const hidden = await projectService.getHealthProjectById("PROJ-H-2026-001", {
        publishedOnly: true,
      });
      const visible = await projectService.getHealthProjectById("PROJ-H-2026-002", {
        publishedOnly: true,
      });
      assert(hidden === null, "Expected non-published project to be hidden");
      assert(visible?.id === "PROJ-H-2026-002", "Expected published project to remain visible");
    },
  },
  {
    name: "getProjectsRepo dev defaults to mock",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      process.env.NEXT_PUBLIC_APP_ENV = "dev";
      try {
        const repo = getProjectsRepo();
        assert(!!repo, "Expected repo instance in dev");
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
      }
    },
  },
  {
    name: "getProjectsRepo staging returns concrete adapter",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      const oldUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;
      process.env.NEXT_PUBLIC_APP_ENV = "staging";
      process.env.NEXT_PUBLIC_USE_MOCKS = "false";
      try {
        const repo = getProjectsRepo();
        assert(
          typeof repo.listByAip === "function" &&
            typeof repo.getById === "function" &&
            typeof repo.listHealth === "function" &&
            typeof repo.listInfrastructure === "function" &&
            typeof repo.getByRefCode === "function",
          "Expected staging/no-mock selector to return a concrete projects repo adapter"
        );
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
        process.env.NEXT_PUBLIC_USE_MOCKS = oldUseMocks;
      }
    },
  },
  {
    name: "mapUserToActorContext barangay_official maps barangay scope",
    async run() {
      const user = {
        userId: "user_001",
        userRole: "barangay_official",
        scope: { barangay_id: "uuid" },
      };
      const result = mapUserToActorContext(user);
      assert(result?.scope.kind === "barangay", "Expected barangay scope");
      assert(result?.scope.id === "uuid", "Expected barangay id to match");
    },
  },
  {
    name: "mapUserToActorContext admin maps none scope",
    async run() {
      const user = { userId: "admin_001", userRole: "admin" };
      const result = mapUserToActorContext(user);
      assert(result?.scope.kind === "none", "Expected none scope for admin");
    },
  },
  {
    name: "mapUserToActorContext city_official maps city scope",
    async run() {
      const user = {
        userId: "user_002",
        userRole: "city_official",
        scope: { city_id: "city-123" },
      };
      const result = mapUserToActorContext(user);
      assert(result?.scope.kind === "city", "Expected city scope");
      assert(result?.scope.id === "city-123", "Expected city id to match");
    },
  },
  {
    name: "mapUserToActorContext missing required id returns null",
    async run() {
      const user = { userId: "user_003", userRole: "city_official" };
      const result = mapUserToActorContext(user);
      assert(result === null, "Expected null when required id is missing");
    },
  },
  {
    name: "FeedbackRepo.createReply enforces parent target invariant",
    async run() {
      const repo = createMockFeedbackThreadRepo();
      const root = await repo.createRoot({
        target: { target_type: "aip", aip_id: "A1" },
        body: "root",
        authorId: "user_1",
      });

      let threw = false;
      try {
        await repo.createReply({
          parentId: root.id,
          body: "reply",
          authorId: "user_2",
          target: { target_type: "aip", aip_id: "A2" },
        });
      } catch (error) {
        threw = /reply feedback must match parent target/i.test(
          error instanceof Error ? error.message : String(error)
        );
      }
      assert(threw, "Expected reply target mismatch to throw");
    },
  },
  {
    name: "FeedbackRepo.listThreadMessages preserves chronological order",
    async run() {
      const repo = createMockFeedbackThreadRepo();
      const messages = await repo.listThreadMessages("thread_002");
      assert(messages.length >= 2, "Expected seeded replies for thread_002");
      for (let i = 1; i < messages.length; i += 1) {
        assert(
          new Date(messages[i - 1].created_at).getTime() <=
            new Date(messages[i].created_at).getTime(),
          "Expected messages sorted oldest to newest"
        );
      }
    },
  },
  {
    name: "comments.service listComments preserves latest-first ordering",
    async run() {
      const result = await listComments();
      const items = result.items;
      for (let i = 1; i < items.length; i += 1) {
        assert(
          new Date(items[i - 1].created_at).getTime() >=
            new Date(items[i].created_at).getTime(),
          "Expected comments sorted newest to oldest"
        );
      }
    },
  },
  {
    name: "getCommentRepo selector supports non-mock mode",
    async run() {
      await runCommentRepoSelectorTests();
    },
  },
  {
    name: "shared selector override forces mocks",
    async run() {
      await runRepoSelectorOverrideTests();
    },
  },
  {
    name: "no-mock gate: in-scope repo selectors instantiate in staging",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      const oldUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;

      process.env.NEXT_PUBLIC_APP_ENV = "staging";
      process.env.NEXT_PUBLIC_USE_MOCKS = "false";

      try {
        const checks = [
          {
            label: "ProjectsRepo",
            repo: getProjectsRepo(),
            methods: ["listByAip", "getById", "listHealth", "listInfrastructure", "getByRefCode"],
          },
          {
            label: "CommentRepo(server)",
            repo: getCommentRepo(),
            methods: ["listThreadsForInbox", "getThread", "listMessages", "addReply"],
          },
          {
            label: "CommentTargetLookup(server)",
            repo: getCommentTargetLookup(),
            methods: ["getProject", "getAip", "getAipItem"],
          },
          {
            label: "FeedbackRepo(server)",
            repo: getFeedbackRepo(),
            methods: ["listForAip", "listForProject", "createForAip", "createForProject", "reply"],
          },
          {
            label: "FeedbackThreadsRepo(server)",
            repo: getFeedbackThreadsRepo(),
            methods: ["listThreadRootsByTarget", "listThreadMessages", "createRoot", "createReply"],
          },
          {
            label: "AuditRepo(server)",
            repo: getAuditRepo(),
            methods: [
              "listMyActivity",
              "listBarangayOfficialActivity",
              "listCityOfficialActivity",
              "listAllActivity",
              "listActivityPage",
            ],
          },
          {
            label: "ChatRepo(server)",
            repo: getChatRepo(),
            methods: [
              "listSessions",
              "getSession",
              "createSession",
              "renameSession",
              "deleteSession",
              "listMessages",
              "appendUserMessage",
            ],
          },
          {
            label: "AdminDashboardRepo",
            repo: getAdminDashboardRepo(),
            methods: [
              "getSummary",
              "getAipStatusDistribution",
              "getReviewBacklog",
              "getUsageMetrics",
              "getRecentActivity",
              "listLguOptions",
            ],
          },
          {
            label: "AipMonitoringRepo",
            repo: getAipMonitoringRepo(),
            methods: ["getSeedData"],
          },
          {
            label: "FeedbackModerationRepo",
            repo: getFeedbackModerationRepo(),
            methods: ["listDataset", "hideFeedback", "unhideFeedback"],
          },
          {
            label: "FeedbackModerationProjectUpdatesRepo",
            repo: getFeedbackModerationProjectUpdatesRepo(),
            methods: ["getSeedData", "hideUpdate", "unhideUpdate"],
          },
          {
            label: "UsageControlsRepo",
            repo: getUsageControlsRepo(),
            methods: [
              "getRateLimitSettings",
              "updateRateLimitSettings",
              "getChatbotMetrics",
              "getChatbotRateLimitPolicy",
              "updateChatbotRateLimitPolicy",
              "listFlaggedUsers",
              "getUserAuditHistory",
              "temporarilyBlockUser",
              "unblockUser",
            ],
          },
          {
            label: "SystemAdministrationRepo",
            repo: getSystemAdministrationRepo(),
            methods: [
              "getSecuritySettings",
              "updateSecuritySettings",
              "getSystemBannerDraft",
              "getSystemBannerPublished",
              "publishSystemBanner",
              "unpublishSystemBanner",
              "listAuditLogs",
            ],
          },
        ];

        checks.forEach(({ label, repo, methods }) => {
          methods.forEach((methodName) => {
            assert(
              typeof repo[methodName] === "function",
              `${label} missing method: ${methodName}`
            );
          });
        });
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
        process.env.NEXT_PUBLIC_USE_MOCKS = oldUseMocks;
      }
    },
  },
  {
    name: "comment thread highlight applies only once",
    async run() {
      await runCommentThreadHighlightTests();
    },
  },
  {
    name: "comment thread accordion expands only selected",
    async run() {
      await runCommentThreadAccordionListTests();
    },
  },
  {
    name: "feedback dedupe keeps unique ids",
    async run() {
      await runFeedbackDedupeTests();
    },
  },
  {
    name: "feedback inbox filters to citizen-initiated roots",
    async run() {
      await runFeedbackInboxFilterTests();
    },
  },
  {
    name: "feedback routes and redirects target /feedback",
    async run() {
      await runFeedbackRouteTargetTests();
    },
  },
  {
    name: "feedback repo logs comment_replied for barangay official replies",
    async run() {
      await runFeedbackCommentReplyAuditLogTests();
    },
  },
  {
    name: "project.mapper tests",
    async run() {
      await runProjectMapperTests();
    },
  },
  {
    name: "project.repo.mock tests",
    async run() {
      await runProjectRepoTests();
    },
  },
  {
    name: "dashboard.repo selector tests",
    async run() {
      await runDashboardRepoSelectorTests();
    },
  },
  {
    name: "dashboard.mapper tests",
    async run() {
      await runDashboardMapperTests();
    },
  },
  {
    name: "dashboard project update logs tests",
    async run() {
      await runDashboardProjectUpdateLogsTests();
    },
  },
  {
    name: "chat.repo.mock tests",
    async run() {
      await runChatRepoTests();
    },
  },
  {
    name: "auditService role gating",
    async run() {
      await runAuditServiceTests();
    },
  },
  {
    name: "auditService suppresses CRUD duplicates for barangay feed",
    async run() {
      await runAuditCrudDedupeTests();
    },
  },
  {
    name: "auditService admin pagination and filters",
    async run() {
      await runAuditAdminPaginationTests();
    },
  },
  {
    name: "auditService dev fallback shows scoped logs",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      process.env.NEXT_PUBLIC_APP_ENV = "dev";
      try {
        const actor = {
          userId: "uuid-not-in-mock",
          role: "city_official",
          scope: { kind: "city", id: "city_001" },
        };
        const result = await getAuditFeedForActor(actor);
        const expected = ACTIVITY_LOG_FIXTURE.filter(
          (row) =>
            row.actorRole === "city_official" &&
            row.scope?.scope_type === "city" &&
            row.scope.city_id === "city_001"
        ).length;
        assert(
          result.length === expected,
          "Expected dev fallback to return city-scoped activity logs"
        );
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
      }
    },
  },
  {
    name: "submissionsService role gating",
    async run() {
      await runSubmissionsServiceTests();
    },
  },
  {
    name: "submissionsReview.repo.mock tests",
    async run() {
      await runSubmissionsReviewRepoTests();
    },
  },
  {
    name: "landing-content repo.mock tests",
    async run() {
      await runLandingContentRepoMockTests();
    },
  },
  {
    name: "landing-content view smoke tests",
    async run() {
      await runLandingContentViewSmokeTests();
    },
  },
  {
    name: "submissionsService null actor unauthorized",
    async run() {
      const oldEnv = process.env.NEXT_PUBLIC_APP_ENV;
      process.env.NEXT_PUBLIC_APP_ENV = "dev";
      try {
        let threwUnauthorized = false;
        try {
          await getCitySubmissionsFeedForActor(null);
        } catch (error) {
          threwUnauthorized =
            error instanceof Error && /unauthorized/i.test(error.message);
        }
        assert(
          threwUnauthorized,
          "Expected null actor to be unauthorized for submissions feed"
        );
      } finally {
        process.env.NEXT_PUBLIC_APP_ENV = oldEnv;
      }
    },
  },
];

void runTests(tests);
