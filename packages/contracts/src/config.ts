import * as z from "zod";

export const CONFIG_FILE_NAME = "kickstart.json";
export const COMMAND_ID_MAX_LENGTH = 64;

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

export const commandTypeSchema = z.enum(["service", "action"]);
export const commandStartModeSchema = z.enum(["auto", "manual"]);

export const persistedCommandConfigSchema = z.object({
  command: z.string().trim().min(1),
  cwd: z.string().trim().min(1).default("."),
  env: commandEnvironmentSchema.optional(),
  id: z
    .string()
    .trim()
    .min(1)
    .max(COMMAND_ID_MAX_LENGTH)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  name: z.string().trim().min(1).max(80).optional(),
  type: commandTypeSchema.default("service"),
  startMode: commandStartModeSchema.default("manual"),
});

export const commandConfigSchema = persistedCommandConfigSchema.extend({
  id: z
    .string()
    .trim()
    .min(1)
    .max(COMMAND_ID_MAX_LENGTH)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(80),
});

export const persistedKickstartConfigSchema = z.object({
  commands: z.array(persistedCommandConfigSchema).default([]),
});

export const kickstartConfigSchema = z.object({
  commands: z.array(commandConfigSchema).default([]),
});

export type PersistedCommandConfig = z.infer<typeof persistedCommandConfigSchema>;
export type CommandConfig = z.infer<typeof commandConfigSchema>;
export interface EditableCommandConfig
  extends Omit<PersistedCommandConfig, "id" | "startMode" | "type"> {
  id: string;
  startMode: CommandStartMode;
  type: CommandType;
}
export interface EditableKickstartConfig {
  commands: EditableCommandConfig[];
}
export type PersistedKickstartConfig = z.infer<typeof persistedKickstartConfigSchema>;
export type KickstartConfig = z.infer<typeof kickstartConfigSchema>;
export type CommandType = z.infer<typeof commandTypeSchema>;
export type CommandStartMode = z.infer<typeof commandStartModeSchema>;

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
