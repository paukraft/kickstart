import type { CommandConfig, ProjectTabRecord } from "@kickstart/contracts";

function createCommandTab(projectId: string, command: CommandConfig, index: number): ProjectTabRecord {
  const timestamp = new Date().toISOString();
  return {
    commandId: command.id,
    createdAt: timestamp,
    id: `command:${command.id}`,
    kind: "command",
    projectId,
    shellCwd: command.cwd,
    sortOrder: index,
    title: command.name,
    updatedAt: timestamp,
  };
}

export function mergeProjectTabs(
  projectId: string,
  commands: CommandConfig[],
  existingTabs: ProjectTabRecord[],
  runningTabIds: ReadonlySet<string> = new Set(),
): ProjectTabRecord[] {
  const timestamp = new Date().toISOString();
  const commandIds = new Set(commands.map((command) => command.id));
  const existingTabsById = new Map(existingTabs.map((tab) => [tab.id, tab]));
  const restoredCommandTabIds = new Set<string>();

  const commandTabs = commands.map((command, index) => {
    const tabId = `command:${command.id}`;
    const existing = existingTabsById.get(tabId);
    if (!existing) {
      return createCommandTab(projectId, command, index);
    }
    restoredCommandTabIds.add(tabId);
    return {
      ...existing,
      commandId: command.id,
      kind: "command" as const,
      shellCwd: command.cwd,
      sortOrder: index,
      title: command.name,
      updatedAt: timestamp,
    };
  });

  const shellTabs = existingTabs
    .flatMap((tab) => {
      if (restoredCommandTabIds.has(tab.id)) {
        return [];
      }

      if (tab.kind === "shell") {
        if (tab.commandId && commandIds.has(tab.commandId)) {
          return [];
        }
        return [tab];
      }

      if (!tab.commandId || commandIds.has(tab.commandId) || !runningTabIds.has(tab.id)) {
        return [];
      }

      return [
        {
          ...tab,
          kind: "shell" as const,
          updatedAt: timestamp,
        },
      ];
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return [
    ...commandTabs,
    ...shellTabs.map((tab, index) => ({
      ...tab,
      sortOrder: commandTabs.length + index,
    })),
  ];
}
