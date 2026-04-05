import fs from "node:fs/promises";
import { existsSync } from "node:fs";

import type {
  EditableKickstartConfig,
  KickstartConfig,
  ProjectConfigPayload,
  ProjectConfigSourcePayload,
  ProjectRecord,
  ResolvedCommandConfig,
} from "@kickstart/contracts";
import { kickstartConfigPath } from "@kickstart/core";
import {
  hydrateEditableKickstartConfig,
  normalizeKickstartConfig,
  resolveMergedKickstartConfig,
  resolveSourceCommandOrder,
  stringifyKickstartConfig,
} from "@kickstart/core";

import type { AppStore } from "./app-store";

export interface PersistedProjectCommandSnapshot {
  localConfigJson: string | null;
  sharedConfigText: string | null;
}

function emptyProjectConfigSourcePayload(): ProjectConfigSourcePayload {
  return {
    config: null,
    configError: null,
    configExists: false,
  };
}

async function loadSharedProjectConfig(project: ProjectRecord): Promise<ProjectConfigSourcePayload> {
  const filePath = kickstartConfigPath(project.path);
  if (!existsSync(filePath)) {
    return emptyProjectConfigSourcePayload();
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return {
      config: hydrateEditableKickstartConfig(JSON.parse(raw)),
      configError: null,
      configExists: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kickstart-config] Failed to load config for ${project.path}: ${message}`);
    return {
      config: null,
      configError: message,
      configExists: true,
    };
  }
}

function loadLocalProjectConfig(store: AppStore, project: ProjectRecord): ProjectConfigSourcePayload {
  const state = store.getProjectCommandState(project.path);
  if (!state?.localConfigJson) {
    return emptyProjectConfigSourcePayload();
  }

  try {
    return {
      config: hydrateEditableKickstartConfig(JSON.parse(state.localConfigJson)),
      configError: null,
      configExists: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kickstart-local-config] Failed to load local config for ${project.path}: ${message}`);
    return {
      config: null,
      configError: message,
      configExists: true,
    };
  }
}

function hasCommands(config: ProjectConfigPayload) {
  return resolveProjectCommands(config).length > 0;
}

function serializeSharedProjectConfig(
  config: EditableKickstartConfig | KickstartConfig | null,
): string {
  if (!config) {
    throw new Error("Cannot persist empty shared config.");
  }

  return stringifyKickstartConfig(normalizeKickstartConfig(config));
}

function serializeLocalProjectConfig(
  config: EditableKickstartConfig | KickstartConfig | null,
): string | null {
  if (!config) {
    return null;
  }

  const normalized = normalizeKickstartConfig(config);
  if (normalized.commands.length === 0) {
    return null;
  }

  return stringifyKickstartConfig(normalized);
}

async function writeSharedProjectConfigText(project: ProjectRecord, configText: string | null) {
  const filePath = kickstartConfigPath(project.path);
  if (configText === null) {
    await fs.rm(filePath, { force: true });
    return;
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, configText, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function persistProjectCommandSnapshot(
  store: AppStore,
  project: ProjectRecord,
  snapshot: PersistedProjectCommandSnapshot,
) {
  await writeSharedProjectConfigText(project, snapshot.sharedConfigText);
  store.restoreProjectCommandState(project.path, {
    localConfigJson: snapshot.localConfigJson,
  });
}

export async function loadProjectCommandPayload(
  store: AppStore,
  project: ProjectRecord,
): Promise<ProjectConfigPayload> {
  const [shared, local] = await Promise.all([
    loadSharedProjectConfig(project),
    Promise.resolve(loadLocalProjectConfig(store, project)),
  ]);

  const payload: ProjectConfigPayload = {
    hasCommands: false,
    local,
    shared,
  };

  return {
    ...payload,
    hasCommands: hasCommands(payload),
  };
}

export function resolveProjectCommands(payload: ProjectConfigPayload): ResolvedCommandConfig[] {
  return resolveMergedKickstartConfig({
    local: payload.local.config,
    shared: payload.shared.config,
  }).commands;
}

export function decomposeResolvedCommands(commands: readonly ResolvedCommandConfig[]) {
  return {
    localCommandIds: resolveSourceCommandOrder(commands, "local"),
    sharedCommandIds: resolveSourceCommandOrder(commands, "shared"),
  };
}

export async function captureProjectCommandSnapshot(
  store: AppStore,
  project: ProjectRecord,
): Promise<PersistedProjectCommandSnapshot> {
  const filePath = kickstartConfigPath(project.path);
  const state = store.getProjectCommandState(project.path);

  return {
    localConfigJson: state?.localConfigJson ?? null,
    sharedConfigText: existsSync(filePath) ? await fs.readFile(filePath, "utf8") : null,
  };
}

export async function persistProjectCommandConfigs(args: {
  local?: EditableKickstartConfig | KickstartConfig | null;
  project: ProjectRecord;
  shared?: EditableKickstartConfig | KickstartConfig | null;
  store: AppStore;
}) {
  const previousState = await captureProjectCommandSnapshot(args.store, args.project);
  const nextState: PersistedProjectCommandSnapshot = { ...previousState };

  if ("shared" in args) {
    nextState.sharedConfigText =
      args.shared === undefined ? nextState.sharedConfigText : serializeSharedProjectConfig(args.shared);
  }

  if ("local" in args) {
    nextState.localConfigJson =
      args.local === undefined ? nextState.localConfigJson : serializeLocalProjectConfig(args.local);
  }

  try {
    await persistProjectCommandSnapshot(args.store, args.project, nextState);
  } catch (error) {
    try {
      await persistProjectCommandSnapshot(args.store, args.project, previousState);
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.error(
        `[kickstart-command-state] Failed to roll back command state for ${args.project.path}: ${rollbackMessage}`,
      );
    }

    throw error;
  }
}

export async function persistSharedProjectConfig(args: {
  config: EditableKickstartConfig | KickstartConfig | null;
  project: ProjectRecord;
  store: AppStore;
}) {
  await persistProjectCommandConfigs({
    project: args.project,
    shared: args.config,
    store: args.store,
  });
}
