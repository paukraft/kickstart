import { describe, expect, it } from "vitest";

import { getUtcDateKey, shouldSendDailyAppUsed } from "./posthog-telemetry";

describe("posthog telemetry daily gating", () => {
  it("uses the UTC calendar date instead of a rolling 24-hour window", () => {
    expect(getUtcDateKey(new Date("2026-04-18T23:59:59-07:00"))).toBe("2026-04-19");
    expect(getUtcDateKey(new Date("2026-04-19T00:00:01+02:00"))).toBe("2026-04-18");
  });

  it("sends when nothing has been sent yet", () => {
    expect(
      shouldSendDailyAppUsed({
        lastSentUtcDate: null,
        now: new Date("2026-04-18T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("does not send again within the same UTC date", () => {
    expect(
      shouldSendDailyAppUsed({
        lastSentUtcDate: "2026-04-18",
        now: new Date("2026-04-18T23:59:59Z"),
      }),
    ).toBe(false);
  });

  it("sends again as soon as the UTC date changes", () => {
    expect(
      shouldSendDailyAppUsed({
        lastSentUtcDate: "2026-04-18",
        now: new Date("2026-04-19T00:00:00Z"),
      }),
    ).toBe(true);
  });
});
