import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  GENERAL_SPACE_ID,
  type ProjectRecord,
  type ProjectTabRecord,
  type ResolvedCommandConfig,
  type TerminalPortUsage,
  type TerminalCloseInput,
  type TerminalEvent,
  type TerminalOpenInput,
  type TerminalRestartInput,
  type TerminalResizeInput,
  type TerminalRunInput,
  type TerminalSerializeInput,
  type TerminalSessionOperation,
  type TerminalSessionSnapshot,
  type TerminalStopInput,
  type TerminalWriteInput,
} from "@kickstart/contracts";
import { resolveDefaultShell, resolveProjectCwd } from "@kickstart/core";
import * as nodePty from "node-pty";

import {
  buildPortUsageOwnershipContexts,
  collectDescendantProcessRows,
  collectTerminalOwnershipPids,
  joinListenerRecordsToPortUsages,
  loadPortlessRoutes,
  parseLsofTcpListenOutput,
  runScopedLsofForPids,
  type TerminalPortUsageSessionContext,
} from "./terminal-port-usage";
import { createTerminalStartupGate, type TerminalStartupGate } from "./terminal-startup";

interface TerminalSessionState {
  cols: number;
  closing: boolean;
  cwd: string;
  desiredRunState: "idle" | "running";
  history: string;
  inputBuffer: string;
  kind: ProjectTabRecord["kind"];
  lastCommand: string | null;
  lastOutputAt: number | null;
  lastPublishedStateKey: string | null;
  managedRunActive: boolean;
  oscBuffer: string;
  operation: TerminalSessionOperation;
  outputRevision: number;
  pendingStartRequest: boolean;
  pendingRestart: boolean;
  promptReady: boolean;
  promptResolve: (() => void) | null;
  promptWait: Promise<void> | null;
  cwdPersistTimer: ReturnType<typeof setTimeout> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  process: nodePty.IPty | null;
  projectId: string;
  reconcilePromise: Promise<void> | null;
  respawnShellOnExit: boolean;
  rows: number;
  shellIntegrationActive: boolean;
  shellIntegrationCommandRunning: boolean;
  startRequested: boolean;
  stateRefreshTimer: ReturnType<typeof setTimeout> | null;
  stopRequested: boolean;
  startupBypassActive: boolean;
  startupGate: TerminalStartupGate | null;
  tabId: string;
  updatedAt: string;
}

interface TerminalManagerOptions {
  historyDir: string;
  loadCommand: (projectId: string, commandId: string) => Promise<ResolvedCommandConfig | null>;
  loadProject: (projectId: string) => Promise<ProjectRecord | null>;
  loadTab: (projectId: string, tabId: string) => Promise<ProjectTabRecord | null>;
  onEvent: (event: TerminalEvent) => void;
  persistTabCwd: (projectId: string, tabId: string, cwd: string) => Promise<void> | void;
}

interface ShellLaunchOptions {
  env?: Record<string, string>;
  startupCommand?: string;
}

interface ProjectOperationState {
  desiredRunState: "idle" | "running";
  operation: Exclude<TerminalSessionOperation, "none">;
  tabIds: Set<string>;
}

interface StopRequestOptions {
  keepStoppingOnFailure: boolean;
  respawnShellOnExit: boolean;
  shouldContinue?: () => boolean;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const REPLAY_BUFFER_MAX_BYTES = 2 * 1024 * 1024;
const execFile = promisify(execFileCallback);
const ESCAPE_SEQUENCE_PREFIX = String.fromCharCode(27);
const OSC_SEQUENCE_PREFIX = `${ESCAPE_SEQUENCE_PREFIX}]`;
const STRING_TERMINATOR = `${ESCAPE_SEQUENCE_PREFIX}\\`;
const ANSI_CONTROL_SEQUENCE = new RegExp(`${ESCAPE_SEQUENCE_PREFIX}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_SS3_SEQUENCE = new RegExp(`${ESCAPE_SEQUENCE_PREFIX}O.`, "g");
const ANSI_OSC_SEQUENCE = new RegExp(
  `${ESCAPE_SEQUENCE_PREFIX}\\][^${String.fromCharCode(7)}${ESCAPE_SEQUENCE_PREFIX}]*(?:${String.fromCharCode(7)}|${ESCAPE_SEQUENCE_PREFIX}\\\\)`,
  "g",
);
const PROMPT_MARKER_START = "]697;StartPrompt";
const PROMPT_MARKER_END = "]697;EndPrompt";
const STARTUP_IDLE_TIMEOUT_MS = 8_000;
const STARTUP_IDLE_POLL_INTERVAL_MS = 150;
const UNSETTLED_SHELL_ACTIVITY_GRACE_MS = 500;
const PROMPT_TIMEOUT_MS = 8_000;
const STOP_INTERRUPT_TIMEOUT_MS = 1_500;
const STOP_BURST_INTERRUPT_TIMEOUT_MS = 1_500;
const STOP_BURST_INTERRUPT_COUNT = 3;
const STOP_BURST_INTERRUPT_DELAY_MS = 50;
const STOP_TERM_TIMEOUT_MS = 2_000;

interface ProcessRow {
  comm: string;
  pid: number;
  ppid: number;
  stat: string;
}

const SHELL_PROCESS_NAMES = new Set(["bash", "dash", "fish", "ksh", "sh", "tcsh", "zsh"]);

function normalizeInputChunk(data: string) {
  return data
    .replace(ANSI_CONTROL_SEQUENCE, "")
    .replace(ANSI_SS3_SEQUENCE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function trackInputState(session: TerminalSessionState, data: string) {
  let commandSubmitted = false;
  let interrupted = false;
  const normalized = normalizeInputChunk(data);

  for (const char of normalized) {
    if (char === "\n") {
      const nextCommand = session.inputBuffer.trim();
      if (nextCommand) {
        session.lastCommand = nextCommand;
        commandSubmitted = true;
      }
      session.inputBuffer = "";
      continue;
    }

    if (char === "\u0003" || char === "\u0015") {
      session.inputBuffer = "";
      interrupted = true;
      continue;
    }

    if (char === "\u007f" || char === "\b") {
      session.inputBuffer = session.inputBuffer.slice(0, -1);
      continue;
    }

    if (char < " " || char === "\u001b") {
      continue;
    }

    session.inputBuffer = `${session.inputBuffer}${char}`;
  }

  return { commandSubmitted, interrupted };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsiAndOsc(data: string) {
  return data
    .replace(ANSI_OSC_SEQUENCE, "")
    .replace(ANSI_CONTROL_SEQUENCE, "")
    .replace(ANSI_SS3_SEQUENCE, "");
}

function decodeShellIntegrationValue(value: string) {
  return value.replace(/\\\\|\\x([0-9a-fA-F]{2})/g, (match, hex: string | undefined) => {
    if (match === "\\\\") {
      return "\\";
    }
    if (!hex) {
      return match;
    }
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}

function chunkLooksLikePrompt(data: string) {
  const visible = stripAnsiAndOsc(data).replace(/\r/g, "\n");
  const lines = visible
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const lastLine = lines.at(-1) ?? "";
  return /[%#$>]$/.test(lastLine);
}

function trailingPrefixLength(value: string, prefix: string) {
  const maxLength = Math.min(value.length, prefix.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.slice(-length) === prefix.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function sanitizeHistoryFileComponent(value: string) {
  return value.replaceAll(/[^a-z0-9-]/gi, "_");
}

function shouldIgnoreUnsettledShellActivity(session: TerminalSessionState) {
  return (
    !session.promptReady &&
    !session.managedRunActive &&
    !session.startRequested &&
    !session.stopRequested &&
    session.lastCommand === null &&
    session.lastOutputAt !== null &&
    Date.now() - session.lastOutputAt < UNSETTLED_SHELL_ACTIVITY_GRACE_MS
  );
}

function shouldIgnoreBackgroundShellProcesses(session: TerminalSessionState) {
  return isShellBooting(session) && !session.shellIntegrationCommandRunning;
}

function isShellBooting(session: TerminalSessionState) {
  return (
    Boolean(session.process) &&
    !session.promptReady &&
    !session.startRequested &&
    session.lastCommand === null &&
    !session.managedRunActive &&
    !session.stopRequested
  );
}

export function resolveShellTabCwd(projectPath: string, shellCwd: string | null) {
  if (!shellCwd) {
    return projectPath;
  }
  if (path.isAbsolute(shellCwd)) {
    return shellCwd;
  }
  return resolveProjectCwd(projectPath, shellCwd);
}

export class TerminalManager {
  private readonly historyDir: string;
  private readonly bashIntegrationPath: string | null;
  private readonly shellHistoryDir: string;
  private readonly zshIntegrationDir: string | null;
  private readonly loadCommand: TerminalManagerOptions["loadCommand"];
  private readonly loadProject: TerminalManagerOptions["loadProject"];
  private readonly loadTab: TerminalManagerOptions["loadTab"];
  private readonly onEvent: TerminalManagerOptions["onEvent"];
  private readonly persistTabCwd: TerminalManagerOptions["persistTabCwd"];
  private readonly projectOperations = new Map<string, ProjectOperationState>();
  private readonly sessions = new Map<string, TerminalSessionState>();

  constructor(options: TerminalManagerOptions) {
    this.historyDir = options.historyDir;
    this.shellHistoryDir = path.join(this.historyDir, "..", "shell-history");
    this.loadCommand = options.loadCommand;
    this.loadProject = options.loadProject;
    this.loadTab = options.loadTab;
    this.onEvent = options.onEvent;
    this.persistTabCwd = options.persistTabCwd;
    fs.mkdirSync(this.historyDir, { recursive: true });
    fs.mkdirSync(this.shellHistoryDir, { recursive: true });
    this.zshIntegrationDir =
      process.platform === "win32" ? null : this.buildZshIntegrationDir();
    this.bashIntegrationPath =
      process.platform === "win32" ? null : this.buildBashIntegrationPath();
  }

  private sessionKey(projectId: string, tabId: string) {
    return `${projectId}:${tabId}`;
  }

  private historyFileStem(projectId: string, tabId: string) {
    return `${sanitizeHistoryFileComponent(projectId)}_${sanitizeHistoryFileComponent(tabId)}`;
  }

  private historyPath(projectId: string, tabId: string) {
    return path.join(
      this.historyDir,
      `${this.historyFileStem(projectId, tabId)}.log`,
    );
  }

  private shellHistoryPath(projectId: string, tabId: string) {
    return path.join(this.shellHistoryDir, `${this.historyFileStem(projectId, tabId)}.history`);
  }

  private async listProcessTable(): Promise<ProcessRow[]> {
    if (process.platform === "win32") {
      return [];
    }
    try {
      const { stdout } = await execFile("ps", ["-ax", "-o", "pid=,ppid=,stat=,comm="]);
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [pid, ppid, stat, ...commParts] = line.split(/\s+/);
          return {
            comm: commParts.join(" "),
            pid: Number(pid),
            ppid: Number(ppid),
            stat: stat ?? "",
          };
        })
        .filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.ppid));
    } catch {
      return [];
    }
  }

  private listDescendantProcesses(rootPid: number | null, processTable: ProcessRow[]) {
    return collectDescendantProcessRows(rootPid, processTable);
  }

  private countDescendantProcesses(rootPid: number | null, processTable: ProcessRow[]) {
    return this.listDescendantProcesses(rootPid, processTable).reduce((count, row) => {
      const commandName = row.comm.split("/").pop()?.replace(/\s*\(.*\)$/, "") ?? "";
      return SHELL_PROCESS_NAMES.has(commandName) ? count : count + 1;
    }, 0);
  }

  private async signalDescendantProcesses(rootPid: number | null, signal: NodeJS.Signals) {
    if (!rootPid || process.platform === "win32") {
      return;
    }
    const processTable = await this.listProcessTable();
    for (const row of this.listDescendantProcesses(rootPid, processTable)) {
      try {
        process.kill(row.pid, signal);
      } catch {
        continue;
      }
    }
  }

  private async sendInterruptBurst(session: TerminalSessionState) {
    for (let index = 0; index < STOP_BURST_INTERRUPT_COUNT; index += 1) {
      if (!session.process) {
        return;
      }
      session.process.write("\u0003");
      if (index < STOP_BURST_INTERRUPT_COUNT - 1) {
        await sleep(STOP_BURST_INTERRUPT_DELAY_MS);
      }
    }
  }

  private async publishUpdatedSnapshot(
    session: TerminalSessionState,
    snapshot: TerminalSessionSnapshot,
  ) {
    const nextStateKey = this.snapshotStateKey(snapshot);
    if (nextStateKey === session.lastPublishedStateKey) {
      return snapshot;
    }
    session.lastPublishedStateKey = nextStateKey;
    this.onEvent({
      createdAt: new Date().toISOString(),
      projectId: session.projectId,
      snapshot,
      tabId: session.tabId,
      type: "updated",
    });
    return snapshot;
  }

  private async requestStop(
    session: TerminalSessionState,
    options: StopRequestOptions,
  ) {
    const currentSnapshot = await this.startStopRequest(session, options);
    if (!currentSnapshot?.hasActiveProcess) {
      return currentSnapshot;
    }
    return this.finishStopRequest(session, options);
  }

  private async startStopRequest(
    session: TerminalSessionState,
    options: StopRequestOptions,
  ) {
    if (!session.process) {
      return null;
    }

    const currentSnapshot = await this.snapshot(session);
    const hasPendingStartWork = session.managedRunActive || session.startRequested;
    if (!currentSnapshot.hasActiveProcess && !hasPendingStartWork) {
      session.managedRunActive = false;
      session.startRequested = false;
      session.stopRequested = false;
      session.respawnShellOnExit = options.respawnShellOnExit;
      return currentSnapshot;
    }

    session.managedRunActive = false;
    session.startRequested = false;
    session.stopRequested = true;
    session.respawnShellOnExit = options.respawnShellOnExit;
    session.updatedAt = new Date().toISOString();
    await this.emitSnapshotEvent(session);
    session.process.write("\u0003");
    return currentSnapshot;
  }

  private async finishStopRequest(
    session: TerminalSessionState,
    options: StopRequestOptions,
  ) {
    const shouldContinue = () => options.shouldContinue?.() ?? true;

    if (!session.process) {
      return this.snapshot(session);
    }
    let snapshot = await this.waitForShellIdle(session, STOP_INTERRUPT_TIMEOUT_MS);
    if (!shouldContinue()) {
      return snapshot;
    }
    if (!snapshot.hasActiveProcess) {
      session.stopRequested = false;
      return this.publishUpdatedSnapshot(session, snapshot);
    }

    await this.sendInterruptBurst(session);
    if (!session.process) {
      return this.snapshot(session);
    }
    snapshot = await this.waitForShellIdle(session, STOP_BURST_INTERRUPT_TIMEOUT_MS);
    if (!shouldContinue()) {
      return snapshot;
    }
    if (!snapshot.hasActiveProcess) {
      session.stopRequested = false;
      return this.publishUpdatedSnapshot(session, snapshot);
    }

    if (!session.process) {
      return this.snapshot(session);
    }
    await this.signalDescendantProcesses(session.process.pid, "SIGTERM");
    snapshot = await this.waitForShellIdle(session, STOP_TERM_TIMEOUT_MS);
    if (!shouldContinue()) {
      return snapshot;
    }
    if (!snapshot.hasActiveProcess) {
      session.stopRequested = false;
      return this.publishUpdatedSnapshot(session, snapshot);
    }

    if (options.keepStoppingOnFailure) {
      return snapshot;
    }

    session.stopRequested = false;
    return this.publishUpdatedSnapshot(session, await this.snapshot(session));
  }

  private async snapshot(
    session: TerminalSessionState,
    processTable?: ProcessRow[],
  ): Promise<TerminalSessionSnapshot> {
    const shouldIgnoreDescendantProcesses =
      session.startupBypassActive ||
      shouldIgnoreUnsettledShellActivity(session) ||
      shouldIgnoreBackgroundShellProcesses(session);
    const activeProcessCount = session.shellIntegrationActive
      ? (session.shellIntegrationCommandRunning ? 1 : 0)
      : shouldIgnoreDescendantProcesses
        ? 0
        : this.countDescendantProcesses(
            session.process?.pid ?? null,
            processTable ?? (await this.listProcessTable()),
          );
    const hasActiveProcess = activeProcessCount > 0;
    const status = !session.process
      ? "stopped"
      : isShellBooting(session)
        ? "booting"
        : hasActiveProcess
          ? "running"
          : "idle";
    return {
      activeProcessCount,
      cols: session.cols,
      cwd: session.cwd,
      exitCode: null,
      hasActiveProcess,
      history: session.history,
      kind: session.kind,
      lastCommand: session.lastCommand,
      managedRunActive: session.managedRunActive,
      operation: session.closing ? "stopping" : session.operation,
      outputRevision: session.outputRevision,
      pid: session.process?.pid ?? null,
      projectId: session.projectId,
      rows: session.rows,
      status,
      tabId: session.tabId,
      updatedAt: session.updatedAt,
    };
  }

  private snapshotStateKey(snapshot: TerminalSessionSnapshot) {
    return JSON.stringify({
      activeProcessCount: snapshot.activeProcessCount,
      cwd: snapshot.cwd,
      hasActiveProcess: snapshot.hasActiveProcess,
      lastCommand: snapshot.lastCommand,
      managedRunActive: snapshot.managedRunActive,
      operation: snapshot.operation,
      pid: snapshot.pid,
      status: snapshot.status,
    });
  }

  private async emitSnapshotEvent(
    session: TerminalSessionState,
    type: Extract<TerminalEvent["type"], "started" | "updated" | "cleared"> = "updated",
    processTable?: ProcessRow[],
  ) {
    const snapshot = await this.snapshot(session, processTable);
    const nextStateKey = this.snapshotStateKey(snapshot);
    if (type === "updated" && nextStateKey === session.lastPublishedStateKey) {
      return snapshot;
    }
    session.lastPublishedStateKey = nextStateKey;
    this.onEvent({
      createdAt: new Date().toISOString(),
      projectId: session.projectId,
      snapshot,
      tabId: session.tabId,
      type,
    });
    return snapshot;
  }

  private async waitForShellIdle(
    session: TerminalSessionState,
    timeoutMs = STARTUP_IDLE_TIMEOUT_MS,
  ): Promise<TerminalSessionSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let snapshot = await this.snapshot(session);

    while (snapshot.hasActiveProcess && session.process && Date.now() < deadline) {
      await sleep(STARTUP_IDLE_POLL_INTERVAL_MS);
      if (!session.process) {
        break;
      }
      snapshot = await this.snapshot(session);
    }

    return snapshot;
  }

  private isManagedCommandRunning(
    session: TerminalSessionState,
    snapshot: TerminalSessionSnapshot,
  ) {
    return (
      snapshot.hasActiveProcess &&
      session.lastCommand !== null &&
      !session.startRequested &&
      !session.stopRequested
    );
  }

  private async startDesiredCommand(
    session: TerminalSessionState,
    command: ResolvedCommandConfig,
    cwd: string,
  ) {
    session.lastCommand = null;
    session.managedRunActive = false;
    session.startRequested = true;
    session.stopRequested = false;
    session.startupBypassActive = false;
    session.respawnShellOnExit = false;
    session.cwd = cwd;
    session.updatedAt = new Date().toISOString();

    session.process?.kill();
    session.process = null;
    this.spawnShell(session, {
      env: command.env,
    });
    await this.emitSnapshotEvent(session, "started");
    await this.waitForPrompt(session);

    if (!session.process || session.desiredRunState !== "running") {
      session.startRequested = false;
      session.updatedAt = new Date().toISOString();
      return;
    }

    session.operation = session.pendingRestart ? "restarting" : "starting";
    await this.startManagedRun(session, command.command);
    await this.emitSnapshotEvent(session);
  }

  private ensureSessionReconcile(session: TerminalSessionState) {
    if (session.reconcilePromise) {
      return session.reconcilePromise;
    }

    const reconcilePromise = this.reconcileSession(session)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        session.operation = "none";
        session.pendingRestart = false;
        session.updatedAt = new Date().toISOString();
        this.onEvent({
          createdAt: new Date().toISOString(),
          message,
          projectId: session.projectId,
          tabId: session.tabId,
          type: "error",
        });
        return undefined;
      })
      .finally(() => {
        if (session.reconcilePromise === reconcilePromise) {
          session.reconcilePromise = null;
        }
      });

    session.reconcilePromise = reconcilePromise;
    return reconcilePromise;
  }

  private async reconcileSession(session: TerminalSessionState) {
    while (!session.closing) {
      const runtime = await this.resolveTabRuntime(session.projectId, session.tabId);
      const command = runtime.command;
      const snapshot = await this.snapshot(session);

      if (session.kind !== "command" || !command) {
        const needsStopWithoutCommand =
          session.desiredRunState === "idle" &&
          Boolean(session.process) &&
          (snapshot.hasActiveProcess ||
            session.managedRunActive ||
            session.startRequested ||
            session.stopRequested);

        if (needsStopWithoutCommand) {
          session.operation = "stopping";
          session.updatedAt = new Date().toISOString();
          await this.emitSnapshotEvent(session);
          await this.requestStop(session, {
            keepStoppingOnFailure: false,
            respawnShellOnExit: session.kind === "command",
          });
          continue;
        }

        session.desiredRunState = "idle";
        session.operation = "none";
        session.pendingRestart = false;
        await this.emitSnapshotEvent(session);
        return;
      }

      if (session.desiredRunState === "idle") {
        const needsStop =
          Boolean(session.process) &&
          (snapshot.hasActiveProcess ||
            session.managedRunActive ||
            session.startRequested ||
            session.stopRequested);

        if (!needsStop) {
          session.operation = "none";
          session.pendingRestart = false;
          session.startRequested = false;
          session.stopRequested = false;
          session.updatedAt = new Date().toISOString();
          await this.emitSnapshotEvent(session);
          return;
        }

        session.operation = "stopping";
        session.updatedAt = new Date().toISOString();
        await this.emitSnapshotEvent(session);
        await this.requestStop(session, {
          keepStoppingOnFailure: false,
          respawnShellOnExit: session.kind === "command",
        });
        continue;
      }

      if (session.pendingRestart && Boolean(session.process)) {
        const needsRestartStop =
          snapshot.status === "booting" ||
          snapshot.hasActiveProcess ||
          session.managedRunActive ||
          session.startRequested ||
          session.stopRequested;

        if (needsRestartStop) {
          session.operation = "restarting";
          session.updatedAt = new Date().toISOString();
          await this.emitSnapshotEvent(session);
          await this.requestStop(session, {
            keepStoppingOnFailure: false,
            respawnShellOnExit: false,
          });
          continue;
        }
      }

      if (this.isManagedCommandRunning(session, snapshot) && !session.pendingRestart) {
        session.operation = "none";
        session.updatedAt = new Date().toISOString();
        await this.emitSnapshotEvent(session);
        return;
      }

      if (!session.pendingStartRequest && !session.pendingRestart) {
        session.operation = "none";
        session.updatedAt = new Date().toISOString();
        await this.emitSnapshotEvent(session);
        return;
      }

      if (session.startRequested || session.managedRunActive) {
        await sleep(STARTUP_IDLE_POLL_INTERVAL_MS);
        continue;
      }

      session.operation = session.pendingRestart ? "restarting" : "starting";
      session.updatedAt = new Date().toISOString();
      await this.emitSnapshotEvent(session);
      await this.startDesiredCommand(session, command, runtime.cwd);
      session.pendingStartRequest = false;
      session.pendingRestart = false;
      continue;
    }
  }

  private async requestCommandState(
    input: TerminalRunInput | TerminalStopInput | TerminalRestartInput,
    nextState: "idle" | "running",
    options?: {
      restart?: boolean;
    },
  ) {
    const key = this.sessionKey(input.projectId, input.tabId);
    let session = this.sessions.get(key);
    if (!session && nextState === "running") {
      const runtime = await this.resolveTabRuntime(input.projectId, input.tabId);
      if (!runtime.command) {
        return null;
      }
      await this.open({
        cols: DEFAULT_COLS,
        projectId: input.projectId,
        rows: DEFAULT_ROWS,
        tabId: input.tabId,
      });
      session = this.sessions.get(key);
    }

    if (nextState === "running") {
      const runtime = await this.resolveTabRuntime(input.projectId, input.tabId);
      if (!runtime.command) {
        return null;
      }
    }

    if (!session) {
      return null;
    }

    session.desiredRunState = nextState;
    session.pendingStartRequest = nextState === "running";
    session.pendingRestart = Boolean(options?.restart) && nextState === "running";
    session.operation =
      nextState === "idle"
        ? "stopping"
        : session.pendingRestart
          ? "restarting"
          : "starting";
    session.updatedAt = new Date().toISOString();
    const snapshot = await this.emitSnapshotEvent(session);
    if (nextState === "idle") {
      await this.ensureSessionReconcile(session);
    } else {
      void this.ensureSessionReconcile(session);
    }
    return snapshot;
  }

  private queuePersist(session: TerminalSessionState) {
    if (session.persistTimer) {
      clearTimeout(session.persistTimer);
    }
    session.persistTimer = setTimeout(() => {
      session.persistTimer = null;
      void this.persistHistoryAsync(session);
    }, 80);
  }

  private queuePersistCwd(session: TerminalSessionState) {
    if (session.kind !== "shell") {
      return;
    }
    if (session.cwdPersistTimer) {
      clearTimeout(session.cwdPersistTimer);
    }
    session.cwdPersistTimer = setTimeout(() => {
      session.cwdPersistTimer = null;
      void this.persistTabCwd(session.projectId, session.tabId, session.cwd);
    }, 80);
  }

  private async persistHistoryAsync(session: TerminalSessionState) {
    const historyPath = this.historyPath(session.projectId, session.tabId);
    const payload = session.history;
    try {
      await fsPromises.writeFile(historyPath, payload, "utf8");
    } catch {
      // ignore transient persist failures; next debounce will retry
    }
  }

  private persistHistorySync(session: TerminalSessionState) {
    const historyPath = this.historyPath(session.projectId, session.tabId);
    try {
      fs.writeFileSync(historyPath, session.history, "utf8");
    } catch {
      // ignore
    }
  }

  private appendReplayBytes(session: TerminalSessionState, data: string) {
    const next = `${session.history}${data}`;
    session.history =
      next.length > REPLAY_BUFFER_MAX_BYTES
        ? next.slice(next.length - REPLAY_BUFFER_MAX_BYTES)
        : next;
    session.outputRevision += 1;
  }

  applySerializedSnapshot(input: TerminalSerializeInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session) {
      return;
    }
    if (input.outputRevision !== session.outputRevision) {
      return;
    }
    if (
      session.history.trim().length > 0 &&
      input.snapshot.length < session.history.length &&
      (!session.lastCommand || !input.snapshot.includes(session.lastCommand))
    ) {
      return;
    }
    const snapshot =
      input.snapshot.length > REPLAY_BUFFER_MAX_BYTES
        ? input.snapshot.slice(input.snapshot.length - REPLAY_BUFFER_MAX_BYTES)
        : input.snapshot;
    session.history = snapshot;
    session.updatedAt = new Date().toISOString();
    this.queuePersist(session);
  }

  flushAll() {
    for (const session of this.sessions.values()) {
      if (session.persistTimer) {
        clearTimeout(session.persistTimer);
        session.persistTimer = null;
      }
      if (session.cwdPersistTimer) {
        clearTimeout(session.cwdPersistTimer);
        session.cwdPersistTimer = null;
        if (session.kind === "shell") {
          void this.persistTabCwd(session.projectId, session.tabId, session.cwd);
        }
      }
      this.persistHistorySync(session);
    }
  }

  private scheduleStateRefresh(session: TerminalSessionState, delayMs = 75) {
    if (session.stateRefreshTimer) {
      clearTimeout(session.stateRefreshTimer);
    }
    session.stateRefreshTimer = setTimeout(() => {
      session.stateRefreshTimer = null;
      if (!session.process) {
        return;
      }
      void this.emitSnapshotEvent(session);
    }, delayMs);
  }

  private handleOscSequence(session: TerminalSessionState, payload: string) {
    if (payload.startsWith("633;E;")) {
      session.shellIntegrationActive = true;
      const commandLine = payload.slice("633;E;".length).split(";")[0] ?? "";
      const decodedCommandLine = decodeShellIntegrationValue(commandLine).trim();
      if (decodedCommandLine) {
        session.lastCommand = decodedCommandLine;
      }
      return;
    }

    if (payload.startsWith("133;C") || payload.startsWith("633;C")) {
      session.startRequested = false;
      session.shellIntegrationActive = true;
      session.shellIntegrationCommandRunning = true;
      session.updatedAt = new Date().toISOString();
      this.scheduleStateRefresh(session, 0);
      return;
    }

    if (payload.startsWith("133;D") || payload.startsWith("633;D")) {
      session.startRequested = false;
      session.shellIntegrationActive = true;
      session.shellIntegrationCommandRunning = false;
      session.updatedAt = new Date().toISOString();
      this.scheduleStateRefresh(session, 0);
      return;
    }

    if (payload.startsWith("133;B") || payload.startsWith("633;B")) {
      session.shellIntegrationActive = true;
      this.markPromptReady(session);
      return;
    }

    if (payload.startsWith("1337;CurrentDir=")) {
      session.shellIntegrationActive = true;
      session.cwd = payload.slice("1337;CurrentDir=".length);
      session.updatedAt = new Date().toISOString();
      this.queuePersistCwd(session);
      this.scheduleStateRefresh(session, 0);
      return;
    }

    if (payload.startsWith("633;P;Cwd=")) {
      session.shellIntegrationActive = true;
      session.cwd = decodeShellIntegrationValue(payload.slice("633;P;Cwd=".length));
      session.updatedAt = new Date().toISOString();
      this.queuePersistCwd(session);
      this.scheduleStateRefresh(session, 0);
    }
  }

  private parseOscSequences(session: TerminalSessionState, data: string) {
    let buffer = `${session.oscBuffer}${data}`;
    let cursor = 0;

    while (true) {
      const start = buffer.indexOf(OSC_SEQUENCE_PREFIX, cursor);
      if (start === -1) {
        const tail = buffer.slice(cursor);
        const partialPrefixLength = trailingPrefixLength(tail, OSC_SEQUENCE_PREFIX);
        session.oscBuffer = partialPrefixLength > 0 ? tail.slice(-partialPrefixLength) : "";
        return;
      }

      const bel = buffer.indexOf("\u0007", start + OSC_SEQUENCE_PREFIX.length);
      const st = buffer.indexOf(STRING_TERMINATOR, start + OSC_SEQUENCE_PREFIX.length);
      let end = -1;
      let terminatorLength = 0;

      if (bel !== -1 && (st === -1 || bel < st)) {
        end = bel;
        terminatorLength = 1;
      } else if (st !== -1) {
        end = st;
        terminatorLength = STRING_TERMINATOR.length;
      }

      if (end === -1) {
        session.oscBuffer = buffer.slice(start);
        return;
      }

      const payload = buffer.slice(start + OSC_SEQUENCE_PREFIX.length, end);
      this.handleOscSequence(session, payload);
      cursor = end + terminatorLength;
    }
  }

  private async readProcessCwd(pid: number | null) {
    if (!pid) {
      return null;
    }

    if (process.platform === "linux") {
      try {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        return null;
      }
    }

    try {
      const { stdout } = await execFile("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
      const line = stdout
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value.startsWith("n"));
      return line ? line.slice(1) : null;
    } catch {
      return null;
    }
  }

  private async syncShellTabCwd(session: TerminalSessionState) {
    if (session.kind !== "shell") {
      return false;
    }

    const cwd = await this.readProcessCwd(session.process?.pid ?? null);
    if (!cwd || cwd === session.cwd) {
      return false;
    }

    session.cwd = cwd;
    session.updatedAt = new Date().toISOString();
    if (session.cwdPersistTimer) {
      clearTimeout(session.cwdPersistTimer);
      session.cwdPersistTimer = null;
    }
    await this.persistTabCwd(session.projectId, session.tabId, cwd);
    return true;
  }

  private armPromptWait(session: TerminalSessionState) {
    session.promptReady = false;
    session.promptWait = new Promise<void>((resolve) => {
      session.promptResolve = resolve;
    });
  }

  private markPromptReady(session: TerminalSessionState) {
    if (session.promptReady) {
      return;
    }
    session.promptReady = true;
    const resolve = session.promptResolve;
    session.promptResolve = null;
    resolve?.();
  }

  private handlePromptSignal(session: TerminalSessionState) {
    session.managedRunActive = false;
    session.startRequested = false;
    session.stopRequested = false;
    session.startupBypassActive = false;
    this.markPromptReady(session);
    void this.syncShellTabCwd(session).then(() => {
      void this.emitSnapshotEvent(session);
    });
  }

  private detectPrompt(session: TerminalSessionState, data: string) {
    if (
      data.includes(PROMPT_MARKER_START) ||
      data.includes(PROMPT_MARKER_END) ||
      chunkLooksLikePrompt(data)
    ) {
      this.handlePromptSignal(session);
    }
  }

  private async waitForPrompt(session: TerminalSessionState, timeoutMs = PROMPT_TIMEOUT_MS) {
    if (session.promptReady) {
      return true;
    }
    if (!session.promptWait) {
      this.armPromptWait(session);
    }
    const promptWait = session.promptWait;
    const ready = await Promise.race([
      promptWait!.then(() => true),
      sleep(timeoutMs).then(() => false),
    ]);
    if (!ready && session.promptWait === promptWait) {
      this.markPromptReady(session);
    }
    return ready;
  }

  private async startManagedRun(session: TerminalSessionState, command: string) {
    await this.waitForPrompt(session);
    if (!session.process) {
      return;
    }
    session.inputBuffer = "";
    session.lastCommand = command;
    session.managedRunActive = true;
    session.stopRequested = false;
    session.startupBypassActive = false;
    session.updatedAt = new Date().toISOString();
    session.process.write(`${command}\r`);
  }

  private buildZshIntegrationDir() {
    const root = path.join(this.historyDir, "..", "shell-integration", "zsh");
    fs.mkdirSync(root, { recursive: true });

    const bootstrapPath = path.join(root, "kickstart.zsh");
    const bootstrap = `
if [[ -n "\${KICKSTART_SHELL_INTEGRATION_LOADED:-}" ]]; then
  return
fi
export KICKSTART_SHELL_INTEGRATION_LOADED=1

if [[ -n "\${KICKSTART_HISTFILE:-}" ]]; then
  HISTFILE="$KICKSTART_HISTFILE"
fi
HISTSIZE=50000
SAVEHIST=50000
setopt APPEND_HISTORY
setopt INC_APPEND_HISTORY
setopt EXTENDED_HISTORY
setopt HIST_IGNORE_DUPS

autoload -Uz add-zsh-hook

_kickstart_emit() {
  printf '\\e]%s\\a' "$1"
}

_kickstart_precmd() {
  _kickstart_emit "133;D;$?"
  _kickstart_emit "633;P;Cwd=$(_kickstart_escape_value "$PWD")"
  _kickstart_emit '133;A'
  _kickstart_emit '133;B'
}

_kickstart_preexec() {
  _kickstart_emit "633;E;$(_kickstart_escape_value "$1")"
  _kickstart_emit '133;C'
}

_kickstart_escape_value() {
  emulate -L zsh
  local LC_ALL=C str="$1" i byte value token out=''
  for (( i = 0; i < \${#str}; ++i )); do
    byte="\${str:$i:1}"
    value=$(printf "%d" "'$byte")
    if (( value < 32 )); then
      token=$(printf "\\\\x%02x" "'$byte")
    elif (( value == 92 )); then
      token="\\\\\\\\"
    elif (( value == 59 )); then
      token="\\\\x3b"
    else
      token="$byte"
    fi
    out+="$token"
  done
  print -r -- "$out"
}

add-zsh-hook precmd _kickstart_precmd
add-zsh-hook preexec _kickstart_preexec
`.trimStart();
    fs.writeFileSync(bootstrapPath, bootstrap, "utf8");

    const sourceOrTrue = (fileName: string) =>
      `if [[ -n "$KICKSTART_USER_ZDOTDIR" && -f "$KICKSTART_USER_ZDOTDIR/${fileName}" ]]; then source "$KICKSTART_USER_ZDOTDIR/${fileName}"; elif [[ -f "$HOME/${fileName}" ]]; then source "$HOME/${fileName}"; fi`;

    fs.writeFileSync(
      path.join(root, ".zshenv"),
      `${sourceOrTrue(".zshenv")}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".zprofile"),
      `${sourceOrTrue(".zprofile")}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".zshrc"),
      `${sourceOrTrue(".zshrc")}\nsource "${bootstrapPath}"\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".zlogin"),
      `${sourceOrTrue(".zlogin")}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".zlogout"),
      `${sourceOrTrue(".zlogout")}\n`,
      "utf8",
    );

    return root;
  }

  private buildBashIntegrationPath() {
    const root = path.join(this.historyDir, "..", "shell-integration", "bash");
    fs.mkdirSync(root, { recursive: true });
    const bootstrapPath = path.join(root, "kickstart.bash");
    const bootstrap = `
if [[ -z "\${KICKSTART_BASH_INTEGRATION_BOOTSTRAPPED:-}" ]]; then
  export KICKSTART_BASH_INTEGRATION_BOOTSTRAPPED=1
  _kickstart_loaded_profile=0
  if [[ -f "$HOME/.bash_profile" ]]; then source "$HOME/.bash_profile"; _kickstart_loaded_profile=1;
  elif [[ -f "$HOME/.bash_login" ]]; then source "$HOME/.bash_login"; _kickstart_loaded_profile=1;
  elif [[ -f "$HOME/.profile" ]]; then source "$HOME/.profile"; _kickstart_loaded_profile=1;
  fi
  if [[ "$_kickstart_loaded_profile" == "0" && -f "$HOME/.bashrc" ]]; then source "$HOME/.bashrc"; fi
  unset _kickstart_loaded_profile
fi

if [[ -n "\${KICKSTART_HISTFILE:-}" ]]; then
  HISTFILE="$KICKSTART_HISTFILE"
fi
HISTSIZE=50000
HISTFILESIZE=50000
shopt -s histappend

_kickstart_emit() {
  printf '\\e]%s\\a' "$1"
}

_kickstart_escape_value() {
  local LC_ALL=C str="$1" i byte value token out=''
  for (( i = 0; i < \${#str}; ++i )); do
    byte="\${str:$i:1}"
    value=$(printf "%d" "'$byte")
    if (( value < 32 )); then
      printf -v token '\\\\x%02x' "$value"
    elif (( value == 92 )); then
      token="\\\\\\\\"
    elif (( value == 59 )); then
      token="\\\\x3b"
    else
      token="$byte"
    fi
    out+="$token"
  done
  printf '%s' "$out"
}

_kickstart_prompt_command() {
  local exit_code=$?
  _kickstart_in_prompt=1
  history -a
  history -n
  _kickstart_emit "133;D;$exit_code"
  _kickstart_emit "633;P;Cwd=$(_kickstart_escape_value "$PWD")"
  _kickstart_emit "133;A"
  _kickstart_emit "133;B"
  _kickstart_in_prompt=0
  return $exit_code
}

_kickstart_run_user_prompt_command() {
  local exit_code=$?
  _kickstart_in_prompt=1
  eval "$_kickstart_user_prompt_command"
  _kickstart_in_prompt=0
  return $exit_code
}

_kickstart_preexec() {
  if [[ "\${_kickstart_in_prompt:-0}" == "1" || "$1" == "_kickstart_prompt_command" || "$1" == "_kickstart_run_user_prompt_command" ]]; then
    return
  fi
  _kickstart_emit "633;E;$(_kickstart_escape_value "$1")"
  _kickstart_emit "133;C"
}

if [[ -n "\${PROMPT_COMMAND:-}" ]]; then
  _kickstart_user_prompt_command="$PROMPT_COMMAND"
  PROMPT_COMMAND="_kickstart_prompt_command; _kickstart_run_user_prompt_command"
else
  unset _kickstart_user_prompt_command
  PROMPT_COMMAND="_kickstart_prompt_command"
fi
trap '_kickstart_preexec "$BASH_COMMAND"' DEBUG
`.trimStart();
    fs.writeFileSync(bootstrapPath, bootstrap, "utf8");
    return bootstrapPath;
  }

  private prepareShellLaunch(
    session: Pick<TerminalSessionState, "projectId" | "tabId">,
    shell: ReturnType<typeof resolveDefaultShell>,
    launchOptions?: ShellLaunchOptions,
  ) {
    const shellName = path.basename(shell.command);
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...launchOptions?.env,
      KICKSTART_USER_ZDOTDIR: process.env.ZDOTDIR || os.homedir(),
      SHELL: process.platform === "win32" ? process.env.SHELL : shell.command,
      TERM: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      TERM_PROGRAM: "kickstart",
    };

    this.applyShellIntegrationEnv(env, shell.command, session);

    return {
      args:
        shellName === "bash" && this.bashIntegrationPath
          ? ["--rcfile", this.bashIntegrationPath, "-i"]
          : shell.args,
      env,
    };
  }

  private applyShellIntegrationEnv(
    env: Record<string, string | undefined>,
    shellCommand: string,
    session: Pick<TerminalSessionState, "projectId" | "tabId">,
  ) {
    const shellName = path.basename(shellCommand);

    if (this.zshIntegrationDir && shellName === "zsh") {
      env.ZDOTDIR = this.zshIntegrationDir;
    }

    switch (shellName) {
      case "bash":
      case "zsh": {
        const histfile = this.shellHistoryPath(session.projectId, session.tabId);
        fs.closeSync(fs.openSync(histfile, "a"));
        env.HISTFILE = histfile;
        env.KICKSTART_HISTFILE = histfile;
        return;
      }
      default:
        return;
    }
  }

  private async resolveTabRuntime(projectId: string, tabId: string) {
    const tab = await this.loadTab(projectId, tabId);
    if (!tab) {
      throw new Error("Tab not found.");
    }
    if (projectId === GENERAL_SPACE_ID) {
      return {
        command: null,
        cwd: tab.shellCwd || os.homedir(),
        project: null,
        tab,
      };
    }
    const project = await this.loadProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    let cwd = resolveShellTabCwd(project.path, tab.shellCwd);
    let command: ResolvedCommandConfig | null = null;
    if (tab.commandId) {
      command = await this.loadCommand(projectId, tab.commandId);
      if (command) {
        cwd = resolveProjectCwd(project.path, command.cwd);
      }
    }
    return {
      command,
      cwd,
      project,
      tab,
    };
  }

  private spawnShell(session: TerminalSessionState, launchOptions?: ShellLaunchOptions) {
    session.startupGate?.dispose();
    session.startupGate = createTerminalStartupGate();
    const startupGate = session.startupGate;
    session.oscBuffer = "";
    session.shellIntegrationActive = false;
    session.shellIntegrationCommandRunning = false;
    session.lastOutputAt = null;
    session.startupBypassActive = true;
    this.armPromptWait(session);
    void startupGate.waitUntilReady().then(() => {
      if (session.startupGate !== startupGate || !session.process) {
        return;
      }
      if (!session.startupBypassActive) {
        return;
      }
      session.startupBypassActive = false;
      session.updatedAt = new Date().toISOString();
      void this.emitSnapshotEvent(session);
    });

    const shell = resolveDefaultShell(process.platform, process.env);
    const { args, env } = this.prepareShellLaunch(session, shell, launchOptions);
    const pty = nodePty.spawn(shell.command, args, {
      cols: session.cols,
      cwd: session.cwd,
      env,
      name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      rows: session.rows,
    });
    session.process = pty;
    session.updatedAt = new Date().toISOString();
    void this.waitForPrompt(session).then((ready) => {
      if (ready || session.process !== pty) {
        return;
      }
      session.updatedAt = new Date().toISOString();
      void this.emitSnapshotEvent(session);
    });

    pty.onData((data) => {
      if (session.process !== pty) {
        return;
      }
      session.startupGate?.signalActivity();
      session.lastOutputAt = Date.now();
      session.updatedAt = new Date().toISOString();
      this.appendReplayBytes(session, data);
      this.parseOscSequences(session, data);
      this.detectPrompt(session, data);
      this.queuePersist(session);
      this.onEvent({
        createdAt: new Date().toISOString(),
        data,
        outputRevision: session.outputRevision,
        projectId: session.projectId,
        tabId: session.tabId,
        type: "output",
      });
    });

    pty.onExit(({ exitCode }) => {
      if (session.process !== pty) {
        return;
      }
      const shouldRespawnShell = session.respawnShellOnExit && !session.closing;
      session.startupGate?.dispose();
      session.startupGate = null;
      session.oscBuffer = "";
      session.process = null;
      session.managedRunActive = false;
      session.lastOutputAt = null;
      session.lastPublishedStateKey = null;
      session.promptReady = false;
      session.promptResolve = null;
      session.promptWait = null;
      session.respawnShellOnExit = false;
      session.shellIntegrationActive = false;
      session.shellIntegrationCommandRunning = false;
      session.startRequested = false;
      if (session.stateRefreshTimer) {
        clearTimeout(session.stateRefreshTimer);
        session.stateRefreshTimer = null;
      }
      if (session.cwdPersistTimer) {
        clearTimeout(session.cwdPersistTimer);
        session.cwdPersistTimer = null;
        if (session.kind === "shell") {
          void this.persistTabCwd(session.projectId, session.tabId, session.cwd);
        }
      }
      session.stopRequested = false;
      session.updatedAt = new Date().toISOString();
      this.queuePersist(session);
      if (!session.closing) {
        this.onEvent({
          createdAt: new Date().toISOString(),
          exitCode,
          projectId: session.projectId,
          tabId: session.tabId,
          type: "stopped",
        });
      }
      if (shouldRespawnShell) {
        this.spawnShell(session);
        void this.emitSnapshotEvent(session, "started");
      }
    });
  }

  async open(
    input: TerminalOpenInput,
    launchOptions?: ShellLaunchOptions,
  ): Promise<TerminalSessionSnapshot | null> {
    let runtime;
    try {
      runtime = await this.resolveTabRuntime(input.projectId, input.tabId);
    } catch (error) {
      if (error instanceof Error && error.message === "Tab not found.") {
        return null;
      }
      throw error;
    }
    const key = this.sessionKey(input.projectId, input.tabId);
    let session = this.sessions.get(key);
    if (!session) {
      const historyPath = this.historyPath(input.projectId, input.tabId);
      let history = "";
      try {
        history = await fsPromises.readFile(historyPath, "utf8");
      } catch {
        history = "";
      }
      session = {
        cols: input.cols || DEFAULT_COLS,
        closing: false,
        cwd: runtime.cwd,
        desiredRunState: "idle",
        history,
        inputBuffer: "",
        kind: runtime.tab.kind,
        lastCommand: null,
        lastOutputAt: null,
        lastPublishedStateKey: null,
        managedRunActive: false,
        oscBuffer: "",
        operation: "none",
        outputRevision: 0,
        pendingStartRequest: false,
        pendingRestart: false,
        promptReady: false,
        promptResolve: null,
        promptWait: null,
        cwdPersistTimer: null,
        persistTimer: null,
        process: null,
        projectId: input.projectId,
        reconcilePromise: null,
        respawnShellOnExit: false,
        rows: input.rows || DEFAULT_ROWS,
        shellIntegrationActive: false,
        shellIntegrationCommandRunning: false,
        startRequested: false,
        stateRefreshTimer: null,
        stopRequested: false,
        startupBypassActive: false,
        startupGate: null,
        tabId: input.tabId,
        updatedAt: new Date().toISOString(),
      };
      this.sessions.set(key, session);
    } else {
      session.closing = false;
      session.cols = input.cols || session.cols;
      if (!session.process) {
        session.cwd = runtime.cwd;
      }
      session.kind = runtime.tab.kind;
      session.rows = input.rows || session.rows;
      session.updatedAt = new Date().toISOString();
    }

    if (launchOptions?.startupCommand) {
      session.lastCommand = null;
      session.managedRunActive = false;
      session.startRequested = true;
      session.stopRequested = false;
      session.startupBypassActive = false;
      session.process?.kill();
      session.process = null;
      this.spawnShell(session, {
        env: launchOptions.env,
      });
      await this.emitSnapshotEvent(session, "started");
      await this.startManagedRun(session, launchOptions.startupCommand);
      await this.emitSnapshotEvent(session);
    } else if (!session.process) {
      this.spawnShell(session);
      await this.emitSnapshotEvent(session, "started");
    } else if (session.cols !== input.cols || session.rows !== input.rows) {
      session.process.resize(session.cols, session.rows);
    }

    return this.snapshot(session);
  }

  async write(input: TerminalWriteInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session) {
      return;
    }
    if (!session.process) {
      if (session.kind !== "shell") {
        return;
      }
      session.startRequested = false;
      session.stopRequested = false;
      session.respawnShellOnExit = false;
      this.spawnShell(session);
      await this.emitSnapshotEvent(session, "started");
      await this.waitForPrompt(session);
      if (!session.process) {
        return;
      }
    }
    session.startupBypassActive = false;
    const inputState = trackInputState(session, input.data);
    session.updatedAt = new Date().toISOString();
    session.process.write(input.data);
    if (inputState.commandSubmitted || inputState.interrupted) {
      await this.emitSnapshotEvent(session);
    }
    if (inputState.commandSubmitted) {
      this.scheduleStateRefresh(session);
    }
  }

  async resize(input: TerminalResizeInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session?.process) {
      return;
    }
    session.cols = input.cols;
    session.rows = input.rows;
    session.updatedAt = new Date().toISOString();
    session.process.resize(input.cols, input.rows);
  }

  async runCommand(input: TerminalRunInput) {
    return this.requestCommandState(input, "running");
  }

  async stopCommand(input: TerminalStopInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session) {
      return null;
    }

    session.desiredRunState = "idle";
    session.pendingStartRequest = false;
    session.pendingRestart = false;
    session.startRequested = false;
    session.operation = "stopping";
    session.updatedAt = new Date().toISOString();
    const snapshot = await this.emitSnapshotEvent(session);

    const needsStop =
      Boolean(session.process) &&
      (snapshot.hasActiveProcess ||
        session.managedRunActive ||
        session.startRequested ||
        session.stopRequested);

    if (!needsStop) {
      session.operation = "none";
      session.updatedAt = new Date().toISOString();
      return this.emitSnapshotEvent(session);
    }

    const currentSnapshot = await this.startStopRequest(session, {
      keepStoppingOnFailure: false,
      respawnShellOnExit: session.kind === "command",
    });
    if (!currentSnapshot?.hasActiveProcess && !session.managedRunActive && !session.startRequested) {
      session.operation = "none";
      session.updatedAt = new Date().toISOString();
      return this.emitSnapshotEvent(session);
    }

    const isCurrentStopRequest = () =>
      session.desiredRunState === "idle" &&
      session.operation === "stopping" &&
      !session.pendingStartRequest &&
      !session.pendingRestart;

    void this.finishStopRequest(session, {
      keepStoppingOnFailure: false,
      respawnShellOnExit: session.kind === "command",
      shouldContinue: isCurrentStopRequest,
    }).then(async () => {
      if (!isCurrentStopRequest()) {
        return;
      }
      session.operation = "none";
      session.updatedAt = new Date().toISOString();
      await this.emitSnapshotEvent(session);
    });

    return currentSnapshot ?? snapshot;
  }

  async restartCommand(input: TerminalRestartInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session?.process) {
      return this.runCommand(input);
    }

    session.desiredRunState = "running";
    session.pendingStartRequest = true;
    session.pendingRestart = true;
    session.operation = "restarting";
    session.updatedAt = new Date().toISOString();
    await this.emitSnapshotEvent(session);

    const currentSnapshot = await this.snapshot(session);
    const needsStop =
      currentSnapshot.hasActiveProcess ||
      currentSnapshot.status === "booting" ||
      session.managedRunActive ||
      session.startRequested ||
      session.stopRequested;

    if (needsStop) {
      const stopSnapshot = await this.requestStop(session, {
        keepStoppingOnFailure: false,
        respawnShellOnExit: false,
      });
      if (stopSnapshot?.hasActiveProcess) {
        return stopSnapshot;
      }
    }

    session.pendingRestart = false;
    return this.runCommand(input);
  }

  async runProjectCommands(inputs: readonly TerminalRunInput[]) {
    this.recordProjectOperation(inputs, "running", "starting");
    await Promise.all(inputs.map((input) => this.requestCommandState(input, "running")));
  }

  async stopProjectCommands(inputs: readonly TerminalStopInput[]) {
    this.recordProjectOperation(inputs, "idle", "stopping");
    await Promise.all(inputs.map((input) => this.stopCommand(input)));
  }

  async restartProjectCommands(inputs: readonly TerminalRestartInput[]) {
    this.recordProjectOperation(inputs, "running", "restarting");
    await Promise.all(
      inputs.map((input) => this.requestCommandState(input, "running", { restart: true })),
    );
  }

  private recordProjectOperation(
    inputs: readonly { projectId: string; tabId: string }[],
    desiredRunState: "idle" | "running",
    operation: Exclude<TerminalSessionOperation, "none">,
  ) {
    const inputsByProject = new Map<string, Set<string>>();
    for (const input of inputs) {
      let tabIds = inputsByProject.get(input.projectId);
      if (!tabIds) {
        tabIds = new Set<string>();
        inputsByProject.set(input.projectId, tabIds);
      }
      tabIds.add(input.tabId);
    }

    for (const [projectId, tabIds] of inputsByProject) {
      this.projectOperations.set(projectId, {
        desiredRunState,
        operation,
        tabIds,
      });
    }
  }

  async getProjectOperation(
    projectId: string,
    trackedTabIds: readonly string[],
    snapshots?: readonly TerminalSessionSnapshot[],
  ): Promise<TerminalSessionOperation> {
    const operationState = this.projectOperations.get(projectId);
    if (!operationState) {
      return "none";
    }

    const effectiveTabIds = new Set(
      trackedTabIds.length > 0 ? trackedTabIds : [...operationState.tabIds],
    );
    const sessionSnapshots =
      snapshots ??
      (await this.getProjectSessions(projectId)).filter((snapshot) => effectiveTabIds.has(snapshot.tabId));

    const sessionByTabId = new Map(sessionSnapshots.map((snapshot) => [snapshot.tabId, snapshot]));
    const isTransitionComplete = (snapshot: TerminalSessionSnapshot | undefined) =>
      !snapshot || (snapshot.operation === "none" && snapshot.status !== "booting");

    const settled = [...effectiveTabIds].every((tabId) => {
      const snapshot = sessionByTabId.get(tabId);
      if (operationState.desiredRunState === "running") {
        return isTransitionComplete(snapshot);
      }

      return isTransitionComplete(snapshot) && (!snapshot || !snapshot.hasActiveProcess);
    });

    if (settled) {
      this.projectOperations.delete(projectId);
      return "none";
    }

    return operationState.operation;
  }

  async getProjectRunningCommandCount(projectId: string, tabIds: string[]) {
    const snapshots = await this.getProjectSessions(projectId);
    const trackedTabIds = new Set(tabIds);
    return snapshots.reduce(
      (count, snapshot) =>
        count + (trackedTabIds.has(snapshot.tabId) && snapshot.hasActiveProcess ? 1 : 0),
      0,
    );
  }

  async getProjectSessions(projectId: string) {
    const processTable = await this.listProcessTable();
    return Promise.all(
      [...this.sessions.values()]
      .filter((session) => session.projectId === projectId)
      .map((session) => this.snapshot(session, processTable)),
    );
  }

  async getSession(projectId: string, tabId: string) {
    const session = this.sessions.get(this.sessionKey(projectId, tabId));
    if (!session) {
      return null;
    }
    return this.snapshot(session);
  }

  hasActiveSessions() {
    for (const session of this.sessions.values()) {
      if (session.process) {
        return true;
      }
    }
    return false;
  }

  async listPortUsages(): Promise<TerminalPortUsage[]> {
    if (process.platform === "win32") {
      return [];
    }

    const processTable = await this.listProcessTable();
    const activeSessions = [...this.sessions.values()].filter((session) => session.process?.pid);
    if (activeSessions.length === 0) {
      return [];
    }

    const sessionContexts = (
      await Promise.all(
        activeSessions.map(async (session) => {
          const terminalPid = session.process?.pid ?? null;
          if (!terminalPid) {
            return null;
          }

          const tab = await this.loadTab(session.projectId, session.tabId).catch(() => null);
          return {
            cwd: session.cwd,
            lastCommand: session.lastCommand,
            projectId: session.projectId,
            tabId: session.tabId,
            tabKind: tab?.kind ?? session.kind,
            tabTitle: tab?.title ?? session.tabId,
            terminalPid,
          } satisfies TerminalPortUsageSessionContext;
        }),
      )
    ).filter((context): context is TerminalPortUsageSessionContext => context !== null);

    const ownershipContexts = buildPortUsageOwnershipContexts(sessionContexts, processTable);

    if (ownershipContexts.length === 0) {
      return [];
    }

    const pidSet = new Set<number>();
    for (const context of ownershipContexts) {
      for (const pid of collectTerminalOwnershipPids(context)) {
        pidSet.add(pid);
      }
    }

    if (pidSet.size === 0) {
      return [];
    }

    const stdoutChunks = await runScopedLsofForPids([...pidSet]);
    if (stdoutChunks.length === 0) {
      return [];
    }

    const listenerRecords = stdoutChunks.flatMap((stdout) => parseLsofTcpListenOutput(stdout));
    if (listenerRecords.length === 0) {
      return [];
    }

    return joinListenerRecordsToPortUsages(listenerRecords, ownershipContexts, undefined, loadPortlessRoutes());
  }

  private moveHistory(projectId: string, previousTabId: string, nextTabId: string, history: string | null) {
    if (previousTabId === nextTabId) {
      return;
    }

    const previousHistoryPath = this.historyPath(projectId, previousTabId);
    const nextHistoryPath = this.historyPath(projectId, nextTabId);
    const previousShellHistoryPath = this.shellHistoryPath(projectId, previousTabId);
    const nextShellHistoryPath = this.shellHistoryPath(projectId, nextTabId);

    try {
      if (fs.existsSync(previousHistoryPath)) {
        fs.rmSync(nextHistoryPath, { force: true });
        fs.renameSync(previousHistoryPath, nextHistoryPath);
      } else if (history) {
        fs.writeFileSync(nextHistoryPath, history, "utf8");
      }
    } catch {
      // Ignore history migration failures and keep the session usable.
    }

    try {
      if (fs.existsSync(previousShellHistoryPath)) {
        fs.rmSync(nextShellHistoryPath, { force: true });
        fs.renameSync(previousShellHistoryPath, nextShellHistoryPath);
      }
    } catch {
      // Ignore shell history migration failures and keep the session usable.
    }
  }

  async moveSessionTab(projectId: string, previousTabId: string, nextTabId: string) {
    if (previousTabId === nextTabId) {
      return;
    }

    const previousKey = this.sessionKey(projectId, previousTabId);
    const session = this.sessions.get(previousKey);
    this.moveHistory(projectId, previousTabId, nextTabId, session?.history ?? null);
    if (!session) {
      return;
    }

    if (session.persistTimer) {
      clearTimeout(session.persistTimer);
      session.persistTimer = null;
    }

    this.sessions.delete(previousKey);
    session.tabId = nextTabId;
    session.updatedAt = new Date().toISOString();
    session.lastPublishedStateKey = null;
    this.sessions.set(this.sessionKey(projectId, nextTabId), session);
  }

  async migrateCommandHistoryTabIds(
    migrations: ReadonlyArray<{
      nextTabId: string;
      previousTabId: string;
      projectId: string;
    }>,
  ) {
    for (const migration of migrations) {
      await this.moveSessionTab(migration.projectId, migration.previousTabId, migration.nextTabId);
    }
  }

  async close(input: TerminalCloseInput) {
    const key = this.sessionKey(input.projectId, input.tabId);
    const session = this.sessions.get(key);
    const process = session?.process ?? null;
    if (session) {
      session.closing = true;
      session.respawnShellOnExit = false;
      session.updatedAt = new Date().toISOString();
    }
    if (session && process) {
      await this.requestStop(session, {
        keepStoppingOnFailure: true,
        respawnShellOnExit: false,
      });
    }
    if (session) {
      await this.syncShellTabCwd(session);
    }
    if (session?.persistTimer) {
      clearTimeout(session.persistTimer);
      session.persistTimer = null;
    }
    if (session?.cwdPersistTimer) {
      clearTimeout(session.cwdPersistTimer);
      session.cwdPersistTimer = null;
    }
    if (session?.stateRefreshTimer) {
      clearTimeout(session.stateRefreshTimer);
      session.stateRefreshTimer = null;
    }
    session?.startupGate?.dispose();
    if (session) {
      session.lastPublishedStateKey = null;
      session.promptResolve = null;
      session.promptWait = null;
      session.respawnShellOnExit = false;
      session.stopRequested = false;
      session.startupGate = null;
      session.process = null;
    }
    process?.kill();
    this.sessions.delete(key);
    if (input.deleteHistory) {
      fs.rmSync(this.historyPath(input.projectId, input.tabId), { force: true });
      fs.rmSync(this.shellHistoryPath(input.projectId, input.tabId), { force: true });
    }
  }

  async closeProject(projectId: string) {
    const sessions = [...this.sessions.values()].filter((session) => session.projectId === projectId);
    await Promise.all(sessions.map((session) =>
      this.close({
        deleteHistory: true,
        projectId,
        tabId: session.tabId,
      }),
    ));
  }
}
