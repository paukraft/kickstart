import {
  isActionCommand,
  isServiceCommand,
  type CommandConfig,
  type ProjectTabRecord,
} from "@kickstart/contracts";

export function envRecordToText(env?: Record<string, string>) {
  if (!env) {
    return "";
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function envTextToRecord(input: string): Record<string, string> | undefined {
  const entries = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) {
        throw new Error(`Invalid env line: ${line}`);
      }
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid env key: ${key}`);
      }
      return [key, value] as const;
    });

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function commandByTabId(commands: CommandConfig[], tabId: string) {
  return commands.find((command) => `command:${command.id}` === tabId) ?? null;
}

export function getPreferredCommandTabId(
  commands: CommandConfig[],
  tabs: ProjectTabRecord[],
) {
  const commandTabs = tabs.filter((tab) => tab.kind === "command");
  const serviceTab = commandTabs.find((tab) => {
    const command = commandByTabId(commands, tab.id);
    return command != null && isServiceCommand(command);
  });

  if (serviceTab) {
    return serviceTab.id;
  }

  const actionTab = commandTabs.find((tab) => {
    const command = commandByTabId(commands, tab.id);
    return command != null && isActionCommand(command);
  });

  return actionTab?.id ?? null;
}
