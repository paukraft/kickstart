import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPortUsageOwnershipContexts,
  collectDescendantPids,
  collectTerminalOwnershipPids,
  createPortUsageTracker,
  formatPortlessUrl,
  joinListenerRecordsToPortUsages,
  loadPortlessRoutes,
  parseLsofPortName,
  parsePortlessRoutesJson,
  parseLsofTcpListenOutput,
} from "./terminal-port-usage";
import type { TerminalPortUsage } from "@kickstart/contracts";

afterEach(() => {
  vi.useRealTimers();
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolved) => {
    resolve = resolved;
  });
  return { promise, resolve };
}

describe("parseLsofPortName", () => {
  it("parses wildcard, IPv4, IPv6, and localhost endpoints", () => {
    expect(parseLsofPortName("*:5173")).toEqual({ address: "*", port: 5173 });
    expect(parseLsofPortName("127.0.0.1:3000")).toEqual({ address: "127.0.0.1", port: 3000 });
    expect(parseLsofPortName("[::1]:5432")).toEqual({ address: "[::1]", port: 5432 });
    expect(parseLsofPortName("localhost:8080")).toEqual({ address: "localhost", port: 8080 });
  });

  it("returns null for invalid values", () => {
    expect(parseLsofPortName("")).toBeNull();
    expect(parseLsofPortName("not-a-port")).toBeNull();
    expect(parseLsofPortName("*:abc")).toBeNull();
  });
});

describe("parseLsofTcpListenOutput", () => {
  it("parses multiple ports per pid and tolerates partial output", () => {
    expect(
      parseLsofTcpListenOutput(
        [
          "p123",
          "cnode",
          "n*:5173",
          "n127.0.0.1:3000",
          "p456",
          "cnode",
          "n[::1]:5432",
          "nlocalhost:8080",
        ].join("\n"),
      ),
    ).toEqual([
      { address: "*", pid: 123, port: 5173, processName: "node", protocol: "tcp" },
      { address: "127.0.0.1", pid: 123, port: 3000, processName: "node", protocol: "tcp" },
      { address: "[::1]", pid: 456, port: 5432, processName: "node", protocol: "tcp" },
      { address: "localhost", pid: 456, port: 8080, processName: "node", protocol: "tcp" },
    ]);
  });

  it("returns an empty array for empty or partial-noise output", () => {
    expect(parseLsofTcpListenOutput("")).toEqual([]);
    expect(parseLsofTcpListenOutput("cnode\nn*:3000")).toEqual([]);
  });
});

describe("Portless route helpers", () => {
  it("parses route JSON and formats proxy URLs", () => {
    expect(
      parsePortlessRoutesJson(JSON.stringify([
        { hostname: "myapp.localhost", port: 4123, pid: 123 },
        { hostname: "api", port: "4567", pid: "0" },
        { hostname: "", port: 3000, pid: 1 },
      ])),
    ).toEqual([
      { hostname: "myapp.localhost", port: 4123, pid: 123 },
      { hostname: "api", port: 4567, pid: 0 },
    ]);

    expect(formatPortlessUrl("myapp.localhost", 443, true)).toBe("https://myapp.localhost");
    expect(formatPortlessUrl("myapp.localhost", 1355, true)).toBe("https://myapp.localhost:1355");
    expect(formatPortlessUrl("myapp.localhost", 80, false)).toBe("http://myapp.localhost");
  });

  it("loads active Portless routes from state files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-portless-test-"));
    try {
      fs.writeFileSync(path.join(dir, "proxy.port"), "1355", "utf8");
      fs.writeFileSync(path.join(dir, "proxy.tls"), "1", "utf8");
      fs.writeFileSync(path.join(dir, "routes.json"), JSON.stringify([
        { hostname: "myapp.localhost", port: 4123, pid: 0 },
        { hostname: "api", port: 4567, pid: process.pid },
        { hostname: "stale.localhost", port: 9999, pid: 99999999 },
      ]), "utf8");

      expect(loadPortlessRoutes({ stateDirs: [dir] })).toEqual([
        {
          hostname: "myapp.localhost",
          pid: null,
          port: 4123,
          stateDir: dir,
          url: "https://myapp.localhost:1355",
        },
        {
          hostname: "api.localhost",
          pid: process.pid,
          port: 4567,
          stateDir: dir,
          url: "https://api.localhost:1355",
        },
      ]);
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("collectDescendantPids", () => {
  it("includes children and grandchildren but excludes siblings and zombies", () => {
    const processTable = [
      { comm: "shell", pid: 100, ppid: 1, stat: "S" },
      { comm: "node", pid: 101, ppid: 100, stat: "S" },
      { comm: "node", pid: 102, ppid: 101, stat: "S" },
      { comm: "node", pid: 103, ppid: 100, stat: "S" },
      { comm: "node", pid: 104, ppid: 103, stat: "Z" },
    ];

    expect(collectDescendantPids(100, processTable)).toEqual([101, 102, 103]);
  });
});

describe("buildPortUsageOwnershipContexts", () => {
  it("keeps terminal roots even when they have no descendants", () => {
    const [context] = buildPortUsageOwnershipContexts(
      [
        {
          cwd: "/repo/a",
          lastCommand: "exec node server.js",
          projectId: "project-a",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "API",
          terminalPid: 100,
        },
      ],
      [
        { comm: "node", pid: 100, ppid: 1, stat: "S" },
      ],
    );

    expect(context?.descendantPids).toEqual([]);
    expect(context ? collectTerminalOwnershipPids(context) : []).toEqual([100]);
  });
});

describe("joinListenerRecordsToPortUsages", () => {
  it("keeps listeners attached to the owning terminal only", () => {
    const usages = joinListenerRecordsToPortUsages(
      [
        { address: "*", pid: 101, port: 3000, processName: "node", protocol: "tcp" },
        { address: "127.0.0.1", pid: 202, port: 4000, processName: "python", protocol: "tcp" },
        { address: "*", pid: 999, port: 5000, processName: "ruby", protocol: "tcp" },
      ],
      [
        {
          cwd: "/repo/a",
          descendantPids: [101, 102],
          lastCommand: "pnpm dev",
          projectId: "project-a",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "API",
          terminalPid: 100,
        },
        {
          cwd: "/repo/b",
          descendantPids: [202],
          lastCommand: null,
          projectId: "project-b",
          tabId: "tab-b",
          tabKind: "shell",
          tabTitle: "Shell",
          terminalPid: 200,
        },
      ],
      "2026-04-19T12:00:00.000Z",
      [
        {
          hostname: "api.localhost",
          pid: null,
          port: 3000,
          stateDir: "/tmp/portless",
          url: "https://api.localhost",
        },
      ],
    );

    expect(usages).toEqual([
      expect.objectContaining({
        address: "*",
        pid: 101,
        port: 3000,
        portlessRoutes: [{ hostname: "api.localhost", pid: null, port: 3000, url: "https://api.localhost" }],
        projectId: "project-a",
        tabId: "tab-a",
        tabTitle: "API",
      }),
      expect.objectContaining({
        address: "127.0.0.1",
        pid: 202,
        port: 4000,
        portlessRoutes: [],
        projectId: "project-b",
        tabId: "tab-b",
        tabTitle: "Shell",
      }),
    ]);
  });

  it("matches Portless routes owned by the same terminal context", () => {
    const usages = joinListenerRecordsToPortUsages(
      [
        { address: "*", pid: 101, port: 3000, processName: "node", protocol: "tcp" },
      ],
      [
        {
          cwd: "/repo/a",
          descendantPids: [101, 102],
          lastCommand: "pnpm dev",
          projectId: "project-a",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "API",
          terminalPid: 100,
        },
      ],
      "2026-04-19T12:00:00.000Z",
      [
        {
          hostname: "other.localhost",
          pid: 202,
          port: 3000,
          stateDir: "/tmp/portless",
          url: "https://other.localhost",
        },
        {
          hostname: "wrapper.localhost",
          pid: 102,
          port: 3000,
          stateDir: "/tmp/portless",
          url: "https://wrapper.localhost",
        },
        {
          hostname: "fallback.localhost",
          pid: null,
          port: 3000,
          stateDir: "/tmp/portless",
          url: "https://fallback.localhost",
        },
      ],
    );

    expect(usages[0]?.portlessRoutes).toEqual([
      { hostname: "wrapper.localhost", pid: 102, port: 3000, url: "https://wrapper.localhost" },
      { hostname: "fallback.localhost", pid: null, port: 3000, url: "https://fallback.localhost" },
    ]);
  });

  it("matches listeners owned by the terminal root process", () => {
    const usages = joinListenerRecordsToPortUsages(
      [
        { address: "127.0.0.1", pid: 100, port: 5173, processName: "node", protocol: "tcp" },
      ],
      [
        {
          cwd: "/repo/a",
          descendantPids: [],
          lastCommand: "exec node server.js",
          projectId: "project-a",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "API",
          terminalPid: 100,
        },
      ],
      "2026-04-19T12:00:00.000Z",
    );

    expect(usages).toEqual([
      expect.objectContaining({
        address: "127.0.0.1",
        pid: 100,
        port: 5173,
        processName: "node",
        projectId: "project-a",
        tabId: "tab-a",
        terminalPid: 100,
      }),
    ]);
  });
});

describe("createPortUsageTracker", () => {
  it("debounces refresh requests and reruns once when a refresh becomes dirty", async () => {
    vi.useFakeTimers();

    const first = createDeferred<TerminalPortUsage[]>();
    const second = createDeferred<TerminalPortUsage[]>();
    const listPortUsages = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onChange = vi.fn();

    const tracker = createPortUsageTracker({
      debounceMs: 200,
      hasActiveSessions: () => true,
      listPortUsages,
      onChange,
      pollIntervalMs: 10_000,
    });

    tracker.requestRefresh();
    tracker.requestRefresh();
    await vi.advanceTimersByTimeAsync(199);
    expect(listPortUsages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listPortUsages).toHaveBeenCalledTimes(1);

    tracker.requestRefresh();
    await vi.advanceTimersByTimeAsync(200);
    expect(listPortUsages).toHaveBeenCalledTimes(1);

    first.resolve([
      {
        address: "*",
        cwd: "/repo",
        id: "a",
        lastCommand: "pnpm dev",
        pid: 101,
        port: 3000,
        portlessRoutes: [],
        processName: "node",
        projectId: "project-a",
        protocol: "tcp",
        tabId: "tab-a",
        tabKind: "command",
        tabTitle: "API",
        terminalPid: 100,
        updatedAt: "2026-04-19T12:00:00.000Z",
      },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    expect(listPortUsages).toHaveBeenCalledTimes(2);

    second.resolve([
      {
        address: "*",
        cwd: "/repo",
        id: "a",
        lastCommand: "pnpm dev",
        pid: 101,
        port: 3000,
        portlessRoutes: [],
        processName: "node",
        projectId: "project-a",
        protocol: "tcp",
        tabId: "tab-a",
        tabKind: "command",
        tabTitle: "API",
        terminalPid: 100,
        updatedAt: "2026-04-19T12:00:05.000Z",
      },
    ]);

    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracker.getCurrent()).toHaveLength(1);

    tracker.dispose();
  });

  it("emits when rendered usage metadata changes", async () => {
    const listPortUsages = vi
      .fn()
      .mockResolvedValueOnce([
        {
          address: "*",
          cwd: "/repo",
          id: "a",
          lastCommand: "pnpm dev",
          pid: 101,
          port: 3000,
          portlessRoutes: [],
          processName: "node",
          projectId: "project-a",
          protocol: "tcp",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "API",
          terminalPid: 100,
          updatedAt: "2026-04-19T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          address: "*",
          cwd: "/repo/api",
          id: "a",
          lastCommand: "bun dev",
          pid: 101,
          port: 3000,
          portlessRoutes: [],
          processName: "node",
          projectId: "project-a",
          protocol: "tcp",
          tabId: "tab-a",
          tabKind: "command",
          tabTitle: "Renamed API",
          terminalPid: 100,
          updatedAt: "2026-04-19T12:00:05.000Z",
        },
      ]);
    const onChange = vi.fn();

    const tracker = createPortUsageTracker({
      debounceMs: 0,
      hasActiveSessions: () => true,
      listPortUsages,
      onChange,
      pollIntervalMs: 10_000,
    });

    await tracker.refreshNow();
    await tracker.refreshNow();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        cwd: "/repo/api",
        lastCommand: "bun dev",
        tabTitle: "Renamed API",
      }),
    ]);

    tracker.dispose();
  });

  it("emits an empty usage list when active sessions drop to zero", async () => {
    vi.useFakeTimers();

    let hasActiveSessions = true;
    const listPortUsages = vi.fn().mockResolvedValue([
      {
        address: "*",
        cwd: "/repo",
        id: "a",
        lastCommand: "pnpm dev",
        pid: 101,
        port: 3000,
        portlessRoutes: [],
        processName: "node",
        projectId: "project-a",
        protocol: "tcp",
        tabId: "tab-a",
        tabKind: "command",
        tabTitle: "API",
        terminalPid: 100,
        updatedAt: "2026-04-19T12:00:00.000Z",
      },
    ]);
    const onChange = vi.fn();

    const tracker = createPortUsageTracker({
      debounceMs: 0,
      hasActiveSessions: () => hasActiveSessions,
      listPortUsages,
      onChange,
      pollIntervalMs: 10_000,
    });

    await tracker.refreshNow();
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ port: 3000 })]);

    hasActiveSessions = false;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(tracker.getCurrent()).toEqual([]);
    expect(listPortUsages).toHaveBeenCalledTimes(1);

    tracker.dispose();
  });

  it("clears usage immediately when a refresh is requested with no active sessions", async () => {
    vi.useFakeTimers();

    let hasActiveSessions = true;
    const listPortUsages = vi.fn().mockResolvedValue([
      {
        address: "*",
        cwd: "/repo",
        id: "a",
        lastCommand: "pnpm dev",
        pid: 101,
        port: 3000,
        portlessRoutes: [],
        processName: "node",
        projectId: "project-a",
        protocol: "tcp",
        tabId: "tab-a",
        tabKind: "command",
        tabTitle: "API",
        terminalPid: 100,
        updatedAt: "2026-04-19T12:00:00.000Z",
      },
    ]);
    const onChange = vi.fn();

    const tracker = createPortUsageTracker({
      debounceMs: 200,
      hasActiveSessions: () => hasActiveSessions,
      listPortUsages,
      onChange,
      pollIntervalMs: 10_000,
    });

    await tracker.refreshNow();
    hasActiveSessions = false;
    tracker.requestRefresh();

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(tracker.getCurrent()).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(listPortUsages).toHaveBeenCalledTimes(1);

    tracker.dispose();
  });
});
