import type {
  AddReplyParams,
  CommentRepo,
  CommentTargetLookup,
  CreateFeedbackInput,
  CreateReplyInput,
  CreateRootInput,
  FeedbackItem,
  FeedbackRepo,
  FeedbackTarget,
  FeedbackThreadRow,
  FeedbackThreadsRepo,
  GetThreadParams,
  ListMessagesParams,
  ListThreadsForInboxParams,
  ResolveThreadParams,
} from "./repo";
import type { CommentMessage, CommentThread } from "./types";
import { COMMENT_MESSAGES_FIXTURE } from "@/mocks/fixtures/feedback/comment-messages.fixture";
import { COMMENT_THREADS_FIXTURE } from "@/mocks/fixtures/feedback/comment-threads.fixture";
import { validateMockIds } from "@/mocks/fixtures/shared/validate-mock-ids";
import { isCitizenInitiatedFeedbackKind } from "@/lib/constants/feedback-kind";
import { toFeedbackRoleLabel } from "@/lib/feedback/author-labels";
import { feedbackDebugLog } from "./debug";
import { dedupeByKey, findDuplicateKeys } from "./mappers";
import { getProjectsRepo } from "@/lib/repos/projects/repo";
import { AIPS_TABLE } from "@/mocks/fixtures/aip/aips.table.fixture";
import { AIP_PROJECT_ROWS_TABLE } from "@/mocks/fixtures/aip/aip-project-rows.table.fixture";

let threadStore: CommentThread[] = [...COMMENT_THREADS_FIXTURE];
let messageStore: CommentMessage[] = [...COMMENT_MESSAGES_FIXTURE];
let messageSequence = messageStore.length + 1;
let mockIdsValidated = false;

function sortByUpdatedAtDesc(a: CommentThread, b: CommentThread) {
  return new Date(b.preview.updatedAt).getTime() - new Date(a.preview.updatedAt).getTime();
}

function sortByCreatedAtAsc(a: CommentMessage, b: CommentMessage) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function isOfficialReplyAuthor(role: CommentMessage["authorRole"]): boolean {
  return role === "barangay_official" || role === "city_official";
}

function toPreviewAuthorRoleLabel(role: CommentMessage["authorRole"]): string {
  if (role === "citizen") return toFeedbackRoleLabel("citizen");
  if (role === "barangay_official") return toFeedbackRoleLabel("barangay_official");
  if (role === "city_official") return toFeedbackRoleLabel("city_official");
  return toFeedbackRoleLabel("admin");
}

function hydrateThreadPreview(thread: CommentThread): CommentThread {
  const messages = messageStore
    .filter((message) => message.threadId === thread.id)
    .sort(sortByCreatedAtAsc);
  const root = messages[0];
  const latest = messages[messages.length - 1];
  const hasOfficialReply = messages.slice(1).some((message) => isOfficialReplyAuthor(message.authorRole));

  return {
    ...thread,
    preview: {
      ...thread.preview,
      text: latest?.text ?? thread.preview.text,
      updatedAt: latest?.createdAt ?? thread.preview.updatedAt,
      status: hasOfficialReply ? "responded" : "no_response",
      authorRoleLabel: root ? toPreviewAuthorRoleLabel(root.authorRole) : "Citizen",
      authorLguLabel: thread.preview.authorScopeLabel ?? "Brgy. Unknown",
      authorScopeLabel: thread.preview.authorScopeLabel ?? "Brgy. Unknown",
    },
  };
}

// [DATAFLOW] Mock implementation for the threaded feedback UI. This is NOT a DBV2 adapter; it simulates threads in memory.
export function createMockCommentRepo(): CommentRepo {
  if (!mockIdsValidated && process.env.NODE_ENV !== "production") {
    validateMockIds();
    mockIdsValidated = true;
  }

  return {
    async listThreadsForInbox(_params: ListThreadsForInboxParams): Promise<CommentThread[]> {
      const sorted = [...threadStore]
        .map(hydrateThreadPreview)
        .filter((thread) => isCitizenInitiatedFeedbackKind(thread.preview.kind))
        .sort(sortByUpdatedAtDesc);
      const duplicates = findDuplicateKeys(sorted, (thread) => thread.id);
      const unique = dedupeByKey(sorted, (thread) => thread.id);

      if (duplicates.length > 0) {
        feedbackDebugLog("threaded.listThreadsForInbox duplicates", {
          count: duplicates.length,
          ids: duplicates,
        });
      }

      feedbackDebugLog("threaded.listThreadsForInbox", {
        count: unique.length,
        ids: unique.map((t) => t.id),
      });

      return unique;
    },

    async getThread({ threadId }: GetThreadParams): Promise<CommentThread | null> {
      const thread = threadStore.find((entry) => entry.id === threadId) ?? null;
      return thread ? hydrateThreadPreview(thread) : null;
    },

    async listMessages({ threadId }: ListMessagesParams): Promise<CommentMessage[]> {
      const sorted = messageStore
        .filter((message) => message.threadId === threadId)
        .sort(sortByCreatedAtAsc);

      const duplicates = findDuplicateKeys(sorted, (message) => message.id);
      const unique = dedupeByKey(sorted, (message) => message.id);

      if (duplicates.length > 0) {
        feedbackDebugLog("threaded.listMessages duplicates", {
          threadId,
          count: duplicates.length,
          ids: duplicates,
        });
      }

      feedbackDebugLog("threaded.listMessages", {
        threadId,
        count: unique.length,
        ids: unique.map((m) => m.id),
      });

      return unique;
    },

    async addReply({ threadId, text }: AddReplyParams): Promise<CommentMessage> {
      const createdAt = new Date().toISOString();
      const id = `cmsg_${String(messageSequence).padStart(3, "0")}`;
      messageSequence += 1;

      const message: CommentMessage = {
        id,
        threadId,
        authorRole: "barangay_official",
        authorId: "official_001",
        kind: "lgu_note",
        text,
        createdAt,
      };

      messageStore = [...messageStore, message];

      threadStore = threadStore.map((thread) => {
        if (thread.id !== threadId) return thread;

        return {
          ...thread,
          preview: {
            ...thread.preview,
            text,
            updatedAt: createdAt,
            status: "responded",
            authorRoleLabel: thread.preview.authorRoleLabel ?? "Citizen",
            authorLguLabel: thread.preview.authorLguLabel ?? thread.preview.authorScopeLabel,
          },
        };
      });

      return message;
    },

    async resolveThread(_params: ResolveThreadParams): Promise<void> {
      return;
    },
  };
}

export function createMockCommentTargetLookup(): CommentTargetLookup {
  return {
    async getProject(id) {
      const repo = getProjectsRepo();
      const project = await repo.getByRefCode(id);
      if (!project) return null;
      return {
        id: project.id,
        title: project.title,
        year: project.year,
        kind: project.kind,
        aipId:
          AIP_PROJECT_ROWS_TABLE.find(
            (row) => row.projectRefCode === project.id || row.id === id
          )?.aipId ?? undefined,
      };
    },

    async getAip(id) {
      const aip = AIPS_TABLE.find((item) => item.id === id);
      if (!aip) return null;
      return {
        id: aip.id,
        title: aip.title,
        year: aip.year,
        barangayName: aip.barangayName ?? null,
      };
    },

    async getAipItem(aipId, aipItemId) {
      const item = AIP_PROJECT_ROWS_TABLE.find((row) => row.aipId === aipId && row.id === aipItemId);
      if (!item) return null;
      return {
        id: item.id,
        aipId: item.aipId,
        projectRefCode: item.projectRefCode,
        aipDescription: item.aipDescription,
      };
    },

    async findAipItemByProjectRefCode(projectRefCode) {
      const item = AIP_PROJECT_ROWS_TABLE.find((row) => row.projectRefCode === projectRefCode);
      if (!item) return null;
      return {
        id: item.id,
        aipId: item.aipId,
        projectRefCode: item.projectRefCode,
        aipDescription: item.aipDescription,
      };
    },
  };
}

let feedbackStore: FeedbackItem[] = buildInitialStore(COMMENT_THREADS_FIXTURE, COMMENT_MESSAGES_FIXTURE);
let feedbackSequence = feedbackStore.length + 1;

function buildInitialStore(threads: CommentThread[], messages: CommentMessage[]): FeedbackItem[] {
  const store: FeedbackItem[] = [];

  for (const thread of threads) {
    const threadMessages = messages
      .filter((message) => message.threadId === thread.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const firstMessageId = threadMessages[0]?.id ?? null;

    for (const message of threadMessages) {
      store.push({
        id: message.id,
        targetType: thread.target.targetKind === "project" ? "project" : "aip",
        aipId: thread.target.targetKind === "aip_item" ? thread.target.aipId : null,
        projectId: thread.target.targetKind === "project" ? thread.target.projectId : null,
        parentFeedbackId: firstMessageId && message.id !== firstMessageId ? firstMessageId : null,
        kind: message.kind ?? thread.preview.kind,
        body: message.text,
        authorId: message.authorId ?? null,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        isPublic: true,
      });
    }
  }

  return store;
}

function nextFeedbackId() {
  const id = `fbk_${String(feedbackSequence).padStart(3, "0")}`;
  feedbackSequence += 1;
  return id;
}

function removeWithReplies(items: FeedbackItem[], feedbackId: string) {
  const toRemove = new Set<string>();
  const queue = [feedbackId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || toRemove.has(current)) continue;
    toRemove.add(current);
    for (const item of items) {
      if (item.parentFeedbackId === current) {
        queue.push(item.id);
      }
    }
  }

  return items.filter((item) => !toRemove.has(item.id));
}

export function createMockFeedbackRepo(): FeedbackRepo {
  return {
    async listForAip(aipId: string): Promise<FeedbackItem[]> {
      return feedbackStore
        .filter((item) => item.targetType === "aip" && item.aipId === aipId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },

    async listForProject(projectId: string): Promise<FeedbackItem[]> {
      return feedbackStore
        .filter((item) => item.targetType === "project" && item.projectId === projectId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },

    async createForAip(aipId: string, payload: CreateFeedbackInput): Promise<FeedbackItem> {
      const now = new Date().toISOString();
      const item: FeedbackItem = {
        id: nextFeedbackId(),
        targetType: "aip",
        aipId,
        projectId: null,
        parentFeedbackId: null,
        kind: payload.kind,
        body: payload.body,
        authorId: payload.authorId ?? null,
        createdAt: now,
        updatedAt: now,
        isPublic: payload.isPublic ?? true,
      };

      feedbackStore = [...feedbackStore, item];
      return item;
    },

    async createForProject(projectId: string, payload: CreateFeedbackInput): Promise<FeedbackItem> {
      const now = new Date().toISOString();
      const item: FeedbackItem = {
        id: nextFeedbackId(),
        targetType: "project",
        aipId: null,
        projectId,
        parentFeedbackId: null,
        kind: payload.kind,
        body: payload.body,
        authorId: payload.authorId ?? null,
        createdAt: now,
        updatedAt: now,
        isPublic: payload.isPublic ?? true,
      };

      feedbackStore = [...feedbackStore, item];
      return item;
    },

    async reply(parentFeedbackId: string, payload: CreateFeedbackInput): Promise<FeedbackItem> {
      const parent = feedbackStore.find((item) => item.id === parentFeedbackId);
      if (!parent) {
        throw new Error(`Feedback parent not found: ${parentFeedbackId}`);
      }

      const now = new Date().toISOString();
      const item: FeedbackItem = {
        id: nextFeedbackId(),
        targetType: parent.targetType,
        aipId: parent.aipId,
        projectId: parent.projectId,
        parentFeedbackId: parent.id,
        kind: payload.kind,
        body: payload.body,
        authorId: payload.authorId ?? null,
        createdAt: now,
        updatedAt: now,
        isPublic: payload.isPublic ?? true,
      };

      feedbackStore = [...feedbackStore, item];
      return item;
    },

    async update(
      feedbackId: string,
      patch: Partial<Pick<FeedbackItem, "body" | "kind" | "isPublic">>
    ): Promise<FeedbackItem | null> {
      const index = feedbackStore.findIndex((item) => item.id === feedbackId);
      if (index === -1) {
        return null;
      }

      const current = feedbackStore[index];
      const updated: FeedbackItem = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      feedbackStore = [...feedbackStore.slice(0, index), updated, ...feedbackStore.slice(index + 1)];

      return updated;
    },

    async remove(feedbackId: string): Promise<boolean> {
      const exists = feedbackStore.some((item) => item.id === feedbackId);
      if (!exists) {
        return false;
      }

      feedbackStore = removeWithReplies(feedbackStore, feedbackId);
      return true;
    },
  };
}

type FeedbackStore = {
  rows: FeedbackThreadRow[];
  sequence: number;
};

function sortThreadRowByCreatedAtAsc(a: { created_at: string }, b: { created_at: string }) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sortByCreatedAtAscThenId(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function buildSeedRows(): FeedbackThreadRow[] {
  const rows: FeedbackThreadRow[] = [];

  const threadsById = new Map(COMMENT_THREADS_FIXTURE.map((t) => [t.id, t]));
  assert(threadsById.size === COMMENT_THREADS_FIXTURE.length, "Expected unique thread ids in COMMENT_THREADS_FIXTURE");

  for (const message of COMMENT_MESSAGES_FIXTURE) {
    assert(
      threadsById.has(message.threadId),
      `Comment message references unknown threadId="${message.threadId}" (message id="${message.id}")`
    );
  }

  const messagesByThreadId = new Map<string, typeof COMMENT_MESSAGES_FIXTURE>();
  for (const thread of COMMENT_THREADS_FIXTURE) {
    const messages = COMMENT_MESSAGES_FIXTURE
      .filter((m) => m.threadId === thread.id)
      .slice()
      .sort(sortByCreatedAtAscThenId);

    assert(messages.length > 0, `Expected at least 1 message for threadId="${thread.id}"`);
    messagesByThreadId.set(thread.id, messages);
  }

  for (const thread of COMMENT_THREADS_FIXTURE) {
    const messages = messagesByThreadId.get(thread.id);
    assert(messages, `Expected message store for threadId="${thread.id}"`);

    const rootMessage = messages[0];

    const targetType: FeedbackThreadRow["target_type"] =
      thread.target.targetKind === "project" ? "project" : "aip";
    const aipId = thread.target.targetKind === "aip_item" ? thread.target.aipId : null;
    const projectId = thread.target.targetKind === "project" ? thread.target.projectId : null;

    rows.push({
      id: thread.id,
      target_type: targetType,
      project_id: projectId,
      aip_id: aipId,
      parent_feedback_id: null,
      body: rootMessage.text,
      author_id: rootMessage.authorId,
      created_at: rootMessage.createdAt,
    });

    for (const message of messages.slice(1)) {
      rows.push({
        id: message.id,
        target_type: targetType,
        project_id: projectId,
        aip_id: aipId,
        parent_feedback_id: thread.id,
        body: message.text,
        author_id: message.authorId,
        created_at: message.createdAt,
      });
    }
  }

  return rows;
}

function createStore(): FeedbackStore {
  const rows = buildSeedRows();
  return { rows, sequence: rows.length + 1 };
}

function nextId(store: FeedbackStore) {
  const id = `fdbk_${String(store.sequence).padStart(3, "0")}`;
  store.sequence += 1;
  return id;
}

function matchTarget(row: FeedbackThreadRow, target: FeedbackTarget) {
  if (target.target_type === "project") {
    const projectId = target.project_id ?? null;
    return row.target_type === "project" && (projectId === null || (row.project_id ?? null) === projectId);
  }

  const aipId = target.aip_id ?? null;
  return row.target_type === "aip" && (aipId === null || (row.aip_id ?? null) === aipId);
}

export function createMockFeedbackThreadsRepo(): FeedbackThreadsRepo {
  const store = createStore();

  return {
    async listThreadRootsByTarget(target: FeedbackTarget): Promise<FeedbackThreadRow[]> {
      return store.rows
        .filter((row) => row.parent_feedback_id === null && matchTarget(row, target))
        .sort(sortThreadRowByCreatedAtAsc);
    },

    async listThreadMessages(rootId: string): Promise<FeedbackThreadRow[]> {
      return store.rows
        .filter((row) => row.id === rootId || row.parent_feedback_id === rootId)
        .sort(sortThreadRowByCreatedAtAsc);
    },

    async createRoot(input: CreateRootInput): Promise<FeedbackThreadRow> {
      const now = new Date().toISOString();
      const row: FeedbackThreadRow = {
        id: nextId(store),
        target_type: input.target.target_type,
        aip_id: input.target.aip_id ?? null,
        project_id: input.target.project_id ?? null,
        parent_feedback_id: null,
        body: input.body,
        author_id: input.authorId,
        created_at: now,
      };
      store.rows = [...store.rows, row];
      return row;
    },

    async createReply(input: CreateReplyInput): Promise<FeedbackThreadRow> {
      const parent = store.rows.find((row) => row.id === input.parentId) ?? null;
      if (!parent) {
        throw new Error("parent feedback not found");
      }

      if (input.target) {
        const matchesTarget =
          input.target.target_type === parent.target_type &&
          (input.target.aip_id ?? null) === (parent.aip_id ?? null) &&
          (input.target.project_id ?? null) === (parent.project_id ?? null);
        if (!matchesTarget) {
          throw new Error("reply feedback must match parent target");
        }
      }

      const now = new Date().toISOString();
      const row: FeedbackThreadRow = {
        id: nextId(store),
        target_type: parent.target_type,
        aip_id: parent.aip_id ?? null,
        project_id: parent.project_id ?? null,
        parent_feedback_id: parent.id,
        body: input.body,
        author_id: input.authorId,
        created_at: now,
      };

      store.rows = [...store.rows, row];
      return row;
    },
  };
}
