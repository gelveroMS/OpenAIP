type LguChatRouteKind = "barangay" | "city";
type LguChatActor = { role?: string | null } | null;

export function getLguChatAuthFailure(
  expectedRoute: LguChatRouteKind,
  actor: LguChatActor,
  resource: "messages" | "sessions"
) {
  if (!actor) {
    return {
      status: 401,
      message: "Authentication required.",
    };
  }

  if (expectedRoute === "barangay" && actor.role === "city_official") {
    return {
      status: 403,
      message: `Use /api/city/chat/${resource} for city officials.`,
    };
  }

  if (expectedRoute === "city" && actor.role === "barangay_official") {
    return {
      status: 403,
      message: `Use /api/barangay/chat/${resource} for barangay officials.`,
    };
  }

  if (
    actor.role === "citizen" ||
    actor.role === "municipal_official" ||
    actor.role === "admin"
  ) {
    return {
      status: 403,
      message: "Only barangay and city officials can use the LGU chatbot.",
    };
  }

  if (
    (expectedRoute === "barangay" && actor.role === "barangay_official") ||
    (expectedRoute === "city" && actor.role === "city_official")
  ) {
    return null;
  }

  return {
    status: 403,
    message: "Forbidden.",
  };
}
