import { describe, expect, it } from "vitest";

import type { CommandConfig, ProjectTabRecord } from "@kickstart/contracts";

import { mergeProjectTabs } from "./tabs";

function createCommand(commandId: string, name = "Dev"): CommandConfig {
  return {
    command: "bun dev",
    cwd: ".",
    id: commandId,
    name,
    startMode: "manual",
    type: "service",
  };
}

function createCommandTab(commandId: string): ProjectTabRecord {
  return {
    commandId,
    createdAt: "2026-03-24T00:00:00.000Z",
    id: `command:${commandId}`,
    kind: "command",
    projectId: "project-1",
    shellCwd: ".",
    sortOrder: 0,
    title: "Dev",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("mergeProjectTabs", () => {
  it("moves running missing command tabs into the shell section", () => {
    const existingTabs = [
      createCommandTab("dev"),
      {
        commandId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        id: "shell:1",
        kind: "shell" as const,
        projectId: "project-1",
        shellCwd: ".",
        sortOrder: 1,
        title: "Shell 1",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    ];

    const tabs = mergeProjectTabs("project-1", [], existingTabs, new Set(["command:dev"]));

    expect(tabs).toEqual([
      expect.objectContaining({
        commandId: "dev",
        id: "command:dev",
        kind: "shell",
        title: "Dev",
      }),
      expect.objectContaining({
        commandId: null,
        id: "shell:1",
        kind: "shell",
      }),
    ]);
  });

  it("restores preserved shell tabs back into command tabs when the command returns", () => {
    const existingTabs = [
      {
        ...createCommandTab("dev"),
        kind: "shell" as const,
      },
    ];

    const tabs = mergeProjectTabs("project-1", [createCommand("dev")], existingTabs);

    expect(tabs).toEqual([
      expect.objectContaining({
        commandId: "dev",
        id: "command:dev",
        kind: "command",
        title: "Dev",
      }),
    ]);
  });

  it("drops missing command tabs that are not still active at branch switch time", () => {
    const tabs = mergeProjectTabs("project-1", [], [createCommandTab("dev")]);

    expect(tabs).toEqual([]);
  });
});
