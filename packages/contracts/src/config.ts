import * as z from "zod";

export const CONFIG_FILE_NAME = "kickstart.json";
export const COMMAND_ID_MAX_LENGTH = 64;
export const COMMAND_SOURCE_IDS = ["shared", "local"] as const;
export const EFFECTIVE_COMMAND_ID_SEPARATOR = ":";
export const COMMAND_TAB_ID_PREFIX = "command:";

export function normalizeCommandId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, COMMAND_ID_MAX_LENGTH) : "command";
}

export function deriveCommandId(command: string, cwd: string): string {
  const cleaned = [cwd, command]
    .map(normalizeCommandId)
    .filter(Boolean)
    .join("-");
  return cleaned.length > 0 ? cleaned.slice(0, COMMAND_ID_MAX_LENGTH) : "command";
}

export const commandEnvironmentSchema = z.record(
  z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  z.string().max(8_192),
);

export const commandSourceSchema = z.enum(COMMAND_SOURCE_IDS);
export const commandTypeSchema = z.enum(["service", "action"]);
export const commandStartModeSchema = z.enum(["auto", "manual"]);
export const soundIdSchema = z.enum(["neutral", "happy"]);
export const SOUND_IDS = soundIdSchema.options;
export const commandIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMMAND_ID_MAX_LENGTH)
  .regex(/^[a-z0-9-]+$/);
export const commandNameSchema = z.string().trim().min(1).max(80);

export const persistedCommandConfigSchema = z.object({
  command: z.string().trim().min(1),
  cwd: z.string().trim().min(1).default("."),
  env: commandEnvironmentSchema.optional(),
  id: commandIdSchema.optional(),
  name: commandNameSchema.optional(),
  soundId: soundIdSchema.nullable().optional(),
  type: commandTypeSchema.default("service"),
  startMode: commandStartModeSchema.default("manual"),
});

export const commandConfigSchema = persistedCommandConfigSchema.extend({
  id: commandIdSchema,
  name: commandNameSchema,
});

export const persistedKickstartConfigSchema = z.object({
  commands: z.array(persistedCommandConfigSchema).default([]),
});

export const kickstartConfigSchema = z.object({
  commands: z.array(commandConfigSchema).default([]),
});

export const editableCommandConfigSchema = persistedCommandConfigSchema.extend({
  id: commandIdSchema,
  type: commandTypeSchema,
  startMode: commandStartModeSchema,
});

export const editableKickstartConfigSchema = z.object({
  commands: z.array(editableCommandConfigSchema).default([]),
});

export type PersistedCommandConfig = z.infer<typeof persistedCommandConfigSchema>;
export type CommandConfig = z.infer<typeof commandConfigSchema>;
export type EditableCommandConfig = z.infer<typeof editableCommandConfigSchema>;
export type EditableKickstartConfig = z.infer<typeof editableKickstartConfigSchema>;
export type PersistedKickstartConfig = z.infer<typeof persistedKickstartConfigSchema>;
export type KickstartConfig = z.infer<typeof kickstartConfigSchema>;
export type CommandSource = z.infer<typeof commandSourceSchema>;
export type CommandType = z.infer<typeof commandTypeSchema>;
export type CommandStartMode = z.infer<typeof commandStartModeSchema>;
export type SoundId = z.infer<typeof soundIdSchema>;
export type EffectiveCommandId = `${CommandSource}${typeof EFFECTIVE_COMMAND_ID_SEPARATOR}${string}`;
export type CommandTabId = `${typeof COMMAND_TAB_ID_PREFIX}${string}`;
export type ResolvedCommandConfig = Omit<CommandConfig, "id"> & {
  id: EffectiveCommandId;
  source: CommandSource;
  sourceCommandId: CommandConfig["id"];
};
export type ResolvedKickstartConfig = {
  commands: ResolvedCommandConfig[];
};

type CommandBehavior = Pick<PersistedCommandConfig, "startMode" | "type">;

export function normalizeCommandBehavior<T extends CommandBehavior>(command: T): T {
  if (command.type === "action" && command.startMode === "auto") {
    return {
      ...command,
      startMode: "manual",
    } as T;
  }
  return command;
}

export function isActionCommand(command: Pick<CommandBehavior, "type">): boolean {
  return command.type === "action";
}

export function isServiceCommand(command: Pick<CommandBehavior, "type">): boolean {
  return command.type === "service";
}

export function isAutoStartCommand(command: CommandBehavior): boolean {
  const normalized = normalizeCommandBehavior(command);
  return normalized.type === "service" && normalized.startMode === "auto";
}

export function deriveCommandName(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : "Command";
}

export function createEffectiveCommandId(
  source: CommandSource,
  sourceCommandId: string,
): EffectiveCommandId {
  return `${source}${EFFECTIVE_COMMAND_ID_SEPARATOR}${sourceCommandId}` as EffectiveCommandId;
}

export function createCommandTabId(commandId: string): CommandTabId {
  return `${COMMAND_TAB_ID_PREFIX}${commandId}` as CommandTabId;
}

export function parseCommandTabId(value: string): {
  commandId: string;
} | null {
  if (!value.startsWith(COMMAND_TAB_ID_PREFIX)) {
    return null;
  }

  const commandId = value.slice(COMMAND_TAB_ID_PREFIX.length);
  if (!commandId) {
    return null;
  }

  return { commandId };
}

export function parseEffectiveCommandId(value: string): {
  source: CommandSource;
  sourceCommandId: string;
} | null {
  const separatorIndex = value.indexOf(EFFECTIVE_COMMAND_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const source = value.slice(0, separatorIndex);
  const sourceCommandId = value.slice(separatorIndex + EFFECTIVE_COMMAND_ID_SEPARATOR.length);
  const parsedSource = commandSourceSchema.safeParse(source);
  if (!parsedSource.success || !commandIdSchema.safeParse(sourceCommandId).success) {
    return null;
  }

  return {
    source: parsedSource.data,
    sourceCommandId,
  };
}
