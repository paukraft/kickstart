import type { TabKind } from "./state";

export type TerminalSessionStatus =
  | "idle"
  | "booting"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

const TERMINAL_SESSION_TRANSITIONING_STATUSES = new Set<TerminalSessionStatus>([
  "booting",
  "starting",
  "stopping",
]);

const TERMINAL_SESSION_LOADING_STATUSES = new Set<TerminalSessionStatus>([
  "starting",
  "stopping",
]);

const TERMINAL_SESSION_START_PENDING_STATUSES = new Set<TerminalSessionStatus>([
  "booting",
  "starting",
]);

export function isTerminalSessionTransitioning(status: TerminalSessionStatus) {
  return TERMINAL_SESSION_TRANSITIONING_STATUSES.has(status);
}

export function isTerminalSessionLoading(status: TerminalSessionStatus) {
  return TERMINAL_SESSION_LOADING_STATUSES.has(status);
}

export function isTerminalSessionStartPending(status: TerminalSessionStatus) {
  return TERMINAL_SESSION_START_PENDING_STATUSES.has(status);
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
  pid: number | null;
  projectId: string;
  rows: number;
  status: TerminalSessionStatus;
  tabId: string;
  updatedAt: string;
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
