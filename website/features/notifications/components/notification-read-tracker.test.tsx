import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationReadTracker from "@/features/notifications/components/notification-read-tracker";
import { NOTIFICATION_READ_EVENT } from "@/lib/notifications/read-events";

const replaceMock = vi.fn();
const searchParamsState = {
  value: new URLSearchParams(""),
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/city/submissions/aip/aip-1",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParamsState.value,
}));

vi.mock("@/lib/security/csrf", () => ({
  withCsrfHeader: (init: RequestInit) => init,
}));

describe("NotificationReadTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.value = new URLSearchParams("");
  });

  it("marks read and removes notificationId from URL on success", async () => {
    searchParamsState.value = new URLSearchParams("notificationId=notif-1&tab=review");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<NotificationReadTracker />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications/notif-1/read",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/city/submissions/aip/aip-1?tab=review", {
        scroll: false,
      });
    });

    const readEvents = dispatchSpy.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === NOTIFICATION_READ_EVENT) as CustomEvent<
      { notificationId?: string }
    >[];
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0]?.detail.notificationId).toBe("notif-1");
    dispatchSpy.mockRestore();
  });

  it("keeps notificationId in URL when mark-read fails", async () => {
    searchParamsState.value = new URLSearchParams("notificationId=notif-2");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<NotificationReadTracker />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications/notif-2/read",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    expect(replaceMock).not.toHaveBeenCalled();
    const readEvents = dispatchSpy.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === NOTIFICATION_READ_EVENT);
    expect(readEvents).toHaveLength(0);
    dispatchSpy.mockRestore();
  });
});
