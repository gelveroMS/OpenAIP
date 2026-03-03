import { describe, expect, it } from "vitest";
import { mapLguChatbotErrorMessage } from "./use-lgu-chatbot";

describe("mapLguChatbotErrorMessage", () => {
  it("maps city route mismatch errors to a chatbot-specific message", () => {
    expect(
      mapLguChatbotErrorMessage(
        new Error("Use /api/city/chat/messages for city officials."),
        "Failed to load chat sessions."
      )
    ).toBe("This account belongs to the city chatbot. Open /city/chatbot.");
  });

  it("maps barangay route mismatch errors to a chatbot-specific message", () => {
    expect(
      mapLguChatbotErrorMessage(
        new Error("Use /api/barangay/chat/messages for barangay officials."),
        "Failed to load chat sessions."
      )
    ).toBe("This account belongs to the barangay chatbot. Open /barangay/chatbot.");
  });

  it("maps auth failures to a sign-in prompt", () => {
    expect(
      mapLguChatbotErrorMessage(new Error("Authentication required."), "Failed to load chat sessions.")
    ).toBe("Authentication required. Please sign in again.");
  });

  it("maps legacy unauthorized failures to a sign-in prompt", () => {
    expect(mapLguChatbotErrorMessage(new Error("Unauthorized."), "Failed to load chat sessions.")).toBe(
      "Authentication required. Please sign in again."
    );
  });

  it("maps unsupported-role failures to a clear access message", () => {
    expect(
      mapLguChatbotErrorMessage(
        new Error("Only barangay and city officials can use the LGU chatbot."),
        "Failed to load chat sessions."
      )
    ).toBe("This account is not allowed to use the LGU chatbot.");
  });

  it("maps missing-scope failures to an administrator action", () => {
    expect(
      mapLguChatbotErrorMessage(
        new Error("Forbidden. Missing required LGU scope."),
        "Failed to load chat sessions."
      )
    ).toBe("Your account is missing its required LGU assignment. Contact an administrator.");
  });

  it("falls back to the default message when no error object is available", () => {
    expect(mapLguChatbotErrorMessage(null, "Failed to load chat sessions.")).toBe(
      "Failed to load chat sessions."
    );
  });
});
