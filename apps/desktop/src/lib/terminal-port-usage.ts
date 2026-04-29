import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { TerminalPortlessRoute, TerminalPortUsage } from "@kickstart/contracts";
import type { TabKind } from "@kickstart/contracts";

const execFile = promisify(execFileCallback);
const DEFAULT_LSOF_TIMEOUT_MS = 1_000;
const DEFAULT_LSOF_CHUNK_SIZE = 80;
const DEFAULT_PORT_USAGE_DEBOUNCE_MS = 200;
const DEFAULT_PORT_USAGE_POLL_INTERVAL_MS = 4_000;
const PORTLESS_SYSTEM_STATE_DIR = process.platform === "win32"
  ? path.join(os.tmpdir(), "portless")
  : "/tmp/portless";
const PORTLESS_USER_STATE_DIR = path.join(os.homedir(), ".portless");
const PORTLESS_DEFAULT_TLD = "localhost";
const PORTLESS_FALLBACK_PROXY_PORT = 1355;

export interface ProcessTableRow {
  comm: string;
  pid: number;
  ppid: number;
  stat: string;
}

export interface TerminalPortUsageSessionContext {
  cwd: string;
  lastCommand: string | null;
  projectId: string;
  tabId: string;
  tabKind: TabKind;
  tabTitle: string;
  terminalPid: number;
}

export interface TerminalPortUsageOwnershipContext extends TerminalPortUsageSessionContext {
  descendantPids: number[];
}

export interface LsofTcpListenerRecord {
  address: string;
  pid: number;
  port: number;
  processName: string;
  protocol: "tcp";
}

export interface PortlessRouteRecord extends TerminalPortlessRoute {
  stateDir: string;
}

export interface PortUsageTracker {
  dispose(): void;
  getCurrent(): TerminalPortUsage[];
  refreshNow(): Promise<TerminalPortUsage[]>;
  requestRefresh(): void;
}

export interface PortUsageTrackerOptions {
  debounceMs?: number;
  hasActiveSessions: () => boolean;
  listPortUsages: () => Promise<TerminalPortUsage[]>;
  onChange: (usages: TerminalPortUsage[]) => void;
  pollIntervalMs?: number;
}

function chunkArray<T>(values: readonly T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function stablePortUsageId(usage: TerminalPortUsage) {
  return JSON.stringify([
    usage.projectId,
    usage.tabId,
    usage.terminalPid,
    usage.pid,
    usage.protocol,
    usage.address,
    usage.port,
  ]);
}

function stablePortUsageKey(usage: TerminalPortUsage) {
  return JSON.stringify([
    usage.id,
    usage.address,
    usage.cwd,
    usage.lastCommand,
    usage.pid,
    usage.port,
    usage.processName,
    usage.protocol,
    usage.projectId,
    usage.tabId,
    usage.tabKind,
    usage.tabTitle,
    usage.terminalPid,
    usage.portlessRoutes.map((route) => [
      route.hostname,
      route.pid,
      route.port,
      route.url,
    ]),
  ]);
}

function comparePortUsages(left: TerminalPortUsage, right: TerminalPortUsage) {
  return (
    left.projectId.localeCompare(right.projectId) ||
    left.tabId.localeCompare(right.tabId) ||
    left.port - right.port ||
    left.address.localeCompare(right.address) ||
    left.pid - right.pid ||
    left.processName.localeCompare(right.processName)
  );
}

function cleanLsofPortName(value: string) {
  return value.trim().replace(/^(?:TCP|UDP)\s+/i, "").replace(/\s*\(.*\)\s*$/, "");
}

export function parseLsofPortName(value: string): { address: string; port: number } | null {
  const cleaned = cleanLsofPortName(value);
  if (!cleaned) {
    return null;
  }

  const portSeparatorIndex = cleaned.lastIndexOf(":");
  if (portSeparatorIndex <= 0) {
    return null;
  }

  const portValue = cleaned.slice(portSeparatorIndex + 1).trim();
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  const address = cleaned.slice(0, portSeparatorIndex).trim();
  if (!address) {
    return null;
  }

  return {
    address,
    port,
  };
}

export function parseLsofTcpListenOutput(stdout: string): LsofTcpListenerRecord[] {
  const records: LsofTcpListenerRecord[] = [];
  let currentPid: number | null = null;
  let currentProcessName = "";

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const field = trimmed[0];
    const value = trimmed.slice(1).trim();

    if (field === "p") {
      const pid = Number.parseInt(value, 10);
      currentPid = Number.isFinite(pid) && pid > 0 ? pid : null;
      currentProcessName = "";
      continue;
    }

    if (field === "c") {
      if (currentPid === null) {
        continue;
      }
      currentProcessName = value;
      continue;
    }

    if (field !== "n" || currentPid === null) {
      continue;
    }

    const parsed = parseLsofPortName(value);
    if (!parsed) {
      continue;
    }

    records.push({
      address: parsed.address,
      pid: currentPid,
      port: parsed.port,
      processName: currentProcessName,
      protocol: "tcp",
    });
  }

  return records;
}

export function parsePortlessRoutesJson(raw: string): Array<{
  hostname: string;
  pid: number;
  port: number;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const route = item as Record<string, unknown>;
    const hostname = typeof route.hostname === "string" ? route.hostname.trim() : "";
    const port = typeof route.port === "number" ? route.port : Number(route.port);
    const pid = typeof route.pid === "number" ? route.pid : Number(route.pid);
    if (!hostname || !Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid < 0) {
      return [];
    }
    return [{ hostname, pid, port }];
  });
}

export function formatPortlessUrl(hostname: string, proxyPort: number, tls: boolean) {
  const protocol = tls ? "https" : "http";
  const shouldOmitPort = (tls && proxyPort === 443) || (!tls && proxyPort === 80);
  return `${protocol}://${hostname}${shouldOmitPort ? "" : `:${proxyPort}`}`;
}

function readIntegerFile(filePath: string) {
  try {
    const value = Number.parseInt(fs.readFileSync(filePath, "utf8").trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function readTextFile(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  if (pid === 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getPortlessStateDirs(env: NodeJS.ProcessEnv = process.env) {
  const dirs = [
    env.PORTLESS_STATE_DIR,
    PORTLESS_USER_STATE_DIR,
    PORTLESS_SYSTEM_STATE_DIR,
  ].filter((dir): dir is string => Boolean(dir && dir.trim()));
  return [...new Set(dirs)];
}

export function loadPortlessRoutes(options?: {
  env?: NodeJS.ProcessEnv;
  stateDirs?: readonly string[];
}) {
  const routes: PortlessRouteRecord[] = [];
  const stateDirs = options?.stateDirs ?? getPortlessStateDirs(options?.env);

  for (const stateDir of stateDirs) {
    const routesPath = path.join(stateDir, "routes.json");
    let rawRoutes: string;
    try {
      rawRoutes = fs.readFileSync(routesPath, "utf8");
    } catch {
      continue;
    }

    const proxyPort =
      readIntegerFile(path.join(stateDir, "proxy.port")) ??
      (stateDir === PORTLESS_SYSTEM_STATE_DIR ? 443 : PORTLESS_FALLBACK_PROXY_PORT);
    const tls = fs.existsSync(path.join(stateDir, "proxy.tls"));
    const tld = readTextFile(path.join(stateDir, "proxy.tld")) ?? PORTLESS_DEFAULT_TLD;

    for (const route of parsePortlessRoutesJson(rawRoutes)) {
      if (!isProcessAlive(route.pid)) {
        continue;
      }
      const hostname = route.hostname.includes(".") ? route.hostname : `${route.hostname}.${tld}`;
      routes.push({
        hostname,
        pid: route.pid === 0 ? null : route.pid,
        port: route.port,
        stateDir,
        url: formatPortlessUrl(hostname, proxyPort, tls),
      });
    }
  }

  return routes.sort((left, right) =>
    left.port - right.port ||
    left.hostname.localeCompare(right.hostname) ||
    left.url.localeCompare(right.url),
  );
}

export function collectDescendantProcessRows(rootPid: number | null, processTable: readonly ProcessTableRow[]) {
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
  const descendants: ProcessTableRow[] = [];

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

  return descendants.sort((left, right) => left.pid - right.pid);
}

export function collectDescendantPids(rootPid: number | null, processTable: readonly ProcessTableRow[]) {
  return collectDescendantProcessRows(rootPid, processTable).map((row) => row.pid);
}

export function buildPortUsageOwnershipContexts(
  sessionContexts: readonly TerminalPortUsageSessionContext[],
  processTable: readonly ProcessTableRow[],
) {
  return sessionContexts
    .map((sessionContext) => ({
      ...sessionContext,
      descendantPids: collectDescendantPids(sessionContext.terminalPid, processTable),
    }))
    .filter((sessionContext) =>
      Number.isFinite(sessionContext.terminalPid) && sessionContext.terminalPid > 0,
    );
}

export function collectTerminalOwnershipPids(context: TerminalPortUsageOwnershipContext) {
  return [context.terminalPid, ...context.descendantPids];
}

export function joinListenerRecordsToPortUsages(
  listenerRecords: readonly LsofTcpListenerRecord[],
  ownershipContexts: readonly TerminalPortUsageOwnershipContext[],
  updatedAt = new Date().toISOString(),
  portlessRoutes: readonly PortlessRouteRecord[] = [],
) {
  const ownershipByPid = new Map<number, TerminalPortUsageOwnershipContext[]>();
  for (const context of ownershipContexts) {
    for (const pid of collectTerminalOwnershipPids(context)) {
      const contexts = ownershipByPid.get(pid) ?? [];
      if (!contexts.includes(context)) {
        contexts.push(context);
        ownershipByPid.set(pid, contexts);
      }
    }
  }

  const usagesById = new Map<string, TerminalPortUsage>();

  for (const record of listenerRecords) {
    const contexts = ownershipByPid.get(record.pid) ?? [];
    for (const context of contexts) {
      const usage: TerminalPortUsage = {
        address: record.address,
        cwd: context.cwd,
        id: stablePortUsageId({
          address: record.address,
          cwd: context.cwd,
          id: "",
          lastCommand: context.lastCommand,
          pid: record.pid,
          port: record.port,
          processName: record.processName,
          protocol: record.protocol,
          projectId: context.projectId,
          portlessRoutes: [],
          tabId: context.tabId,
          tabKind: context.tabKind,
          tabTitle: context.tabTitle,
          terminalPid: context.terminalPid,
          updatedAt,
        }),
        lastCommand: context.lastCommand,
        pid: record.pid,
        port: record.port,
        portlessRoutes: portlessRoutes
          .filter(
            (route) =>
              route.port === record.port &&
              (route.pid === null ||
                route.pid === record.pid ||
                collectTerminalOwnershipPids(context).includes(route.pid)),
          )
          .map((route) => ({
            hostname: route.hostname,
            pid: route.pid,
            port: route.port,
            url: route.url,
          })),
        processName: record.processName,
        projectId: context.projectId,
        protocol: record.protocol,
        tabId: context.tabId,
        tabKind: context.tabKind,
        tabTitle: context.tabTitle,
        terminalPid: context.terminalPid,
        updatedAt,
      };

      usagesById.set(usage.id, usage);
    }
  }

  return [...usagesById.values()].sort(comparePortUsages);
}

export async function runScopedLsofForPids(
  pids: readonly number[],
  options?: {
    chunkSize?: number;
    timeoutMs?: number;
    execFileFn?: typeof execFile;
  },
) {
  if (process.platform === "win32") {
    return [] as string[];
  }

  const uniquePids = [...new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0))].sort(
    (left, right) => left - right,
  );
  if (uniquePids.length === 0) {
    return [] as string[];
  }

  const chunkSize = options?.chunkSize ?? DEFAULT_LSOF_CHUNK_SIZE;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LSOF_TIMEOUT_MS;
  const execFileFn = options?.execFileFn ?? execFile;
  const outputs: string[] = [];

  for (const chunk of chunkArray(uniquePids, chunkSize)) {
    const pidList = chunk.join(",");
    try {
      const { stdout } = await execFileFn("lsof", [
        "-nP",
        "-a",
        "-p",
        pidList,
        "-iTCP",
        "-sTCP:LISTEN",
        "-Fpcn",
      ], {
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
      });
      if (typeof stdout === "string" && stdout.length > 0) {
        outputs.push(stdout);
      }
    } catch (error) {
      const stdout = error instanceof Error ? (error as { stdout?: unknown }).stdout : null;
      if (typeof stdout === "string" && stdout.length > 0) {
        outputs.push(stdout);
      }
    }
  }

  return outputs;
}

export function createPortUsageTracker(options: PortUsageTrackerOptions): PortUsageTracker {
  let current: TerminalPortUsage[] = [];
  let currentKey = "";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<TerminalPortUsage[]> | null = null;
  let dirty = false;
  let disposed = false;

  const debounceMs = options.debounceMs ?? DEFAULT_PORT_USAGE_DEBOUNCE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PORT_USAGE_POLL_INTERVAL_MS;

  function emitIfChanged(next: TerminalPortUsage[]) {
    const nextKey = next.map(stablePortUsageKey).join("\u0000");
    const changed = nextKey !== currentKey;
    currentKey = nextKey;
    current = next;
    if (changed) {
      options.onChange(next);
    }
    return changed;
  }

  function syncPolling() {
    if (disposed) {
      return;
    }

    const shouldPoll = options.hasActiveSessions();
    if (!shouldPoll) {
      emitIfChanged([]);
    }

    if (shouldPoll && !pollTimer) {
      pollTimer = setInterval(() => {
        if (disposed) {
          return;
        }
        if (!options.hasActiveSessions()) {
          syncPolling();
          return;
        }
        void refreshNow();
      }, pollIntervalMs);
      return;
    }

    if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refreshNow() {
    if (disposed) {
      return current;
    }

    if (inFlight) {
      dirty = true;
      return inFlight;
    }

    inFlight = (async () => {
      do {
        dirty = false;
        const next = await options.listPortUsages();
        emitIfChanged(next);
      } while (dirty && !disposed);
      syncPolling();
      return current;
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function requestRefresh() {
    if (disposed) {
      return;
    }

    if (!options.hasActiveSessions()) {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      syncPolling();
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void refreshNow();
    }, debounceMs);
  }

  syncPolling();

  return {
    dispose() {
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
    getCurrent() {
      return current;
    },
    refreshNow,
    requestRefresh,
  };
}
