import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type NotificationStatus = "all" | "unread";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseStatus(value: string | null): NotificationStatus {
  return value === "unread" ? "unread" : "all";
}

export async function GET(request: Request) {
  try {
    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 5000);
    const limit = Math.max(1, parsePositiveInt(url.searchParams.get("limit"), 20, 50));
    const status = parseStatus(url.searchParams.get("status"));

    let query = client
      .from("notifications")
      .select(
        "id,recipient_user_id,recipient_role,scope_type,event_type,entity_type,entity_id,title,message,action_url,metadata,created_at,read_at,dedupe_key",
        { count: "exact" }
      )
      .eq("recipient_user_id", authData.user.id)
      .order("created_at", { ascending: false });

    if (status === "unread") {
      query = query.is("read_at", null);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    const total = count ?? 0;
    return NextResponse.json(
      {
        items: data ?? [],
        offset,
        limit,
        total,
        hasNext: offset + limit < total,
        nextOffset: offset + limit < total ? offset + limit : null,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to load notifications.",
      },
      { status: 500 }
    );
  }
}
