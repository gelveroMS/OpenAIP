import { NextResponse } from "next/server";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ notificationId: string }> }
) {
  const csrf = enforceCsrfProtection(request);
  if (!csrf.ok) {
    return csrf.response;
  }

  try {
    const { notificationId } = await context.params;
    const id = notificationId.trim();
    if (!id) {
      return NextResponse.json({ message: "Notification id is required." }, { status: 400 });
    }

    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { error } = await client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_user_id", authData.user.id);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ markedRead: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to mark notification as read.",
      },
      { status: 500 }
    );
  }
}
