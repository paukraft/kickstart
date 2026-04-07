import { describe, expect, it } from "vitest";

import type { ProjectTabRecord, ResolvedCommandConfig } from "@kickstart/contracts";
import { createCommandTabId, createEffectiveCommandId } from "@kickstart/contracts";

import {
  getBrokenSharedConfigBanner,
  mergeSelectedProjectRuntime,
  reorderCommandsWithinSection,
  resolveRefreshedSelectedTabId,
  resolveSelectedProjectId,
  shouldBlockProjectScopedShortcut,
  shouldClearPendingProjectSettingsId,
  shouldOpenPendingProjectSettings,
  shouldProcessVisibleProjectTerminalEvent,
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

function createShellTab(input: {
  id: string;
  projectId?: string;
  sortOrder: number;
  title?: string;
}): ProjectTabRecord {
  return {
    commandId: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    id: input.id,
    kind: "shell",
    projectId: input.projectId ?? "project-1",
    shellCwd: null,
    sortOrder: input.sortOrder,
    title: input.title ?? input.id,
    updatedAt: "2026-04-05T00:00:00.000Z",
  };
}

function createProject(input: {
  id: string;
  name: string;
  runtimeState: "not-running" | "running" | "starting" | "stopping" | "partially-running";
  sortOrder: number;
}) {
  return {
    groupId: null,
    hasCommands: true,
    iconUrl: null,
    id: input.id,
    name: input.name,
    path: `/tmp/${input.id}`,
    runningCommandCount: input.runtimeState === "running" ? 1 : 0,
    sharedConfigExists: true,
    startupCommandCount: 1,
    runtimeState: input.runtimeState,
    sortOrder: input.sortOrder,
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

describe("resolveSelectedProjectId", () => {
  const projects = [
    {
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
    },
    {
      groupId: null,
      hasCommands: true,
      iconUrl: null,
      id: "project-2",
      name: "Beta",
      path: "/tmp/beta",
      sharedConfigExists: true,
      startupCommandCount: 1,
      runningCommandCount: 0,
      runtimeState: "not-running" as const,
      sortOrder: 1,
    },
  ];

  it("hydrates the persisted project selection on startup", () => {
    expect(
      resolveSelectedProjectId({
        currentSelectedProjectId: null,
        persistedSelectedProjectId: "project-2",
        projects,
      }),
    ).toBe("project-2");
  });

  it("keeps the in-memory selection during refresh when it is still valid", () => {
    expect(
      resolveSelectedProjectId({
        currentSelectedProjectId: "project-1",
        keepSelection: true,
        persistedSelectedProjectId: "project-2",
        projects,
      }),
    ).toBe("project-1");
  });

  it("falls back to general when the persisted project no longer exists", () => {
    expect(
      resolveSelectedProjectId({
        currentSelectedProjectId: null,
        persistedSelectedProjectId: "missing-project",
        projects,
      }),
    ).toBe("general");
  });
});

describe("resolveRefreshedSelectedTabId", () => {
  it("trusts the persisted active tab when switching projects", () => {
    const currentSelectedTabId = createCommandTabId(createEffectiveCommandId("shared", "dev"));
    const persistedActiveTabId = "shell:notes";
    const nextTabs = [
      createTab(createCommand({ source: "shared", sourceCommandId: "dev", type: "service" }), 0),
      createShellTab({ id: persistedActiveTabId, projectId: "project-2", sortOrder: 1, title: "Notes" }),
    ];

    expect(
      resolveRefreshedSelectedTabId({
        currentSelectedTabId,
        nextTabs,
        persistedActiveTabId,
        previousProjectId: "project-1",
        projectId: "project-2",
      }),
    ).toBe(persistedActiveTabId);
  });

  it("preserves the current tab during a same-project refresh when it still exists", () => {
    const currentSelectedTabId = "shell:notes";
    const persistedActiveTabId = createCommandTabId(createEffectiveCommandId("shared", "dev"));
    const nextTabs = [
      createTab(createCommand({ source: "shared", sourceCommandId: "dev", type: "service" }), 0),
      createShellTab({ id: currentSelectedTabId, sortOrder: 1, title: "Notes" }),
    ];

    expect(
      resolveRefreshedSelectedTabId({
        currentSelectedTabId,
        nextTabs,
        persistedActiveTabId,
        previousProjectId: "project-1",
        projectId: "project-1",
      }),
    ).toBe(currentSelectedTabId);
  });

  it("falls back to the first tab when neither preferred tab exists", () => {
    const firstTabId = createCommandTabId(createEffectiveCommandId("shared", "dev"));
    const nextTabs = [
      createTab(createCommand({ source: "shared", sourceCommandId: "dev", type: "service" }), 0),
      createShellTab({ id: "shell:notes", sortOrder: 1, title: "Notes" }),
    ];

    expect(
      resolveRefreshedSelectedTabId({
        currentSelectedTabId: "shell:missing",
        nextTabs,
        persistedActiveTabId: "shell:also-missing",
        previousProjectId: "project-1",
        projectId: "project-1",
      }),
    ).toBe(firstTabId);
  });
});

describe("selected project runtime refresh", () => {
  it("uses the latest project snapshot after a selection change", () => {
    const staleProjects = [
      createProject({
        id: "project-1",
        name: "Alpha",
        runtimeState: "not-running",
        sortOrder: 0,
      }),
      createProject({
        id: "project-2",
        name: "Beta",
        runtimeState: "not-running",
        sortOrder: 1,
      }),
    ];
    const refreshedProjects = [
      staleProjects[0],
      createProject({
        id: "project-2",
        name: "Beta",
        runtimeState: "running",
        sortOrder: 1,
      }),
    ];

    const staleSelection = mergeSelectedProjectRuntime(
      staleProjects.find((project) => project.id === "project-2") ?? null,
      {
        hasCommands: true,
        sharedConfigExists: true,
        startupCommandCount: 1,
      },
      { isCurrentProjectConfig: true },
    );
    const refreshedSelection = mergeSelectedProjectRuntime(
      refreshedProjects.find((project) => project.id === "project-2") ?? null,
      {
        hasCommands: true,
        sharedConfigExists: true,
        startupCommandCount: 1,
      },
      { isCurrentProjectConfig: true },
    );

    expect(staleSelection?.runtimeState).toBe("not-running");
    expect(refreshedSelection?.runtimeState).toBe("running");
  });
});

describe("shouldProcessVisibleProjectTerminalEvent", () => {
  it("tracks terminal events for the visible hydrated project while selection is still catching up", () => {
    expect(
      shouldProcessVisibleProjectTerminalEvent({
        displayedProjectId: "project-1",
        event: {
          projectId: "project-1",
          type: "updated",
        },
      }),
    ).toBe(true);
  });

  it("ignores terminal events for the newly selected project until it becomes visible", () => {
    expect(
      shouldProcessVisibleProjectTerminalEvent({
        displayedProjectId: "project-1",
        event: {
          projectId: "project-2",
          type: "updated",
        },
      }),
    ).toBe(false);
  });

  it("ignores event types that do not affect runtime refresh", () => {
    expect(
      shouldProcessVisibleProjectTerminalEvent({
        displayedProjectId: "project-1",
        event: {
          projectId: "project-1",
          type: "output",
        },
      }),
    ).toBe(false);
  });
});

describe("shouldBlockProjectScopedShortcut", () => {
  it("blocks project-scoped shortcuts while project state is hydrating", () => {
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "new-shell-tab",
        isProjectStateLoading: true,
      }),
    ).toBe(true);
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "select-tab-1",
        isProjectStateLoading: true,
      }),
    ).toBe(true);
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "open-project-settings",
        isProjectStateLoading: true,
      }),
    ).toBe(true);
  });

  it("allows global shortcuts while project state is hydrating", () => {
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "show-keyboard-shortcuts",
        isProjectStateLoading: true,
      }),
    ).toBe(false);
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "toggle-project-command-menu",
        isProjectStateLoading: true,
      }),
    ).toBe(false);
  });

  it("allows project-scoped shortcuts once hydration is complete", () => {
    expect(
      shouldBlockProjectScopedShortcut({
        actionId: "close-tab",
        isProjectStateLoading: false,
      }),
    ).toBe(false);
  });
});

describe("pending project settings intent", () => {
  it("clears the pending settings request after unrelated navigation", () => {
    expect(
      shouldClearPendingProjectSettingsId({
        pendingProjectSettingsId: "project-2",
        selectedProjectId: "project-3",
      }),
    ).toBe(true);
  });

  it("keeps the pending settings request while the same project is still selected", () => {
    expect(
      shouldClearPendingProjectSettingsId({
        pendingProjectSettingsId: "project-2",
        selectedProjectId: "project-2",
      }),
    ).toBe(false);
  });

  it("opens when the requested project finishes hydrating", () => {
    expect(
      shouldOpenPendingProjectSettings({
        hydratedProjectId: "project-2",
        pendingProjectSettingsId: "project-2",
      }),
    ).toBe(true);
  });

  it("does not open until the requested project hydrates", () => {
    expect(
      shouldOpenPendingProjectSettings({
        hydratedProjectId: "project-1",
        pendingProjectSettingsId: "project-2",
      }),
    ).toBe(false);
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
