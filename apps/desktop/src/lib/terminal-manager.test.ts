import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node-pty", () => ({
  spawn: (...args: Parameters<typeof spawnMock>) => spawnMock(...args),
}));

import { resolveShellTabCwd } from "./terminal-manager";
import { TerminalManager } from "./terminal-manager";

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const target of cleanupPaths) {
    fs.rmSync(target, { force: true, recursive: true });
  }
  cleanupPaths.clear();
});

function createHistoryDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-terminal-manager-"));
  cleanupPaths.add(dir);
  return dir;
}

function createTab(kind: "command" | "shell" = "shell") {
  const timestamp = new Date().toISOString();
  return {
    commandId: null,
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

describe("resolveShellTabCwd", () => {
  it("keeps restoring legacy relative shell paths inside the project", () => {
    expect(resolveShellTabCwd("/tmp/demo", ".")).toBe("/tmp/demo");
    expect(resolveShellTabCwd("/tmp/demo", "apps/web")).toBe("/tmp/demo/apps/web");
  });

  it("restores absolute shell paths outside the project root", () => {
    expect(resolveShellTabCwd("/tmp/demo", "/tmp")).toBe("/tmp");
  });
});

describe("TerminalManager.open", () => {
  it("refreshes the in-memory tab kind when a preserved command tab becomes a shell", async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    let currentKind: "command" | "shell" = "command";
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
      loadTab: async () => ({
        commandId: "dev",
        createdAt: "",
        id: "command:dev",
        kind: currentKind,
        projectId: "project-1",
        shellCwd: ".",
        sortOrder: 0,
        title: "Dev",
        updatedAt: "",
      }),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "command:dev",
    });

    currentKind = "shell";

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "command:dev",
    });

    const snapshot = await manager.getSession("project-1", "command:dev");
    expect(snapshot).toMatchObject({ kind: "shell" });
  });

  it("tries a graceful interrupt before closing a running shell", async () => {
    const killMock = vi.fn();
    const writeMock = vi.fn();
    const onEvent = vi.fn();

    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      kill: killMock,
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

    vi.spyOn(manager as any, "snapshot").mockResolvedValue({
      activeProcessCount: 1,
      cols: 120,
      cwd: "/tmp/project",
      exitCode: null,
      hasActiveProcess: true,
      history: "",
      kind: "shell",
      lastCommand: "pnpm dev",
      managedRunActive: false,
      pid: 123,
      projectId: "project-1",
      rows: 36,
      status: "running",
      tabId: "tab-1",
      updatedAt: new Date().toISOString(),
    });
    const waitForShellIdleSpy = vi
      .spyOn(manager as any, "waitForShellIdle")
      .mockResolvedValue({
        activeProcessCount: 0,
        cols: 120,
        cwd: "/tmp/project",
        exitCode: null,
        hasActiveProcess: false,
        history: "",
        kind: "shell",
        lastCommand: "pnpm dev",
        managedRunActive: false,
        pid: 123,
        projectId: "project-1",
        rows: 36,
        status: "idle",
        tabId: "tab-1",
        updatedAt: new Date().toISOString(),
      });
    vi.spyOn(manager as any, "syncShellTabCwd").mockResolvedValue(undefined);

    await manager.close({
      projectId: "project-1",
      tabId: "tab-1",
    });

    expect(writeMock).toHaveBeenCalledWith("\u0003");
    expect(waitForShellIdleSpy).toHaveBeenCalledOnce();
    expect(killMock).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        tabId: "tab-1",
        type: "updated",
      }),
    );
  });

  it("does not emit a normal stopped event when the shell exits during close", async () => {
    const killMock = vi.fn();
    const writeMock = vi.fn();
    const onEvent = vi.fn();
    let onExitHandler: ((event: { exitCode: number }) => void) | null = null;

    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      kill: killMock,
      onData: vi.fn(),
      onExit: (handler: (event: { exitCode: number }) => void) => {
        onExitHandler = handler;
      },
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

    const originalSnapshot = (manager as any).snapshot.bind(manager);
    vi.spyOn(manager as any, "snapshot").mockImplementationOnce(async () => ({
      activeProcessCount: 1,
      cols: 120,
      cwd: "/tmp/project",
      exitCode: null,
      hasActiveProcess: true,
      history: "",
      kind: "shell",
      lastCommand: "pnpm dev",
      managedRunActive: false,
      pid: 123,
      projectId: "project-1",
      rows: 36,
      status: "running",
      tabId: "tab-1",
      updatedAt: new Date().toISOString(),
    }));
    vi.spyOn(manager as any, "waitForShellIdle").mockImplementation(async (session: unknown) => {
      onExitHandler?.({ exitCode: 0 });
      return originalSnapshot(session);
    });
    vi.spyOn(manager as any, "syncShellTabCwd").mockResolvedValue(undefined);

    await manager.close({
      projectId: "project-1",
      tabId: "tab-1",
    });

    expect(writeMock).toHaveBeenCalledWith("\u0003");
    expect(killMock).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        tabId: "tab-1",
        type: "stopped",
      }),
    );
  });

  it("escalates close from interrupt retries to descendant SIGTERM when needed", async () => {
    const killMock = vi.fn();
    const writeMock = vi.fn();
    const signalKillMock = vi.spyOn(process, "kill").mockImplementation(() => true);

    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      kill: killMock,
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

    const activeSnapshot = {
      activeProcessCount: 1,
      cols: 120,
      cwd: "/tmp/project",
      exitCode: null,
      hasActiveProcess: true,
      history: "",
      kind: "shell" as const,
      lastCommand: "pnpm dev",
      managedRunActive: false,
      pid: 123,
      projectId: "project-1",
      rows: 36,
      status: "running" as const,
      tabId: "tab-1",
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(manager as any, "snapshot").mockResolvedValueOnce(activeSnapshot);
    vi.spyOn(manager as any, "waitForShellIdle")
      .mockResolvedValueOnce(activeSnapshot)
      .mockResolvedValueOnce(activeSnapshot)
      .mockResolvedValueOnce(activeSnapshot);
    vi.spyOn(manager as any, "listProcessTable").mockResolvedValue([
      { comm: "node", pid: 200, ppid: 123, stat: "S" },
      { comm: "node", pid: 201, ppid: 200, stat: "S" },
    ]);
    vi.spyOn(manager as any, "syncShellTabCwd").mockResolvedValue(undefined);

    await manager.close({
      projectId: "project-1",
      tabId: "tab-1",
    });

    expect(writeMock).toHaveBeenNthCalledWith(1, "\u0003");
    expect(writeMock).toHaveBeenNthCalledWith(2, "\u0003");
    expect(writeMock).toHaveBeenNthCalledWith(3, "\u0003");
    expect(writeMock).toHaveBeenNthCalledWith(4, "\u0003");
    expect(signalKillMock).toHaveBeenCalledWith(200, "SIGTERM");
    expect(signalKillMock).toHaveBeenCalledWith(201, "SIGTERM");
    expect(killMock).toHaveBeenCalledOnce();

    signalKillMock.mockRestore();
  });

  it("moves a live session to a new command tab id", async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      pid: 123,
      resize: vi.fn(),
      write: vi.fn(),
    }));

    const historyDir = createHistoryDir();
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
      loadTab: async (_projectId, tabId) => ({
        commandId: tabId.replace("command:", ""),
        createdAt: "",
        id: tabId,
        kind: "command",
        projectId: "project-1",
        shellCwd: ".",
        sortOrder: 0,
        title: "Dev",
        updatedAt: "",
      }),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "command:shared:dev",
    });

    await manager.moveSessionTab("project-1", "command:shared:dev", "command:local:dev");

    expect(await manager.getSession("project-1", "command:shared:dev")).toBeNull();
    expect(await manager.getSession("project-1", "command:local:dev")).toMatchObject({
      projectId: "project-1",
      tabId: "command:local:dev",
    });
  });

  it("moves persisted history even when no session is loaded", async () => {
    const historyDir = createHistoryDir();
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
      loadTab: async (_projectId, tabId) => ({
        commandId: tabId.replace("command:", ""),
        createdAt: "",
        id: tabId,
        kind: "command",
        projectId: "project-1",
        shellCwd: ".",
        sortOrder: 0,
        title: "Dev",
        updatedAt: "",
      }),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const previousHistoryPath = path.join(historyDir, "project-1_command:shared:dev.log");
    const nextHistoryPath = path.join(historyDir, "project-1_command:local:dev.log");
    fs.writeFileSync(previousHistoryPath, "echo hello\n", "utf8");

    await manager.moveSessionTab("project-1", "command:shared:dev", "command:local:dev");

    expect(fs.existsSync(previousHistoryPath)).toBe(false);
    expect(fs.readFileSync(nextHistoryPath, "utf8")).toBe("echo hello\n");
    expect(await manager.getSession("project-1", "command:local:dev")).toBeNull();
  });

  it("migrates command history from legacy tab ids in bulk", async () => {
    const historyDir = createHistoryDir();
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
      loadTab: async (_projectId, tabId) => ({
        commandId: tabId.replace("command:", ""),
        createdAt: "",
        id: tabId,
        kind: "command",
        projectId: "project-1",
        shellCwd: ".",
        sortOrder: 0,
        title: "Dev",
        updatedAt: "",
      }),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const previousHistoryPath = path.join(historyDir, "project-1_command:dev.log");
    const nextHistoryPath = path.join(historyDir, "project-1_command:shared:dev.log");
    fs.writeFileSync(previousHistoryPath, "echo legacy\n", "utf8");

    await manager.migrateCommandHistoryTabIds([
      {
        nextTabId: "command:shared:dev",
        previousTabId: "command:dev",
        projectId: "project-1",
      },
    ]);

    expect(fs.existsSync(previousHistoryPath)).toBe(false);
    expect(fs.readFileSync(nextHistoryPath, "utf8")).toBe("echo legacy\n");
  });
});
