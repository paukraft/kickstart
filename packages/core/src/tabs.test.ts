import { describe, expect, it } from "vitest";

import {
  createCommandTabId,
  createEffectiveCommandId,
  type ProjectTabRecord,
  type ResolvedCommandConfig,
} from "@kickstart/contracts";

import { mergeProjectTabs } from "./tabs";

function createCommand(commandId: string, name = "Dev"): ResolvedCommandConfig {
  return {
    command: "bun dev",
    cwd: ".",
    id: createEffectiveCommandId("shared", commandId),
    name,
    source: "shared",
    sourceCommandId: commandId,
    startMode: "manual",
    type: "service",
  };
}

function createCommandTab(commandId: string): ProjectTabRecord {
  const effectiveCommandId = createEffectiveCommandId("shared", commandId);
  return {
    commandId: effectiveCommandId,
    createdAt: "2026-03-24T00:00:00.000Z",
    id: createCommandTabId(effectiveCommandId),
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

    const tabs = mergeProjectTabs(
      "project-1",
      [],
      existingTabs,
      new Set([createCommandTabId(createEffectiveCommandId("shared", "dev"))]),
    );

    expect(tabs).toEqual([
      expect.objectContaining({
        commandId: createEffectiveCommandId("shared", "dev"),
        id: createCommandTabId(createEffectiveCommandId("shared", "dev")),
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
        commandId: createEffectiveCommandId("shared", "dev"),
        id: createCommandTabId(createEffectiveCommandId("shared", "dev")),
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
