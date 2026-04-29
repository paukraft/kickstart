import { describe, expect, it } from "vitest";

import { resolveProjectRuntimeState } from "./project-runtime";

describe("resolveProjectRuntimeState", () => {
  it("does not count a booting terminal as project startup", () => {
    expect(
      resolveProjectRuntimeState({
        sessions: [
          {
            hasActiveProcess: false,
            operation: "none",
            status: "booting",
          },
        ],
        startupCommandCount: 1,
      }),
    ).toBe("not-running");
  });

  it("marks the project as starting once the command itself is starting", () => {
    expect(
      resolveProjectRuntimeState({
        sessions: [
          {
            hasActiveProcess: false,
            operation: "starting",
            status: "idle",
          },
        ],
        startupCommandCount: 1,
      }),
    ).toBe("starting");
  });
});
