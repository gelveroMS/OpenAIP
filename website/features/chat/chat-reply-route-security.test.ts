import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/chat/reply/route";

describe("/api/chat/reply security", () => {
  it("rejects POST requests without a trusted origin", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat/reply", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          session_id: "session-1",
          user_message: "hello",
        }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Forbidden.",
    });
  });
});
