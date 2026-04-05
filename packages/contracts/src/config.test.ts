import { describe, expect, it } from "vitest";

import {
  createCommandTabId,
  createEffectiveCommandId,
  deriveCommandId,
  editableKickstartConfigSchema,
  parseCommandTabId,
  parseEffectiveCommandId,
  persistedKickstartConfigSchema,
} from "./config";

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

  it("accepts a nullable action sound", () => {
    const config = persistedKickstartConfigSchema.parse({
      commands: [
        {
          command: "bun test",
          soundId: null,
          type: "action",
        },
        {
          command: "bun deploy",
          soundId: "happy",
          type: "action",
        },
      ],
    });

    expect(config.commands[0]?.soundId).toBeNull();
    expect(config.commands[1]?.soundId).toBe("happy");
  });
});

describe("editableKickstartConfigSchema", () => {
  it("requires explicit editable command behavior fields", () => {
    const config = editableKickstartConfigSchema.parse({
      commands: [
        {
          command: "bun dev",
          id: "web-dev",
          startMode: "auto",
          type: "service",
        },
      ],
    });

    expect(config.commands[0]).toMatchObject({
      command: "bun dev",
      cwd: ".",
      id: "web-dev",
      startMode: "auto",
      type: "service",
    });
  });
});

describe("deriveCommandId", () => {
  it("normalizes ids in one shared place", () => {
    expect(deriveCommandId("bun dev", "apps/api")).toBe("apps-api-bun-dev");
  });
});

describe("effective command ids", () => {
  it("namespaces source-local ids", () => {
    expect(createEffectiveCommandId("shared", "web-dev")).toBe("shared:web-dev");
    expect(createEffectiveCommandId("local", "web-dev")).toBe("local:web-dev");
  });

  it("parses valid effective ids", () => {
    expect(parseEffectiveCommandId("shared:web-dev")).toEqual({
      source: "shared",
      sourceCommandId: "web-dev",
    });
  });

  it("rejects invalid effective ids", () => {
    expect(parseEffectiveCommandId("web-dev")).toBeNull();
    expect(parseEffectiveCommandId("custom:web-dev")).toBeNull();
  });
});

describe("command tab ids", () => {
  it("creates tab ids from command ids", () => {
    expect(createCommandTabId("shared:web-dev")).toBe("command:shared:web-dev");
  });

  it("parses valid command tab ids", () => {
    expect(parseCommandTabId("command:shared:web-dev")).toEqual({
      commandId: "shared:web-dev",
    });
  });

  it("rejects invalid command tab ids", () => {
    expect(parseCommandTabId("shared:web-dev")).toBeNull();
    expect(parseCommandTabId("command:")).toBeNull();
  });
});
