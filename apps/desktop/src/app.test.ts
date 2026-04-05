import { describe, expect, it } from "vitest";

import type { ProjectTabRecord, ResolvedCommandConfig } from "@kickstart/contracts";
import { createCommandTabId, createEffectiveCommandId } from "@kickstart/contracts";

import {
  getBrokenSharedConfigBanner,
  mergeSelectedProjectRuntime,
  reorderCommandsWithinSection,
} from "./app";

function createCommand(
  input: Partial<ResolvedCommandConfig> & Pick<ResolvedCommandConfig, "source" | "sourceCommandId" | "type">,
): ResolvedCommandConfig {
  const id = input.id ?? createEffectiveCommandId(input.source, input.sourceCommandId);
  return {
    command: "bun dev",
    cwd: ".",
    id,
    name: input.name ?? id,
    source: input.source,
    sourceCommandId: input.sourceCommandId,
    startMode: input.startMode ?? "manual",
    type: input.type,
  };
}

function createTab(command: ResolvedCommandConfig, sortOrder: number): ProjectTabRecord {
  return {
    commandId: command.id,
    createdAt: "2026-04-05T00:00:00.000Z",
    id: createCommandTabId(command.id),
    kind: "command",
    projectId: "project-1",
    shellCwd: command.cwd,
    sortOrder,
    title: command.name,
    updatedAt: "2026-04-05T00:00:00.000Z",
  };
}

describe("reorderCommandsWithinSection", () => {
  it("reorders only the dragged shared service section and preserves other commands", () => {
    const commands = [
      createCommand({ source: "shared", sourceCommandId: "alpha", type: "service" }),
      createCommand({ source: "shared", sourceCommandId: "build", type: "action" }),
      createCommand({ source: "shared", sourceCommandId: "beta", type: "service" }),
      createCommand({ source: "local", sourceCommandId: "dev", type: "service" }),
      createCommand({ source: "local", sourceCommandId: "lint", type: "action" }),
    ];
    const tabs = commands.map(createTab);

    expect(
      reorderCommandsWithinSection({
        commandTabs: tabs,
        commands,
        source: "shared",
        sourceId: createCommandTabId(createEffectiveCommandId("shared", "beta")),
        targetId: createCommandTabId(createEffectiveCommandId("shared", "alpha")),
        type: "service",
      }),
    ).toEqual([
      createEffectiveCommandId("shared", "beta"),
      createEffectiveCommandId("shared", "build"),
      createEffectiveCommandId("shared", "alpha"),
      createEffectiveCommandId("local", "dev"),
      createEffectiveCommandId("local", "lint"),
    ]);
  });

  it("reorders only the dragged local action section and keeps services in place", () => {
    const commands = [
      createCommand({ source: "shared", sourceCommandId: "dev", type: "service" }),
      createCommand({ source: "local", sourceCommandId: "build", type: "action" }),
      createCommand({ source: "local", sourceCommandId: "test", type: "action" }),
      createCommand({ source: "local", sourceCommandId: "preview", type: "service" }),
    ];
    const tabs = commands.map(createTab);

    expect(
      reorderCommandsWithinSection({
        commandTabs: tabs,
        commands,
        source: "local",
        sourceId: createCommandTabId(createEffectiveCommandId("local", "test")),
        targetId: createCommandTabId(createEffectiveCommandId("local", "build")),
        type: "action",
      }),
    ).toEqual([
      createEffectiveCommandId("shared", "dev"),
      createEffectiveCommandId("local", "test"),
      createEffectiveCommandId("local", "build"),
      createEffectiveCommandId("local", "preview"),
    ]);
  });
});

describe("mergeSelectedProjectRuntime", () => {
  it("overlays live command metadata onto the selected project", () => {
    expect(
      mergeSelectedProjectRuntime(
        {
          groupId: null,
          hasCommands: false,
          iconUrl: null,
          id: "project-1",
          name: "Alpha",
          path: "/tmp/alpha",
          sharedConfigExists: false,
          startupCommandCount: 0,
          runningCommandCount: 0,
          runtimeState: "not-running",
          sortOrder: 0,
        },
        {
          hasCommands: true,
          sharedConfigExists: true,
          startupCommandCount: 2,
        },
        { isCurrentProjectConfig: true },
      ),
    ).toMatchObject({
      hasCommands: true,
      sharedConfigExists: true,
      startupCommandCount: 2,
    });
  });

  it("returns null for an absent project", () => {
    expect(
      mergeSelectedProjectRuntime(null, {
        hasCommands: true,
        sharedConfigExists: true,
        startupCommandCount: 1,
      }, { isCurrentProjectConfig: true }),
    ).toBeNull();
  });

  it("preserves the cached project when the live config belongs to another project", () => {
    const project = {
      groupId: null,
      hasCommands: false,
      iconUrl: null,
      id: "project-1",
      name: "Alpha",
      path: "/tmp/alpha",
      sharedConfigExists: false,
      startupCommandCount: 0,
      runningCommandCount: 0,
      runtimeState: "not-running" as const,
      sortOrder: 0,
    };

    expect(
      mergeSelectedProjectRuntime(
        project,
        {
          hasCommands: true,
          sharedConfigExists: true,
          startupCommandCount: 2,
        },
        { isCurrentProjectConfig: false },
      ),
    ).toBe(project);
  });
});

describe("getBrokenSharedConfigBanner", () => {
  const project = {
    groupId: null,
    hasCommands: true,
    iconUrl: null,
    id: "project-1",
    name: "Alpha",
    path: "/tmp/alpha",
    sharedConfigExists: true,
    startupCommandCount: 1,
    runningCommandCount: 0,
    runtimeState: "not-running" as const,
    sortOrder: 0,
  };

  it("returns a banner for the selected project when the shared config is broken", () => {
    expect(
      getBrokenSharedConfigBanner({
        project,
        projectConfig: {
          hasCommands: false,
          local: { config: null, configError: null, configExists: false },
          shared: {
            config: null,
            configError: "Unexpected token } in JSON at position 18",
            configExists: true,
          },
        },
        projectConfigProjectId: "project-1",
        selectedProjectId: "project-1",
      }),
    ).toEqual({
      detail: "Unexpected token } in JSON at position 18",
      title: "Alpha has an invalid kickstart.json",
    });
  });

  it("returns null when the loaded config belongs to another project", () => {
    expect(
      getBrokenSharedConfigBanner({
        project,
        projectConfig: {
          hasCommands: false,
          local: { config: null, configError: null, configExists: false },
          shared: {
            config: null,
            configError: "Unexpected token } in JSON at position 18",
            configExists: true,
          },
        },
        projectConfigProjectId: "project-2",
        selectedProjectId: "project-1",
      }),
    ).toBeNull();
  });

  it("returns null when there is no shared config error", () => {
    expect(
      getBrokenSharedConfigBanner({
        project,
        projectConfig: {
          hasCommands: true,
          local: { config: null, configError: null, configExists: false },
          shared: {
            config: { commands: [] },
            configError: null,
            configExists: true,
          },
        },
        projectConfigProjectId: "project-1",
        selectedProjectId: "project-1",
      }),
    ).toBeNull();
  });
});
