import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  GENERAL_SPACE_ID,
  type CommandConfig,
  type ProjectRecord,
  type ProjectTabRecord,
  type TerminalCloseInput,
  type TerminalEvent,
  type TerminalOpenInput,
  type TerminalRestartInput,
  type TerminalResizeInput,
  type TerminalRunInput,
  type TerminalSessionSnapshot,
  type TerminalStopInput,
  type TerminalWriteInput,
} from "@kickstart/contracts";
import { resolveDefaultShell, resolveProjectCwd } from "@kickstart/core";
import * as nodePty from "node-pty";

import { createTerminalStartupGate, type TerminalStartupGate } from "./terminal-startup";

interface TerminalSessionState {
  cols: number;
  closing: boolean;
  cwd: string;
  history: string;
  inputBuffer: string;
  kind: ProjectTabRecord["kind"];
  lastCommand: string | null;
  lastPublishedStateKey: string | null;
  managedRunActive: boolean;
  oscBuffer: string;
  promptReady: boolean;
  promptResolve: (() => void) | null;
  promptWait: Promise<void> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  process: nodePty.IPty | null;
  projectId: string;
  respawnShellOnExit: boolean;
  rows: number;
  shellIntegrationActive: boolean;
  shellIntegrationCommandRunning: boolean;
  startRequested: boolean;
  stateRefreshTimer: ReturnType<typeof setTimeout> | null;
  stopRequested: boolean;
  startupBypassActive: boolean;
  startupGate: TerminalStartupGate | null;
  status: TerminalSessionSnapshot["status"];
  tabId: string;
  updatedAt: string;
}

interface TerminalManagerOptions {
  historyDir: string;
  loadCommand: (projectId: string, commandId: string) => Promise<CommandConfig | null>;
  loadProject: (projectId: string) => Promise<ProjectRecord | null>;
  loadTab: (projectId: string, tabId: string) => Promise<ProjectTabRecord | null>;
  onEvent: (event: TerminalEvent) => void;
  persistTabCwd: (projectId: string, tabId: string, cwd: string) => Promise<void> | void;
}

interface ShellLaunchOptions {
  env?: Record<string, string>;
  startupCommand?: string;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
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
  private readonly loadCommand: TerminalManagerOptions["loadCommand"];
  private readonly loadProject: TerminalManagerOptions["loadProject"];
  private readonly loadTab: TerminalManagerOptions["loadTab"];
  private readonly onEvent: TerminalManagerOptions["onEvent"];
  private readonly persistTabCwd: TerminalManagerOptions["persistTabCwd"];
  private readonly sessions = new Map<string, TerminalSessionState>();

  constructor(options: TerminalManagerOptions) {
    this.historyDir = options.historyDir;
    this.loadCommand = options.loadCommand;
    this.loadProject = options.loadProject;
    this.loadTab = options.loadTab;
    this.onEvent = options.onEvent;
    this.persistTabCwd = options.persistTabCwd;
    fs.mkdirSync(this.historyDir, { recursive: true });
  }

  private sessionKey(projectId: string, tabId: string) {
    return `${projectId}:${tabId}`;
  }

  private historyPath(projectId: string, tabId: string) {
    return path.join(
      this.historyDir,
      `${projectId.replaceAll(/[^a-z0-9-]/gi, "_")}_${tabId.replaceAll(/[^a-z0-9:-]/gi, "_")}.log`,
    );
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
    if (!rootPid) {
      return [];
    }

    const childrenByParent = new Map<number, number[]>();
    for (const row of processTable) {
      const siblings = childrenByParent.get(row.ppid) ?? [];
      siblings.push(row.pid);
      childrenByParent.set(row.ppid, siblings);
    }

    const rowsByPid = new Map(processTable.map((row) => [row.pid, row]));
    const stack = [...(childrenByParent.get(rootPid) ?? [])];
    const descendants: ProcessRow[] = [];

    while (stack.length > 0) {
      const pid = stack.pop();
      if (!pid) {
        continue;
      }
      const row = rowsByPid.get(pid);
      if (!row) {
        continue;
      }
      if (!row.stat.includes("Z")) {
        descendants.push(row);
      }
      stack.push(...(childrenByParent.get(pid) ?? []));
    }

    return descendants;
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
    options: {
      keepStoppingOnFailure: boolean;
      respawnShellOnExit: boolean;
    },
  ) {
    const currentSnapshot = await this.startStopRequest(session, options);
    if (!currentSnapshot?.hasActiveProcess) {
      return currentSnapshot;
    }
    return this.finishStopRequest(session, options);
  }

  private async startStopRequest(
    session: TerminalSessionState,
    options: {
      keepStoppingOnFailure: boolean;
      respawnShellOnExit: boolean;
    },
  ) {
    if (!session.process) {
      return null;
    }

    const currentSnapshot = await this.snapshot(session);
    if (!currentSnapshot.hasActiveProcess) {
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
    options: {
      keepStoppingOnFailure: boolean;
      respawnShellOnExit: boolean;
    },
  ) {
    if (!session.process) {
      return this.snapshot(session);
    }
    let snapshot = await this.waitForShellIdle(session, STOP_INTERRUPT_TIMEOUT_MS);
    if (!snapshot.hasActiveProcess) {
      session.stopRequested = false;
      return this.publishUpdatedSnapshot(session, snapshot);
    }

    await this.sendInterruptBurst(session);
    if (!session.process) {
      return this.snapshot(session);
    }
    snapshot = await this.waitForShellIdle(session, STOP_BURST_INTERRUPT_TIMEOUT_MS);
    if (!snapshot.hasActiveProcess) {
      session.stopRequested = false;
      return this.publishUpdatedSnapshot(session, snapshot);
    }

    if (!session.process) {
      return this.snapshot(session);
    }
    await this.signalDescendantProcesses(session.process.pid, "SIGTERM");
    snapshot = await this.waitForShellIdle(session, STOP_TERM_TIMEOUT_MS);
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
    const activeProcessCount = session.shellIntegrationActive
      ? (session.shellIntegrationCommandRunning ? 1 : 0)
      : session.startupBypassActive
        ? 0
      : this.countDescendantProcesses(
          session.process?.pid ?? null,
          processTable ?? (await this.listProcessTable()),
        );
    const hasActiveProcess = activeProcessCount > 0;
    const status = session.closing
      ? "stopping"
      : !session.process
      ? "stopped"
      : session.stopRequested
        ? "stopping"
        : session.startRequested && !hasActiveProcess
          ? "starting"
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

  private queuePersist(session: TerminalSessionState) {
    if (session.persistTimer) {
      clearTimeout(session.persistTimer);
    }
    session.persistTimer = setTimeout(() => {
      session.persistTimer = null;
      fs.writeFileSync(this.historyPath(session.projectId, session.tabId), session.history, "utf8");
    }, 80);
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
      this.scheduleStateRefresh(session, 0);
      return;
    }

    if (payload.startsWith("633;P;Cwd=")) {
      session.shellIntegrationActive = true;
      session.cwd = payload.slice("633;P;Cwd=".length);
      session.updatedAt = new Date().toISOString();
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
    const ready = await Promise.race([
      session.promptWait!.then(() => true),
      sleep(timeoutMs).then(() => false),
    ]);
    if (!ready) {
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

  private ensureZshIntegrationDir() {
    const root = path.join(this.historyDir, "..", "shell-integration", "zsh");
    fs.mkdirSync(root, { recursive: true });

    const bootstrapPath = path.join(root, "kickstart.zsh");
    const bootstrap = `
if [[ -n "\${KICKSTART_SHELL_INTEGRATION_LOADED:-}" ]]; then
  return
fi
export KICKSTART_SHELL_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

_kickstart_emit() {
  printf '\\e]%s\\a' "$1"
}

_kickstart_precmd() {
  _kickstart_emit "133;D;$?"
  _kickstart_emit "1337;CurrentDir=$PWD"
  _kickstart_emit '133;A'
  _kickstart_emit '133;B'
}

_kickstart_preexec() {
  _kickstart_emit '133;C'
}

add-zsh-hook precmd _kickstart_precmd
add-zsh-hook preexec _kickstart_preexec
`.trimStart();
    fs.writeFileSync(bootstrapPath, bootstrap, "utf8");

    const sourceOrTrue = (fileName: string) =>
      `if [[ -f "$HOME/${fileName}" ]]; then source "$HOME/${fileName}"; fi`;

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

  private prepareShellLaunch(
    shell: ReturnType<typeof resolveDefaultShell>,
    launchOptions?: ShellLaunchOptions,
  ) {
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...launchOptions?.env,
      SHELL: process.platform === "win32" ? process.env.SHELL : shell.command,
      TERM: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      TERM_PROGRAM: "kickstart",
    };

    const shellName = path.basename(shell.command);
    if (process.platform !== "win32" && shellName === "zsh") {
      env.ZDOTDIR = this.ensureZshIntegrationDir();
    }

    return {
      args: shell.args,
      env,
    };
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
    let command: CommandConfig | null = null;
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
    const { args, env } = this.prepareShellLaunch(shell, launchOptions);
    const pty = nodePty.spawn(shell.command, args, {
      cols: session.cols,
      cwd: session.cwd,
      env,
      name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      rows: session.rows,
    });
    session.process = pty;
    session.status = "running";
    session.updatedAt = new Date().toISOString();

    pty.onData((data) => {
      if (session.process !== pty) {
        return;
      }
      session.startupGate?.signalActivity();
      session.history = `${session.history}${data}`;
      session.updatedAt = new Date().toISOString();
       this.parseOscSequences(session, data);
      this.detectPrompt(session, data);
      this.queuePersist(session);
      this.onEvent({
        createdAt: new Date().toISOString(),
        data,
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
      session.stopRequested = false;
      session.status = "stopped";
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
      const history = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, "utf8") : "";
      session = {
        cols: input.cols || DEFAULT_COLS,
        closing: false,
        cwd: runtime.cwd,
        history,
        inputBuffer: "",
        kind: runtime.tab.kind,
        lastCommand: null,
        lastPublishedStateKey: null,
        managedRunActive: false,
        oscBuffer: "",
        promptReady: false,
        promptResolve: null,
        promptWait: null,
        persistTimer: null,
        process: null,
        projectId: input.projectId,
        respawnShellOnExit: false,
        rows: input.rows || DEFAULT_ROWS,
        shellIntegrationActive: false,
        shellIntegrationCommandRunning: false,
        startRequested: false,
        stateRefreshTimer: null,
        stopRequested: false,
        startupBypassActive: false,
        startupGate: null,
        status: "starting",
        tabId: input.tabId,
        updatedAt: new Date().toISOString(),
      };
      this.sessions.set(key, session);
    } else {
      session.closing = false;
      session.cols = input.cols || session.cols;
      session.cwd = runtime.cwd;
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
    const runtime = await this.resolveTabRuntime(input.projectId, input.tabId);
    if (!runtime.command) {
      return;
    }
    const existingSession = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (existingSession?.process) {
      const currentSnapshot = await this.waitForShellIdle(existingSession);
      if (
        existingSession.managedRunActive ||
        (currentSnapshot.hasActiveProcess && existingSession.lastCommand !== null)
      ) {
        return currentSnapshot;
      }
    }
    return this.open(
      {
        cols: DEFAULT_COLS,
        projectId: input.projectId,
        rows: DEFAULT_ROWS,
        tabId: input.tabId,
      },
      {
        env: runtime.command.env,
        startupCommand: runtime.command.command,
      },
    );
  }

  async stopCommand(input: TerminalStopInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session?.process) {
      return;
    }
    const currentSnapshot = await this.startStopRequest(session, {
      keepStoppingOnFailure: false,
      respawnShellOnExit: session.kind === "command",
    });
    if (!currentSnapshot?.hasActiveProcess) {
      return;
    }
    void this.finishStopRequest(session, {
      keepStoppingOnFailure: false,
      respawnShellOnExit: session.kind === "command",
    });
  }

  async restartCommand(input: TerminalRestartInput) {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.tabId));
    if (!session?.process) {
      return this.runCommand(input);
    }

    const currentSnapshot = await this.snapshot(session);
    if (!currentSnapshot.hasActiveProcess) {
      return this.runCommand(input);
    }

    const stopSnapshot = await this.requestStop(session, {
      keepStoppingOnFailure: false,
      respawnShellOnExit: session.kind === "command",
    });
    if (stopSnapshot?.hasActiveProcess) {
      return stopSnapshot;
    }

    return this.runCommand(input);
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
