import { NextResponse } from "next/server";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const csrf = enforceCsrfProtection(request);
  if (!csrf.ok) {
    return csrf.response;
  }

  try {
    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const nowIso = new Date().toISOString();
    const { error } = await client
      .from("notifications")
      .update({ read_at: nowIso })
      .eq("recipient_user_id", authData.user.id)
      .is("read_at", null);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ markedAllRead: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to mark all notifications as read.",
      },
      { status: 500 }
    );
  }
}
