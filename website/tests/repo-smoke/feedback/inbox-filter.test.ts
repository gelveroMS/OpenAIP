import {
  CITIZEN_INITIATED_FEEDBACK_KINDS,
  isCitizenInitiatedFeedbackKind,
} from "@/lib/constants/feedback-kind";
import { createMockCommentRepo } from "@/lib/repos/feedback/repo.mock";
import { createCommentRepoFromClient } from "@/lib/repos/feedback/repo.supabase.base";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

type QueryResult<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;
type CommentRepoClient = Awaited<ReturnType<Parameters<typeof createCommentRepoFromClient>[0]>>;

export async function runFeedbackInboxFilterTests() {
  const mockRepo = createMockCommentRepo();
  const threads = await mockRepo.listThreadsForInbox({ lguId: "lgu_001" });

  assert(
    threads.every((thread) => isCitizenInitiatedFeedbackKind(thread.preview.kind)),
    "Expected mock inbox roots to include only citizen-initiated kinds."
  );

  const repliedCitizenThread = threads.find(
    (thread) => thread.preview.status === "responded"
  );
  assert(!!repliedCitizenThread, "Expected a citizen-initiated responded thread in inbox.");
  assert(
    repliedCitizenThread?.preview.status === "responded",
    "Expected citizen thread with official reply to keep responded status."
  );

  let capturedKindFilter: string[] | null = null;

  const fakeClient = {
    from(table: string) {
      if (table === "feedback") {
        return {
          select() {
            return {
              is(column: string, value: unknown) {
                assert(
                  column === "parent_feedback_id" && value === null,
                  "Expected root query to constrain parent_feedback_id to null."
                );
                return {
                  in(filterColumn: string, values: string[]) {
                    if (filterColumn === "kind") {
                      capturedKindFilter = [...values];
                    }
                    return {
                      order: async () =>
                        ({ data: [], error: null }) as Awaited<QueryResult<Record<string, unknown>>>,
                    };
                  },
                  order: async () =>
                    ({ data: [], error: null }) as Awaited<QueryResult<Record<string, unknown>>>,
                };
              },
              in() {
                return {
                  order: async () =>
                    ({ data: [], error: null }) as Awaited<QueryResult<Record<string, unknown>>>,
                };
              },
            };
          },
        };
      }

      if (table === "profiles") {
        return {
          select() {
            return {
              in: async () =>
                ({ data: [], error: null }) as Awaited<QueryResult<Record<string, unknown>>>,
            };
          },
        };
      }

      throw new Error(`Unexpected table in fake client: ${table}`);
    },
  };

  const supabaseRepo = createCommentRepoFromClient(
    async () => fakeClient as unknown as CommentRepoClient
  );
  await supabaseRepo.listThreadsForInbox({ lguId: "lgu_001" });
  const appliedKindFilter: string[] = capturedKindFilter ?? [];

  assert(
    appliedKindFilter.length > 0,
    "Expected supabase inbox query to apply kind filter."
  );
  assert(
    CITIZEN_INITIATED_FEEDBACK_KINDS.every((kind) => appliedKindFilter.includes(kind)),
    "Expected supabase inbox query kind filter to include all citizen-initiated kinds."
  );
  assert(
    !appliedKindFilter.includes("lgu_note"),
    "Expected supabase inbox query kind filter to exclude lgu_note."
  );
}
