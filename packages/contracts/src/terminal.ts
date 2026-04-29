import type { TabKind } from "./state";

export type TerminalSessionStatus =
  | "idle"
  | "booting"
  | "running"
  | "stopped"
  | "error";

export type TerminalSessionOperation =
  | "none"
  | "starting"
  | "stopping"
  | "restarting";

const TERMINAL_SESSION_LOADING_OPERATIONS = new Set<TerminalSessionOperation>([
  "starting",
  "stopping",
  "restarting",
]);

export function isTerminalSessionTransitioning(
  status: TerminalSessionStatus,
  operation: TerminalSessionOperation,
) {
  return status === "booting" || TERMINAL_SESSION_LOADING_OPERATIONS.has(operation);
}

export function isTerminalSessionLoading(operation: TerminalSessionOperation) {
  return TERMINAL_SESSION_LOADING_OPERATIONS.has(operation);
}

export function isTerminalSessionStartPending(
  status: TerminalSessionStatus,
  operation: TerminalSessionOperation,
) {
  return status === "booting" || operation === "starting" || operation === "restarting";
}

export interface TerminalSessionSnapshot {
  activeProcessCount: number;
  cols: number;
  cwd: string;
  exitCode: number | null;
  hasActiveProcess: boolean;
  history: string;
  kind: TabKind;
  lastCommand: string | null;
  managedRunActive: boolean;
  operation: TerminalSessionOperation;
  outputRevision: number;
  pid: number | null;
  projectId: string;
  rows: number;
  status: TerminalSessionStatus;
  tabId: string;
  updatedAt: string;
}

export interface TerminalPortUsage {
  id: string;
  address: string;
  port: number;
  protocol: "tcp";
  pid: number;
  processName: string;
  projectId: string;
  tabId: string;
  tabTitle: string;
  tabKind: TabKind;
  terminalPid: number;
  cwd: string;
  lastCommand: string | null;
  portlessRoutes: TerminalPortlessRoute[];
  updatedAt: string;
}

export interface TerminalPortlessRoute {
  hostname: string;
  pid: number | null;
  port: number;
  url: string;
}

export interface TerminalOpenInput {
  cols: number;
  projectId: string;
  rows: number;
  tabId: string;
}

export interface TerminalWriteInput {
  data: string;
  projectId: string;
  tabId: string;
}

export interface TerminalResizeInput {
  cols: number;
  projectId: string;
  rows: number;
  tabId: string;
}

export interface TerminalRunInput {
  projectId: string;
  tabId: string;
}

export interface TerminalStopInput {
  projectId: string;
  tabId: string;
}

export interface TerminalRestartInput {
  projectId: string;
  tabId: string;
}

export interface TerminalCloseInput {
  deleteHistory?: boolean;
  projectId: string;
  tabId: string;
}

export interface TerminalSerializeInput {
  outputRevision: number;
  projectId: string;
  snapshot: string;
  tabId: string;
}

export type TerminalEvent =
  | {
      createdAt: string;
      projectId: string;
      snapshot: TerminalSessionSnapshot;
      tabId: string;
      type: "started";
    }
  | {
      createdAt: string;
      data: string;
      outputRevision: number;
      projectId: string;
      tabId: string;
      type: "output";
    }
  | {
      createdAt: string;
      exitCode: number | null;
      projectId: string;
      tabId: string;
      type: "stopped";
    }
  | {
      createdAt: string;
      message: string;
      projectId: string;
      tabId: string;
      type: "error";
    }
  | {
      createdAt: string;
      projectId: string;
      snapshot: TerminalSessionSnapshot;
      tabId: string;
      type: "updated";
    }
  | {
      createdAt: string;
      projectId: string;
      snapshot: TerminalSessionSnapshot;
      tabId: string;
      type: "cleared";
    };
