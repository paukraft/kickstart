import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TerminalSessionSnapshot } from "@kickstart/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node-pty", () => ({
  spawn: (...args: Parameters<typeof spawnMock>) => spawnMock(...args),
}));

import { TerminalManager } from "./terminal-manager";

function createTab(kind: "command" | "shell" = "command") {
  const timestamp = new Date().toISOString();
  return {
    commandId: kind === "command" ? "dev" : null,
    createdAt: timestamp,
    id: "tab-1",
    kind,
    projectId: "project-1",
    shellCwd: null,
    sortOrder: 0,
    title: "Tab 1",
    updatedAt: timestamp,
  };
}

function createSnapshot(overrides: Partial<TerminalSessionSnapshot> = {}) {
  return {
    activeProcessCount: 0,
    cols: 120,
    cwd: "/tmp/project",
    exitCode: null,
    hasActiveProcess: false,
    history: "",
    kind: "command" as const,
    lastCommand: "bid",
    managedRunActive: false,
    operation: "none" as const,
    outputRevision: 0,
    pid: 123,
    projectId: "project-1",
    rows: 36,
    status: "running" as const,
    tabId: "tab-1",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TerminalManager managed runs", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("waits for the shell prompt before writing the startup command", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const writeMock = vi.fn();

    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        for (const handler of onDataHandlers) {
          handler("paukraft@mac repo % ");
        }
      });

      return {
        kill: vi.fn(),
        onData: (handler: (data: string) => void) => {
          onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: writeMock,
      };
    });

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => ({
        command: "pnpm dev",
        cwd: ".",
        id: "shared:dev",
        name: "Dev",
        source: "shared",
        sourceCommandId: "dev",
        startMode: "manual",
        type: "service",
      }),
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open(
      {
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      },
      {
        startupCommand: "bid",
      },
    );

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(["-l"]);
    expect(writeMock).toHaveBeenCalledWith("bid\r");
  });

  it("uses the latest resolved command cwd when starting an existing command session", async () => {
    let commandCwd = "apps/web";
    const ptys: Array<{
      emitData: (data: string) => void;
      onDataHandlers: Array<(data: string) => void>;
      write: ReturnType<typeof vi.fn>;
    }> = [];

    spawnMock.mockImplementation(() => {
      const pty = {
        emitData(data: string) {
          for (const handler of pty.onDataHandlers) {
            handler(data);
          }
        },
        kill: vi.fn(),
        onDataHandlers: [] as Array<(data: string) => void>,
        onData(handler: (data: string) => void) {
          pty.onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123 + ptys.length,
        resize: vi.fn(),
        write: vi.fn(),
      };
      ptys.push(pty);
      queueMicrotask(() => {
        pty.emitData("paukraft@mac repo % ");
      });
      return pty;
    });

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => ({
        command: "pnpm dev",
        cwd: commandCwd,
        id: "shared:dev",
        name: "Dev",
        source: "shared",
        sourceCommandId: "dev",
        startMode: "manual",
        type: "service",
      }),
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      cwd: "/tmp/project/apps/web",
    });

    vi.spyOn(manager as any, "snapshot").mockResolvedValue(
      createSnapshot({
        cwd: "/tmp/project/apps/web",
        status: "idle",
      }),
    );

    commandCwd = "packages/core";
    await manager.runCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    for (let i = 0; i < 10 && !ptys[1]?.write.mock.calls.length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1]?.[2]).toMatchObject({
      cwd: "/tmp/project/packages/core",
    });
    expect(ptys[1]?.write).toHaveBeenCalledWith("pnpm dev\r");
    expect((manager as any).sessions.get("project-1:tab-1").cwd).toBe(
      "/tmp/project/packages/core",
    );
  });

  it("emits an updated snapshot when a stopped managed command returns to the prompt", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const writeMock = vi.fn();
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: (handler: (data: string) => void) => {
        onDataHandlers.push(handler);
      },
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: writeMock,
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    const activeSnapshot = createSnapshot({
      activeProcessCount: 1,
      hasActiveProcess: true,
      managedRunActive: true,
    });
    const idleSnapshot = createSnapshot();

    const snapshotSpy = vi.spyOn(manager as any, "snapshot");
    snapshotSpy.mockResolvedValueOnce(activeSnapshot);
    snapshotSpy.mockResolvedValueOnce(activeSnapshot);
    snapshotSpy.mockResolvedValueOnce(idleSnapshot);

    vi.spyOn(manager as any, "waitForShellIdle").mockReturnValue(new Promise(() => {}));

    const syncShellTabCwdSpy = vi.spyOn(manager as any, "syncShellTabCwd");
    syncShellTabCwdSpy.mockResolvedValue(false);

    await manager.stopCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(writeMock).toHaveBeenLastCalledWith("\u0003");

    for (const handler of onDataHandlers) {
      handler("paukraft@mac repo % ");
    }

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        snapshot: idleSnapshot,
        tabId: "tab-1",
        type: "updated",
      }),
    );
  });

  it("emits an updated snapshot after stop even if the prompt signal is missed", async () => {
    const writeMock = vi.fn();
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: writeMock,
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    const activeSnapshot = createSnapshot({
      activeProcessCount: 1,
      hasActiveProcess: true,
      managedRunActive: true,
    });
    const idleSnapshot = createSnapshot();

    vi.spyOn(manager as any, "snapshot").mockResolvedValue(activeSnapshot);
    vi.spyOn(manager as any, "waitForShellIdle").mockResolvedValue(idleSnapshot);

    await manager.stopCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(writeMock).toHaveBeenLastCalledWith("\u0003");

    await Promise.resolve();
    await Promise.resolve();

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        snapshot: idleSnapshot,
        tabId: "tab-1",
        type: "updated",
      }),
    );
  });

  it("does not let a stale background stop clear a newer start request", async () => {
    const writeMock = vi.fn();

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: writeMock,
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    const activeSnapshot = createSnapshot({
      activeProcessCount: 1,
      hasActiveProcess: true,
      managedRunActive: true,
    });

    vi.spyOn(manager as any, "snapshot").mockResolvedValue(activeSnapshot);
    const idleResolvers: Array<(snapshot: TerminalSessionSnapshot) => void> = [];
    vi.spyOn(manager as any, "waitForShellIdle").mockImplementation(
      () =>
        new Promise<TerminalSessionSnapshot>((resolve) => {
          idleResolvers.push(resolve);
        }),
    );
    const sendInterruptBurstSpy = vi.spyOn(manager as any, "sendInterruptBurst");

    await manager.stopCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    const session = (manager as any).sessions.get("project-1:tab-1");
    session.desiredRunState = "running";
    session.pendingStartRequest = true;
    session.operation = "starting";

    idleResolvers[0]?.(activeSnapshot);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendInterruptBurstSpy).not.toHaveBeenCalled();
    expect(session.operation).toBe("starting");
  });

  it("clears a pending start when stop cancels before a process is available", async () => {
    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    const session = (manager as any).sessions.get("project-1:tab-1");
    session.process = null;
    session.startRequested = true;

    await manager.stopCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    expect(session.startRequested).toBe(false);
  });

  it("clears a pending start when startDesiredCommand is cancelled while waiting for the prompt", async () => {
    const ptys: Array<{
      emitData: (data: string) => void;
      kill: ReturnType<typeof vi.fn>;
      onDataHandlers: Array<(data: string) => void>;
      write: ReturnType<typeof vi.fn>;
    }> = [];

    spawnMock.mockImplementation(() => {
      const pty = {
        emitData(data: string) {
          for (const handler of pty.onDataHandlers) {
            handler(data);
          }
        },
        kill: vi.fn(),
        onDataHandlers: [] as Array<(data: string) => void>,
        onData(handler: (data: string) => void) {
          pty.onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123 + ptys.length,
        resize: vi.fn(),
        write: vi.fn(),
      };
      ptys.push(pty);
      return pty;
    });

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    const session = (manager as any).sessions.get("project-1:tab-1");
    session.desiredRunState = "running";
    const startPromise = (manager as any).startDesiredCommand(session, {
      command: "pnpm dev",
      cwd: ".",
      id: "shared:dev",
      name: "Dev",
      source: "shared",
      sourceCommandId: "dev",
      startMode: "manual",
      type: "service",
    }, "/tmp/project");

    await Promise.resolve();
    expect(session.startRequested).toBe(true);

    session.desiredRunState = "idle";
    ptys.at(-1)?.emitData("paukraft@mac repo % ");
    await startPromise;

    expect(session.startRequested).toBe(false);
    expect(ptys.at(-1)?.write).not.toHaveBeenCalledWith("pnpm dev\r");
  });

  it("preserves transcript when starting managed commands", async () => {
    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-terminal-manager-managed-"));
    const ptys: Array<{
      kill: ReturnType<typeof vi.fn>;
      onDataHandlers: Array<(data: string) => void>;
      write: ReturnType<typeof vi.fn>;
    }> = [];
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => {
      const pty = {
        kill: vi.fn(),
        onDataHandlers: [] as Array<(data: string) => void>,
        onData(handler: (data: string) => void) {
          pty.onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123 + ptys.length,
        resize: vi.fn(),
        write: vi.fn(),
      };
      ptys.push(pty);
      if (ptys.length === 2) {
        queueMicrotask(() => {
          for (const handler of pty.onDataHandlers) {
            handler("paukraft@mac repo % ");
          }
        });
      }
      return pty;
    });

    const manager = new TerminalManager({
      historyDir,
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    for (const handler of ptys[0]?.onDataHandlers ?? []) {
      handler("\x1b[?1049h\x1b[?1003hold fullscreen tui frame");
      handler("paukraft@mac repo % ");
    }

    const snapshot = await manager.open(
      {
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      },
      {
        startupCommand: "pnpm dev",
      },
    );

    expect(ptys[0]?.kill).toHaveBeenCalled();
    expect(ptys[1]?.write).toHaveBeenCalledWith("pnpm dev\r");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.history).toContain("old fullscreen tui frame");
    fs.rmSync(historyDir, { force: true, recursive: true });
  });

  it("restarts a running managed command by stopping first and then running again", async () => {
    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    vi.spyOn(manager as any, "snapshot").mockResolvedValue(
      createSnapshot({
        activeProcessCount: 1,
        hasActiveProcess: true,
        managedRunActive: true,
      }),
    );
    vi.spyOn(manager as any, "waitForShellIdle").mockResolvedValue(
      createSnapshot({
        status: "idle",
      }),
    );

    const requestStopSpy = vi.spyOn(manager as any, "requestStop").mockResolvedValue(
      createSnapshot({
        status: "idle",
      }),
    );
    const runCommandSpy = vi.spyOn(manager, "runCommand").mockResolvedValue(null);

    await manager.restartCommand({
      projectId: "project-1",
      tabId: "tab-1",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(requestStopSpy).toHaveBeenCalledOnce();
    expect(runCommandSpy).toHaveBeenCalledWith({
      projectId: "project-1",
      tabId: "tab-1",
    });
    expect(requestStopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      runCommandSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("emits an updated snapshot when shell startup settles at the prompt", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: (handler: (data: string) => void) => {
        onDataHandlers.push(handler);
      },
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    const activeSnapshot = createSnapshot({
      activeProcessCount: 1,
      hasActiveProcess: true,
    });
    const idleSnapshot = createSnapshot();

    const snapshotSpy = vi.spyOn(manager as any, "snapshot");
    snapshotSpy.mockResolvedValueOnce(activeSnapshot);
    snapshotSpy.mockResolvedValueOnce(activeSnapshot);
    snapshotSpy.mockResolvedValueOnce(idleSnapshot);

    const syncShellTabCwdSpy = vi.spyOn(manager as any, "syncShellTabCwd");
    syncShellTabCwdSpy.mockResolvedValue(false);

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    for (const handler of onDataHandlers) {
      handler("paukraft@mac repo % ");
    }

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        snapshot: idleSnapshot,
        tabId: "tab-1",
        type: "updated",
      }),
    );
  });

  it("revives a stopped shell tab on the next keypress", async () => {
    const ptys: Array<{
      onDataHandlers: Array<(data: string) => void>;
      onExitHandler: ((event: { exitCode: number }) => void) | null;
      write: ReturnType<typeof vi.fn>;
    }> = [];
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => {
      const state = {
        onDataHandlers: [] as Array<(data: string) => void>,
        onExitHandler: null as ((event: { exitCode: number }) => void) | null,
        write: vi.fn(),
      };
      ptys.push(state);
      return {
        kill: vi.fn(),
        onData: (handler: (data: string) => void) => {
          state.onDataHandlers.push(handler);
        },
        onExit: (handler: (event: { exitCode: number }) => void) => {
          state.onExitHandler = handler;
        },
        pid: 123 + ptys.length,
        resize: vi.fn(),
        write: state.write,
      };
    });

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab("shell"),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    expect(ptys).toHaveLength(1);
    ptys[0]?.onExitHandler?.({ exitCode: 0 });

    const writePromise = manager.write({
      data: "l",
      projectId: "project-1",
      tabId: "tab-1",
    });

    expect(ptys).toHaveLength(2);
    for (const handler of ptys[1]?.onDataHandlers ?? []) {
      handler("paukraft@mac repo % ");
    }
    await writePromise;

    expect(ptys[1]?.write).toHaveBeenCalledWith("l");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        tabId: "tab-1",
        type: "stopped",
      }),
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        tabId: "tab-1",
        type: "started",
      }),
    );
  });

  it("counts running project commands from active process snapshots", async () => {
    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    vi.spyOn(manager, "getProjectSessions").mockResolvedValue([
      createSnapshot({
        hasActiveProcess: true,
        managedRunActive: false,
        tabId: "command:web",
      }),
      createSnapshot({
        hasActiveProcess: false,
        managedRunActive: true,
        tabId: "command:worker",
      }),
      createSnapshot({
        hasActiveProcess: true,
        tabId: "shell:notes",
      }),
    ]);

    await expect(
      manager.getProjectRunningCommandCount("project-1", [
        "command:web",
        "command:worker",
      ]),
    ).resolves.toBe(1);
  });

  it("reconciles manual command activity from submit through prompt return", async () => {
    vi.useFakeTimers();
    try {
      const onDataHandlers: Array<(data: string) => void> = [];
      const writeMock = vi.fn();
      const onEvent = vi.fn();

      spawnMock.mockImplementation(() => ({
        kill: vi.fn(),
        onData: (handler: (data: string) => void) => {
          onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: writeMock,
      }));

      const manager = new TerminalManager({
        historyDir: "/tmp/kickstart-terminal-manager-test",
        loadCommand: async () => null,
        loadProject: async () => ({
          createdAt: "",
          id: "project-1",
          name: "Project",
          path: "/tmp/project",
          sortOrder: 0,
          updatedAt: "",
        }),
        loadTab: async () => createTab(),
        onEvent,
        persistTabCwd: vi.fn(),
      });

      const idleSnapshot = createSnapshot({ lastCommand: null });
      const submittedSnapshot = createSnapshot({ lastCommand: "ls" });
      const runningSnapshot = createSnapshot({
        activeProcessCount: 1,
        hasActiveProcess: true,
        lastCommand: "ls",
      });
      const settledSnapshot = createSnapshot({ lastCommand: "ls" });

      const snapshotSpy = vi.spyOn(manager as any, "snapshot");
      snapshotSpy.mockResolvedValueOnce(idleSnapshot);
      snapshotSpy.mockResolvedValueOnce(idleSnapshot);
      snapshotSpy.mockResolvedValueOnce(submittedSnapshot);
      snapshotSpy.mockResolvedValueOnce(runningSnapshot);
      snapshotSpy.mockResolvedValueOnce(settledSnapshot);

      const syncShellTabCwdSpy = vi.spyOn(manager as any, "syncShellTabCwd");
      syncShellTabCwdSpy.mockResolvedValue(false);

      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      });

      await manager.write({
        data: "ls\r",
        projectId: "project-1",
        tabId: "tab-1",
      });

      expect(writeMock).toHaveBeenLastCalledWith("ls\r");

      vi.advanceTimersByTime(80);
      await Promise.resolve();

      for (const handler of onDataHandlers) {
        handler("paukraft@mac repo % ");
      }

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          snapshot: runningSnapshot,
          tabId: "tab-1",
          type: "updated",
        }),
      );
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          snapshot: settledSnapshot,
          tabId: "tab-1",
          type: "updated",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses split OSC shell-integration markers across PTY chunks", async () => {
    vi.useFakeTimers();
    try {
      const onDataHandlers: Array<(data: string) => void> = [];
      const onEvent = vi.fn();

      spawnMock.mockImplementation(() => ({
        kill: vi.fn(),
        onData: (handler: (data: string) => void) => {
          onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: vi.fn(),
      }));

      const manager = new TerminalManager({
        historyDir: "/tmp/kickstart-terminal-manager-test",
        loadCommand: async () => null,
        loadProject: async () => ({
          createdAt: "",
          id: "project-1",
          name: "Project",
          path: "/tmp/project",
          sortOrder: 0,
          updatedAt: "",
        }),
        loadTab: async () => createTab(),
        onEvent,
        persistTabCwd: vi.fn(),
      });

      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      });

      const snapshotSpy = vi.spyOn(manager as any, "snapshot");
      snapshotSpy.mockResolvedValueOnce(
        createSnapshot({
          activeProcessCount: 1,
          hasActiveProcess: true,
          lastCommand: "ls",
        }),
      );
      snapshotSpy.mockResolvedValueOnce(
        createSnapshot({
          hasActiveProcess: false,
          lastCommand: "ls",
        }),
      );

      for (const handler of onDataHandlers) {
        handler("\u001b");
        handler("]133;C\u0007");
      }

      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      for (const handler of onDataHandlers) {
        handler("\u001b");
        handler("]133;D;0\u0007");
      }

      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            hasActiveProcess: true,
          }),
          tabId: "tab-1",
          type: "updated",
        }),
      );
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            hasActiveProcess: false,
          }),
          tabId: "tab-1",
          type: "updated",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark a fresh shell as running just because startup is still settling", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const onEvent = vi.fn();

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: (handler: (data: string) => void) => {
        onDataHandlers.push(handler);
      },
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent,
      persistTabCwd: vi.fn(),
    });

    const snapshotSpy = vi.spyOn(manager as any, "snapshot");
    snapshotSpy.mockRestore();

    vi.spyOn(manager as any, "listProcessTable").mockResolvedValue([
      {
        comm: "/bin/zsh",
        pid: 456,
        ppid: 123,
        stat: "S+",
      },
      {
        comm: "/usr/bin/login",
        pid: 457,
        ppid: 123,
        stat: "S+",
      },
    ]);

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          hasActiveProcess: false,
          status: "booting",
        }),
        tabId: "tab-1",
        type: "started",
      }),
    );
  });

  it("keeps a freshly opened shell booting until the prompt arrives", async () => {
    vi.useFakeTimers();

    try {
      const onDataHandlers: Array<(data: string) => void> = [];
      const onEvent = vi.fn();

      spawnMock.mockImplementation(() => ({
        kill: vi.fn(),
        onData: (handler: (data: string) => void) => {
          onDataHandlers.push(handler);
        },
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: vi.fn(),
      }));

      const manager = new TerminalManager({
        historyDir: "/tmp/kickstart-terminal-manager-test",
        loadCommand: async () => null,
        loadProject: async () => ({
          createdAt: "",
          id: "project-1",
          name: "Project",
          path: "/tmp/project",
          sortOrder: 0,
          updatedAt: "",
        }),
        loadTab: async () => createTab(),
        onEvent,
        persistTabCwd: vi.fn(),
      });

      vi.spyOn(manager as any, "listProcessTable").mockResolvedValue([
        {
          comm: "/bin/zsh",
          pid: 456,
          ppid: 123,
          stat: "S+",
        },
        {
          comm: "/usr/bin/login",
          pid: 457,
          ppid: 123,
          stat: "S+",
        },
        {
          comm: "/opt/homebrew/bin/starship",
          pid: 458,
          ppid: 123,
          stat: "S+",
        },
      ]);

      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      });

      for (const handler of onDataHandlers) {
        handler("loading shell startup files...");
      }

      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();

      expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
        hasActiveProcess: false,
        status: "booting",
      });

      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();

      expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
        hasActiveProcess: false,
        status: "booting",
      });

      for (const handler of onDataHandlers) {
        handler("paukraft@mac repo % ");
      }

      await Promise.resolve();
      await Promise.resolve();

      expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
        activeProcessCount: 2,
        hasActiveProcess: true,
        status: "running",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back out of booting when prompt detection times out", async () => {
    vi.useFakeTimers();

    try {
      spawnMock.mockImplementation(() => ({
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: vi.fn(),
      }));

      const manager = new TerminalManager({
        historyDir: "/tmp/kickstart-terminal-manager-test",
        loadCommand: async () => null,
        loadProject: async () => ({
          createdAt: "",
          id: "project-1",
          name: "Project",
          path: "/tmp/project",
          sortOrder: 0,
          updatedAt: "",
        }),
        loadTab: async () => createTab(),
        onEvent: vi.fn(),
        persistTabCwd: vi.fn(),
      });

      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      });

      expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
        hasActiveProcess: false,
        status: "booting",
      });

      await vi.advanceTimersByTimeAsync(8_000);

      expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
        activeProcessCount: 0,
        hasActiveProcess: false,
        status: "idle",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts background descendant processes again once the prompt is ready", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];

    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: (handler: (data: string) => void) => {
        onDataHandlers.push(handler);
      },
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const manager = new TerminalManager({
      historyDir: "/tmp/kickstart-terminal-manager-test",
      loadCommand: async () => null,
      loadProject: async () => ({
        createdAt: "",
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        sortOrder: 0,
        updatedAt: "",
      }),
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    vi.spyOn(manager as any, "listProcessTable").mockResolvedValue([
      {
        comm: "/bin/zsh",
        pid: 456,
        ppid: 123,
        stat: "S+",
      },
      {
        comm: "/opt/homebrew/bin/starship",
        pid: 457,
        ppid: 123,
        stat: "S+",
      },
    ]);

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    for (const handler of onDataHandlers) {
      handler("paukraft@mac repo % ");
    }

    await Promise.resolve();
    await Promise.resolve();

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      activeProcessCount: 1,
      hasActiveProcess: true,
      status: "running",
    });
  });
});
