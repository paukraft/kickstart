import path from "node:path";

import {
  CONFIG_FILE_NAME,
  COMMAND_ID_MAX_LENGTH,
  type CommandConfig,
  type CommandSource,
  type EditableCommandConfig,
  type EditableKickstartConfig,
  type KickstartConfig,
  type PersistedCommandConfig,
  type ResolvedCommandConfig,
  type ResolvedKickstartConfig,
  createEffectiveCommandId,
  deriveCommandId,
  deriveCommandName,
  editableKickstartConfigSchema,
  kickstartConfigSchema,
  normalizeCommandBehavior,
  normalizeCommandId,
  persistedKickstartConfigSchema,
} from "@kickstart/contracts";

function commandSignature(command: PersistedCommandConfig): string {
  return `${command.cwd}\u0000${command.command}`;
}

function appendCommandIdSuffix(commandId: string, suffix: number): string {
  const token = `-${suffix}`;
  const maxBaseLength = COMMAND_ID_MAX_LENGTH - token.length;
  const base = commandId.slice(0, Math.max(0, maxBaseLength)).replace(/-+$/g, "");
  return `${base || "command"}${token}`;
}

function nextAvailableCommandId(commandId: string, used: ReadonlySet<string>, startSuffix = 2): string {
  if (!used.has(commandId)) {
    return commandId;
  }
  let suffix = startSuffix;
  while (true) {
    const candidate = appendCommandIdSuffix(commandId, suffix);
    if (!used.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function hydrateEditableCommands(commands: PersistedCommandConfig[]): EditableCommandConfig[] {
  const used = new Set<string>();
  const signatureCounts = new Map<string, number>();
  return commands.map((command) => {
    const normalizedCommand = normalizeCommandBehavior(command);
    const signature = commandSignature(normalizedCommand);
    const occurrence = (signatureCounts.get(signature) ?? 0) + 1;
    signatureCounts.set(signature, occurrence);
    const baseId = normalizeCommandId(
      normalizedCommand.id ?? deriveCommandId(normalizedCommand.command, normalizedCommand.cwd),
    );
    const nextId =
      occurrence === 1
        ? nextAvailableCommandId(baseId, used)
        : nextAvailableCommandId(appendCommandIdSuffix(baseId, occurrence), used, occurrence + 1);
    used.add(nextId);
    return {
      ...normalizedCommand,
      id: nextId,
    };
  });
}

function hydrateCommands(commands: PersistedCommandConfig[]): CommandConfig[] {
  return hydrateEditableCommands(commands).map((command) => ({
    ...command,
    name: command.name ?? deriveCommandName(command.command),
  }));
}

function resolveSourceCommands(
  source: CommandSource,
  config: EditableKickstartConfig | KickstartConfig | null | undefined,
): ResolvedCommandConfig[] {
  if (!config) {
    return [];
  }

  return normalizeKickstartConfig(config).commands.map((command) => ({
    ...command,
    id: createEffectiveCommandId(source, command.id),
    source,
    sourceCommandId: command.id,
  }));
}

export function reorderResolvedCommands(
  commands: readonly ResolvedCommandConfig[],
  orderedCommandIds: readonly string[],
): ResolvedCommandConfig[] {
  const byId = new Map<string, ResolvedCommandConfig>(
    commands.map((command) => [command.id, command]),
  );
  const ordered: ResolvedCommandConfig[] = [];
  const seen = new Set<string>();

  for (const commandId of orderedCommandIds) {
    const command = byId.get(commandId);
    if (!command || seen.has(command.id)) {
      continue;
    }
    ordered.push(command);
    seen.add(command.id);
  }

  for (const command of commands) {
    if (seen.has(command.id)) {
      continue;
    }
    ordered.push(command);
  }

  return ordered;
}

export function hydrateEditableKickstartConfig(input: unknown): EditableKickstartConfig {
  const parsed = persistedKickstartConfigSchema.parse(input);
  return editableKickstartConfigSchema.parse({
    commands: hydrateEditableCommands(parsed.commands),
  });
}

export function normalizeKickstartConfig(input: unknown): KickstartConfig {
  const parsed = persistedKickstartConfigSchema.parse(input);
  return kickstartConfigSchema.parse({
    commands: hydrateCommands(parsed.commands),
  });
}

export function resolveMergedKickstartConfig(args: {
  local?: EditableKickstartConfig | KickstartConfig | null;
  shared?: EditableKickstartConfig | KickstartConfig | null;
}): ResolvedKickstartConfig {
  const commands = [
    ...resolveSourceCommands("shared", args.shared),
    ...resolveSourceCommands("local", args.local),
  ];

  return {
    commands,
  };
}

export function createEmptyKickstartConfig(): KickstartConfig {
  return normalizeKickstartConfig({
    commands: [],
  });
}

export function createCommandInConfig(
  config: KickstartConfig,
  command: EditableCommandConfig,
): KickstartConfig {
  const existingCommands: EditableCommandConfig[] = config.commands.map((item) => ({
    ...item,
  }));
  return normalizeKickstartConfig({
    ...config,
    commands: [...existingCommands, command],
  });
}

export function stringifyKickstartConfig(input: KickstartConfig): string {
  const normalized = normalizeKickstartConfig(input);
  const persisted = {
    commands: normalized.commands.map(({ id: _id, ...command }) => ({
      command: command.command,
      ...(command.cwd !== "." ? { cwd: command.cwd } : {}),
      ...(command.env ? { env: command.env } : {}),
      id: _id,
      ...(command.name !== deriveCommandName(command.command) ? { name: command.name } : {}),
      ...(command.soundId !== null && command.soundId !== undefined
        ? { soundId: command.soundId }
        : {}),
      ...(command.type !== "service" ? { type: command.type } : {}),
      ...(command.startMode !== "manual" ? { startMode: command.startMode } : {}),
    })),
  };
  return `${JSON.stringify(persisted, null, 2)}\n`;
}

export function kickstartConfigPath(projectPath: string): string {
  return path.join(projectPath, CONFIG_FILE_NAME);
}

export function upsertCommandInConfig(
  config: KickstartConfig,
  command: EditableCommandConfig,
): KickstartConfig {
  const nextCommands: EditableCommandConfig[] = config.commands.map((item) => ({
    ...item,
  }));
  const index = nextCommands.findIndex((item) => item.id === command.id);
  if (index >= 0) {
    nextCommands[index] = command;
  } else {
    nextCommands.push(command);
  }
  return normalizeKickstartConfig({
    ...config,
    commands: nextCommands,
  });
}

export function deleteCommandFromConfig(
  config: KickstartConfig,
  commandId: string,
): KickstartConfig {
  return normalizeKickstartConfig({
    ...config,
    commands: config.commands.filter((command) => command.id !== commandId),
  });
}

export function reorderCommandsInConfig(
  config: KickstartConfig,
  commandIds: string[],
): KickstartConfig {
  const byId = new Map(config.commands.map((command) => [command.id, command]));
  const ordered = commandIds
    .map((id) => byId.get(id))
    .filter((command): command is CommandConfig => Boolean(command));
  const remaining = config.commands.filter((command) => !commandIds.includes(command.id));
  return normalizeKickstartConfig({
    ...config,
    commands: [...ordered, ...remaining],
  });
}

export function resolveSourceCommandOrder(
  commands: readonly ResolvedCommandConfig[],
  source: CommandSource,
): string[] {
  return commands
    .filter((command) => command.source === source)
    .map((command) => command.sourceCommandId);
}
