import { describe, expect, it } from "vitest";

import { deriveCommandId, persistedKickstartConfigSchema } from "./config";

describe("persistedKickstartConfigSchema", () => {
  it("applies defaults to command fields", () => {
    const config = persistedKickstartConfigSchema.parse({
      commands: [
        {
          command: "bun dev",
        },
      ],
    });

    expect(config.commands[0]).toMatchObject({
      cwd: ".",
      startMode: "manual",
      type: "service",
    });
  });

  it("accepts a persisted stable id", () => {
    const config = persistedKickstartConfigSchema.parse({
      commands: [
        {
          command: "bun dev",
          id: "web-dev",
        },
      ],
    });

    expect(config.commands[0]?.id).toBe("web-dev");
  });
});

describe("deriveCommandId", () => {
  it("normalizes ids in one shared place", () => {
    expect(deriveCommandId("bun dev", "apps/api")).toBe("apps-api-bun-dev");
  });
});
