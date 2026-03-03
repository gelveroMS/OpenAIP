import type { Json, RoleType } from "@/lib/contracts/databasev2";
import type { RetrievalScopePayload, RetrievalScopeTarget } from "@/lib/chat/types";
import {
  requestPipelineChatAnswer,
  requestPipelineIntentClassify,
} from "@/lib/chat/pipeline-client";
import { getTypedAppSetting, isUserBlocked } from "@/lib/settings/app-settings";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { assertPrivilegedWriteAccess, isInvariantError } from "@/lib/security/invariants";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  consumeChatQuota,
  insertAssistantChatMessage,
  toPrivilegedActorContextFromProfile,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { isCitizenProfileComplete } from "@/lib/auth/citizen-profile-completion";
import { NextResponse } from "next/server";

type ReplyRequestBody = {
  session_id?: string;
  user_message?: string;
};

type ChatSessionRow = {
  id: string;
  title: string | null;
  context: Json;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "assistant" | "system" | "user";
  content: string;
  citations: Json | null;
  retrieval_meta: Json | null;
  created_at: string;
};

type ProfileScopeRow = {
  id: string;
  role: RoleType;
  full_name: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ChatQuotaResult = {
  allowed: boolean;
  reason: string;
};

const MESSAGE_CONTENT_LIMIT = 12000;

function buildFollowUps(userMessage: string): string[] {
  const lowered = userMessage.toLowerCase();
  if (lowered.includes("project")) {
    return [
      "Show the top funded projects for this scope.",
      "Break down the budget by sector for the same fiscal year.",
      "Compare this project's funding against last fiscal year.",
    ];
  }

  if (lowered.includes("budget") || lowered.includes("allocation")) {
    return [
      "Show the total allocation by sector.",
      "List the biggest line items in this scope.",
      "Compare this fiscal year against the previous year.",
    ];
  }

  return [
    "Show me the total investment for this fiscal year.",
    "List key projects in this scope.",
    "What line items support this answer?",
  ];
}

async function resolveScopeName(
  admin: ReturnType<typeof supabaseAdmin>,
  target: RetrievalScopeTarget
): Promise<string | null> {
  const table =
    target.scope_type === "barangay"
      ? "barangays"
      : target.scope_type === "city"
        ? "cities"
        : "municipalities";

  const { data, error } = await admin
    .from(table)
    .select("name")
    .eq("id", target.scope_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return typeof data?.name === "string" ? data.name : null;
}

async function buildRetrievalScope(input: {
  profile: ProfileScopeRow;
  admin: ReturnType<typeof supabaseAdmin>;
}): Promise<RetrievalScopePayload> {
  const targets: RetrievalScopeTarget[] = [];

  if (input.profile.barangay_id) {
    targets.push({
      scope_type: "barangay",
      scope_id: input.profile.barangay_id,
      scope_name: "",
    });
  } else if (input.profile.city_id) {
    targets.push({
      scope_type: "city",
      scope_id: input.profile.city_id,
      scope_name: "",
    });
  } else if (input.profile.municipality_id) {
    targets.push({
      scope_type: "municipality",
      scope_id: input.profile.municipality_id,
      scope_name: "",
    });
  }

  if (targets.length === 0) {
    return {
      mode: "global",
      targets: [],
    };
  }

  const withNames = await Promise.all(
    targets.map(async (target) => ({
      ...target,
      scope_name: (await resolveScopeName(input.admin, target)) ?? target.scope_type,
    }))
  );

  return {
    mode: input.profile.role === "citizen" ? "own_barangay" : "named_scopes",
    targets: withNames,
  };
}

function toDbCitations(payload: {
  citations: Array<{
    source_id: string;
    snippet: string;
    fiscal_year?: number | null;
    scope_name?: string | null;
    metadata?: unknown;
  }>;
}): Json {
  return payload.citations.map((citation, index) => {
    const metadata =
      citation.metadata && typeof citation.metadata === "object" && !Array.isArray(citation.metadata)
        ? (citation.metadata as Record<string, unknown>)
        : {};

    return {
      id: citation.source_id || `evidence_${index + 1}`,
      documentLabel:
        typeof metadata.document_label === "string"
          ? metadata.document_label
          : citation.scope_name || "Published AIP",
      snippet: citation.snippet,
      fiscalYear:
        typeof citation.fiscal_year === "number"
          ? String(citation.fiscal_year)
          : null,
      pageOrSection:
        typeof metadata.page_no === "number"
          ? `Page ${metadata.page_no}`
          : typeof metadata.section === "string"
            ? metadata.section
            : null,
    };
  }) as Json;
}

async function consumeCitizenQuota(input: {
  actor: NonNullable<ReturnType<typeof toPrivilegedActorContextFromProfile>>;
  userId: string;
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
}): Promise<ChatQuotaResult> {
  const quota = await consumeChatQuota({
    actor: input.actor,
    userId: input.userId,
    maxRequests: input.maxRequests,
    timeWindow: input.timeWindow,
    route: "citizen_chat_reply",
  });
  return {
    allowed: quota.allowed,
    reason: quota.reason,
  };
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const body = (await request.json().catch(() => null)) as ReplyRequestBody | null;
    const sessionId = body?.session_id?.trim();
    const userMessage = body?.user_message?.trim();

    if (!sessionId || !userMessage) {
      return NextResponse.json(
        { error: "Missing required fields: session_id, user_message" },
        { status: 400 }
      );
    }

    if (userMessage.length > MESSAGE_CONTENT_LIMIT) {
      return NextResponse.json(
        { error: `Message exceeds ${MESSAGE_CONTENT_LIMIT} characters.` },
        { status: 400 }
      );
    }

    const server = await supabaseServer();
    const { data: authData, error: authError } = await server.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;

    if (await isUserBlocked(userId)) {
      return NextResponse.json(
        { error: "Your account is currently blocked from chatbot usage." },
        { status: 403 }
      );
    }

    const { data: sessionData, error: sessionError } = await server
      .from("chat_sessions")
      .select("id,title,context")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 400 });
    }

    if (!sessionData) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = sessionData as ChatSessionRow;

    const { data: profileData, error: profileError } = await server
      .from("profiles")
      .select("id,role,full_name,barangay_id,city_id,municipality_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (!profileData) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const profile = profileData as ProfileScopeRow;
    if (profile.role !== "citizen") {
      return NextResponse.json({ error: "Only citizens can use this endpoint." }, { status: 403 });
    }
    if (!isCitizenProfileComplete(profile)) {
      return NextResponse.json(
        { error: "Complete your profile before using the AI Assistant." },
        { status: 403 }
      );
    }
    const privilegedActor = toPrivilegedActorContextFromProfile({
      userId,
      role: profile.role,
      barangayId: profile.barangay_id,
      cityId: profile.city_id,
      municipalityId: profile.municipality_id,
    });
    if (!privilegedActor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertPrivilegedWriteAccess({
      actor: privilegedActor,
      allowlistedRoles: ["citizen"],
      scopeByRole: { citizen: "barangay" },
      requireScopeId: true,
      message: "Unauthorized",
    });

    const rateLimitPolicy = await getTypedAppSetting("controls.chatbot_rate_limit");
    const quota = await consumeCitizenQuota({
      actor: privilegedActor,
      userId,
      maxRequests: rateLimitPolicy.maxRequests,
      timeWindow: rateLimitPolicy.timeWindow,
    });
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly.", reason: quota.reason },
        { status: 429 }
      );
    }

    const admin = supabaseAdmin();
    const retrievalScope = await buildRetrievalScope({
      profile,
      admin,
    });
    let intentClassification: Awaited<ReturnType<typeof requestPipelineIntentClassify>> | null = null;
    try {
      intentClassification = await requestPipelineIntentClassify({
        text: userMessage,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Pipeline intent classification failed.";
      console.warn("[citizen-chat] intent classification failed:", message);
    }

    const pipeline = await requestPipelineChatAnswer({
      question: userMessage,
      retrievalScope,
    });

    const citations = toDbCitations({
      citations: pipeline.citations.map((citation) => ({
        source_id: citation.source_id,
        snippet: citation.snippet,
        fiscal_year: citation.fiscal_year ?? null,
        scope_name: citation.scope_name ?? null,
        metadata: citation.metadata,
      })),
    });

    const suggestedFollowUps = buildFollowUps(userMessage);
    const retrievalMeta = {
      ...(pipeline.retrieval_meta ?? {}),
      refused: pipeline.refused,
      source: "pipeline_chat_answer",
      sessionTitle: session.title,
      context: session.context,
      suggestedFollowUps,
      ...(intentClassification ? { intentClassification } : {}),
    } as Json;

    const inserted = (await insertAssistantChatMessage({
      actor: privilegedActor,
      sessionId,
      content: pipeline.answer,
      citations,
      retrievalMeta,
    })) as ChatMessageRow;
    return NextResponse.json({
      message: {
        id: inserted.id,
        sessionId: inserted.session_id,
        role: inserted.role,
        content: inserted.content,
        citations: inserted.citations,
        retrievalMeta: inserted.retrieval_meta,
        createdAt: inserted.created_at,
      },
      suggestedFollowUps,
    });
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
