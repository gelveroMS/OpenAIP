import { describe, expect, it } from "vitest";
import { isBannerActiveNow } from "@/lib/system-banner/system-banner.server";

describe("system banner schedule semantics", () => {
  it("returns false when banner is null", () => {
    expect(isBannerActiveNow(null, Date.now())).toBe(false);
  });

  it("treats missing start/end as always active", () => {
    const banner = {
      title: "Info",
      message: "Always on",
      severity: "Info" as const,
      startAt: null,
      endAt: null,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    expect(isBannerActiveNow(banner, Date.now())).toBe(true);
  });

  it("supports start-only windows", () => {
    const start = "2026-03-01T10:00:00.000Z";
    const banner = {
      title: "Start Only",
      message: "Starts later",
      severity: "Warning" as const,
      startAt: start,
      endAt: null,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    expect(isBannerActiveNow(banner, new Date("2026-03-01T09:59:59.000Z").getTime())).toBe(false);
    expect(isBannerActiveNow(banner, new Date("2026-03-01T10:00:00.000Z").getTime())).toBe(true);
  });

  it("supports end-only windows", () => {
    const end = "2026-03-01T10:00:00.000Z";
    const banner = {
      title: "End Only",
      message: "Ends soon",
      severity: "Warning" as const,
      startAt: null,
      endAt: end,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    expect(isBannerActiveNow(banner, new Date("2026-03-01T09:59:59.000Z").getTime())).toBe(true);
    expect(isBannerActiveNow(banner, new Date("2026-03-01T10:00:01.000Z").getTime())).toBe(false);
  });

  it("supports bounded start/end windows", () => {
    const banner = {
      title: "Range",
      message: "Bounded",
      severity: "Critical" as const,
      startAt: "2026-03-01T08:00:00.000Z",
      endAt: "2026-03-01T10:00:00.000Z",
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    expect(isBannerActiveNow(banner, new Date("2026-03-01T07:59:59.000Z").getTime())).toBe(false);
    expect(isBannerActiveNow(banner, new Date("2026-03-01T08:00:00.000Z").getTime())).toBe(true);
    expect(isBannerActiveNow(banner, new Date("2026-03-01T10:00:00.000Z").getTime())).toBe(true);
    expect(isBannerActiveNow(banner, new Date("2026-03-01T10:00:01.000Z").getTime())).toBe(false);
  });
});

