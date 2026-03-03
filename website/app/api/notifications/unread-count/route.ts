import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  try {
    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { count, error } = await client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", authData.user.id)
      .is("read_at", null);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ unreadCount: count ?? 0 }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to load unread notification count.",
      },
      { status: 500 }
    );
  }
}
