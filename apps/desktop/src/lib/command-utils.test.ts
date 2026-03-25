import { describe, expect, it } from "vitest";

import type { CommandConfig, ProjectTabRecord } from "@kickstart/contracts";
import { deriveCommandId } from "@kickstart/contracts";

import { envTextToRecord, getPreferredCommandTabId } from "./command-utils";

describe("deriveCommandId", () => {
  it("normalizes ids", () => {
    expect(deriveCommandId("bun dev", "apps/api")).toBe("apps-api-bun-dev");
  });
});

describe("envTextToRecord", () => {
  it("parses env text", () => {
    expect(envTextToRecord("PORT=3000\nNODE_ENV=development")).toEqual({
      NODE_ENV: "development",
      PORT: "3000",
    });
  });

  it("throws for malformed lines", () => {
    expect(() => envTextToRecord("not-valid")).toThrow();
  });
});

function createCommand(input: Partial<CommandConfig> & Pick<CommandConfig, "id">): CommandConfig {
  return {
    command: "bun dev",
    cwd: ".",
    id: input.id,
    name: input.name ?? input.id,
    startMode: input.startMode ?? "manual",
    type: input.type ?? "service",
  };
}

function createCommandTab(commandId: string, sortOrder: number): ProjectTabRecord {
  return {
    commandId,
    createdAt: "2026-03-24T00:00:00.000Z",
    id: `command:${commandId}`,
    kind: "command",
    projectId: "project-1",
    shellCwd: ".",
    sortOrder,
    title: commandId,
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("getPreferredCommandTabId", () => {
  it("prefers the first service command tab", () => {
    const commands = [
      createCommand({ id: "build", type: "action" }),
      createCommand({ id: "api", type: "service" }),
      createCommand({ id: "web", type: "service" }),
    ];
    const tabs = [
      createCommandTab("build", 0),
      createCommandTab("api", 1),
      createCommandTab("web", 2),
    ];

    expect(getPreferredCommandTabId(commands, tabs)).toBe("command:api");
  });

  it("falls back to the first action command tab when no service exists", () => {
    const commands = [
      createCommand({ id: "build", type: "action" }),
      createCommand({ id: "lint", type: "action" }),
    ];
    const tabs = [createCommandTab("build", 0), createCommandTab("lint", 1)];

    expect(getPreferredCommandTabId(commands, tabs)).toBe("command:build");
  });
});
