import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import type { TerminalSessionSnapshot } from "@kickstart/contracts";
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

function createManager() {
  return new TerminalManager({
    historyDir: createHistoryDir(),
    loadCommand: async () => null,
    loadProject: async () => null,
    loadTab: async () => null,
    onEvent: vi.fn(),
    persistTabCwd: vi.fn(),
  });
}

function createSnapshot(
  overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
  return {
    activeProcessCount: 0,
    cols: 120,
    cwd: "/tmp/project",
    exitCode: null,
    hasActiveProcess: false,
    history: "",
    kind: "command",
    lastCommand: null,
    managedRunActive: false,
    operation: "none",
    outputRevision: 0,
    pid: 123,
    projectId: "project-1",
    rows: 36,
    status: "idle",
    tabId: "tab-1",
    updatedAt: new Date(0).toISOString(),
    ...overrides,
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

describe("TerminalManager project operations", () => {
  it("clears project startup when the tracked command exits without staying active", async () => {
    const manager = createManager();
    (manager as any).projectOperations.set("project-1", {
      desiredRunState: "running",
      operation: "starting",
      tabIds: new Set(["tab-1"]),
    });

    await expect(
      manager.getProjectOperation("project-1", ["tab-1"], [
        createSnapshot({
          hasActiveProcess: false,
          operation: "none",
          status: "idle",
        }),
      ]),
    ).resolves.toBe("none");
  });

  it("clears project startup after completed commands even when only some stay active", async () => {
    const manager = createManager();
    (manager as any).projectOperations.set("project-1", {
      desiredRunState: "running",
      operation: "starting",
      tabIds: new Set(["tab-1", "tab-2"]),
    });

    await expect(
      manager.getProjectOperation("project-1", ["tab-1", "tab-2"], [
        createSnapshot({ hasActiveProcess: true, tabId: "tab-1" }),
        createSnapshot({ hasActiveProcess: false, tabId: "tab-2" }),
      ]),
    ).resolves.toBe("none");
  });

  it("keeps project startup while a tracked command is still transitioning", async () => {
    const manager = createManager();
    (manager as any).projectOperations.set("project-1", {
      desiredRunState: "running",
      operation: "starting",
      tabIds: new Set(["tab-1"]),
    });

    await expect(
      manager.getProjectOperation("project-1", ["tab-1"], [
        createSnapshot({
          hasActiveProcess: false,
          operation: "starting",
          status: "idle",
        }),
      ]),
    ).resolves.toBe("starting");
  });
});

describe("TerminalManager history paths", () => {
  it("sanitizes tab ids for filesystem-safe history filenames", () => {
    const historyDir = createHistoryDir();
    const manager = new TerminalManager({
      historyDir,
      loadCommand: async () => null,
      loadProject: async () => null,
      loadTab: async () => null,
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    expect((manager as any).historyPath("project-1", "command:shared:dev")).toBe(
      path.join(historyDir, "project-1_command_shared_dev.log"),
    );
    expect((manager as any).shellHistoryPath("project-1", "command:shared:dev")).toBe(
      path.join(historyDir, "..", "shell-history", "project-1_command_shared_dev.history"),
    );
  });

  it("generates shell integration scripts with valid syntax", () => {
    const historyDir = createHistoryDir();
    const manager = new TerminalManager({
      historyDir,
      loadCommand: async () => null,
      loadProject: async () => null,
      loadTab: async () => null,
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const zshPath = path.join(
      (manager as any).zshIntegrationDir,
      "kickstart.zsh",
    );
    if (fs.existsSync("/bin/zsh")) {
      execFileSync("/bin/zsh", ["-n", zshPath]);
    }

    const bashPath = (manager as any).bashIntegrationPath;
    if (bashPath && fs.existsSync("/bin/bash")) {
      execFileSync("/bin/bash", ["-n", bashPath]);
    }
  });

  it("does not report the bash prompt hook as the last command", () => {
    if (!fs.existsSync("/bin/bash")) {
      return;
    }

    const historyDir = createHistoryDir();
    const homeDir = createHistoryDir();
    const manager = new TerminalManager({
      historyDir,
      loadCommand: async () => null,
      loadProject: async () => null,
      loadTab: async () => null,
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const output = execFileSync(
      "/bin/bash",
      ["--noprofile", "--rcfile", (manager as any).bashIntegrationPath, "-i"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          BASH_SILENCE_DEPRECATION_WARNING: "1",
          KICKSTART_HISTFILE: path.join(homeDir, ".bash_history"),
          TERM: "xterm-256color",
        },
        input: "true\nexit\n",
        stdio: ["pipe", "pipe", "ignore"],
      },
    );

    expect(output).toContain("\u001B]633;E;true\u0007");
    expect(output).not.toContain("\u001B]633;E;_kickstart_prompt_command\u0007");
  });

  it("does not report user bash prompt commands as the last command", () => {
    if (!fs.existsSync("/bin/bash")) {
      return;
    }

    const historyDir = createHistoryDir();
    const homeDir = createHistoryDir();
    fs.writeFileSync(
      path.join(homeDir, ".bashrc"),
      "PROMPT_COMMAND='printf prompt-hook'\n",
      "utf8",
    );
    const manager = new TerminalManager({
      historyDir,
      loadCommand: async () => null,
      loadProject: async () => null,
      loadTab: async () => null,
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const output = execFileSync(
      "/bin/bash",
      ["--noprofile", "--rcfile", (manager as any).bashIntegrationPath, "-i"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          BASH_SILENCE_DEPRECATION_WARNING: "1",
          KICKSTART_HISTFILE: path.join(homeDir, ".bash_history"),
          TERM: "xterm-256color",
        },
        input: "true\nexit\n",
        stdio: ["pipe", "pipe", "ignore"],
      },
    );

    expect(output).toContain("\u001B]633;E;true\u0007");
    expect(output).toContain("prompt-hook");
    expect(output).not.toContain("\u001B]633;E;printf prompt-hook\u0007");
    expect(output).not.toContain("\u001B]633;E;_kickstart_run_user_prompt_command\u0007");
  });
});

describe("TerminalManager.open", () => {
  it("restores persisted history verbatim", async () => {
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
    fs.writeFileSync(
      path.join(historyDir, "project-1_tab-1.log"),
      "pnpm test\r\npaukraft@MacBook-Pro-von-Pau repo % ",
      "utf8",
    );

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
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const snapshot = await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    expect(snapshot).toMatchObject({
      history: "pnpm test\r\npaukraft@MacBook-Pro-von-Pau repo % ",
    });
  });

  it("appends boot output after restored history instead of suppressing it", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const onEvent = vi.fn();
    spawnMock.mockReset();
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

    const historyDir = createHistoryDir();
    fs.writeFileSync(
      path.join(historyDir, "project-1_tab-1.log"),
      "pnpm test\r\npaukraft@MacBook-Pro-von-Pau repo % ",
      "utf8",
    );

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

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history: "pnpm test\r\npaukraft@MacBook-Pro-von-Pau repo % ",
    });

    onDataHandlers[0]?.("\r\npaukraft@MacBook-Pro-von-Pau repo % ");

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history:
        "pnpm test\r\npaukraft@MacBook-Pro-von-Pau repo % \r\npaukraft@MacBook-Pro-von-Pau repo % ",
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: "\r\npaukraft@MacBook-Pro-von-Pau repo % ",
        projectId: "project-1",
        tabId: "tab-1",
        type: "output",
      }),
    );
  });

  it("uses a dedicated shell history file for each tab", async () => {
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";

    try {
      spawnMock.mockReset();
      spawnMock.mockImplementation(() => ({
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        pid: 123 + spawnMock.mock.calls.length,
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
          ...createTab(),
          id: tabId,
          title: tabId,
        }),
        onEvent: vi.fn(),
        persistTabCwd: vi.fn(),
      });

      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-1",
      });
      await manager.open({
        cols: 120,
        projectId: "project-1",
        rows: 36,
        tabId: "tab-2",
      });

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[0]?.[2]?.env.HISTFILE).toBe(
        (manager as any).shellHistoryPath("project-1", "tab-1"),
      );
      expect(spawnMock.mock.calls[1]?.[2]?.env.HISTFILE).toBe(
        (manager as any).shellHistoryPath("project-1", "tab-2"),
      );
      expect(spawnMock.mock.calls[0]?.[2]?.env.HISTFILE).not.toBe(
        spawnMock.mock.calls[1]?.[2]?.env.HISTFILE,
      );
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it("persists shell-integration cwd updates for shell tabs", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    const persistTabCwd = vi.fn();
    spawnMock.mockReset();
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
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd,
    });

    await manager.open({
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    });

    onDataHandlers[0]?.("\x1b]633;P;Cwd=/tmp/project/apps/web\x07");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(persistTabCwd).toHaveBeenCalledWith("project-1", "tab-1", "/tmp/project/apps/web");
    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      cwd: "/tmp/project/apps/web",
    });
  });

  it("does not reset a live shell cwd when the tab is opened again", async () => {
    const onDataHandlers: Array<(data: string) => void> = [];
    spawnMock.mockReset();
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
      loadTab: async () => createTab(),
      onEvent: vi.fn(),
      persistTabCwd: vi.fn(),
    });

    const openInput = {
      cols: 120,
      projectId: "project-1",
      rows: 36,
      tabId: "tab-1",
    };

    await manager.open(openInput);
    onDataHandlers[0]?.("\x1b]633;P;Cwd=/tmp/project/packages/core\x07");

    await manager.open(openInput);

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      cwd: "/tmp/project/packages/core",
    });
  });

  it("launches bash through the Kickstart rcfile so history is flushed during the session", async () => {
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/bash";

    try {
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

      expect(spawnMock.mock.calls[0]?.[0]).toBe("/bin/bash");
      expect(spawnMock.mock.calls[0]?.[1]).toEqual([
        "--rcfile",
        path.join(historyDir, "..", "shell-integration", "bash", "kickstart.bash"),
        "-i",
      ]);
      expect(spawnMock.mock.calls[0]?.[2]?.env.KICKSTART_HISTFILE).toBe(
        (manager as any).shellHistoryPath("project-1", "tab-1"),
      );
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it("does not let a blank renderer snapshot erase persisted PTY history", async () => {
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
    (manager as any).sessions.get("project-1:tab-1").history = "ls\r\npackage.json\r\n% ";

    manager.applySerializedSnapshot({
      outputRevision: 0,
      projectId: "project-1",
      snapshot: "",
      tabId: "tab-1",
    });

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history: "ls\r\npackage.json\r\n% ",
    });
  });

  it("does not let a partial replay snapshot truncate persisted PTY history", async () => {
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
    (manager as any).sessions.get("project-1:tab-1").history =
      "echo first\r\nfirst\r\necho second\r\nsecond\r\n% ";

    manager.applySerializedSnapshot({
      outputRevision: 0,
      projectId: "project-1",
      snapshot: "echo first\r\nfirst\r\n",
      tabId: "tab-1",
    });

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history: "echo first\r\nfirst\r\necho second\r\nsecond\r\n% ",
    });
  });

  it("allows a shorter renderer snapshot when it contains the latest command", async () => {
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
    session.history = `${"old line\r\n".repeat(100)}printf marker\r\nmarker\r\n% `;
    session.lastCommand = "printf marker";

    manager.applySerializedSnapshot({
      outputRevision: 0,
      projectId: "project-1",
      snapshot: "printf marker\r\nmarker\r\n% ",
      tabId: "tab-1",
    });

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history: "printf marker\r\nmarker\r\n% ",
    });
  });

  it("rejects a renderer snapshot based on stale PTY output", async () => {
    const ptys: Array<{
      emitData: (data: string) => void;
      kill: ReturnType<typeof vi.fn>;
      onDataHandlers: Array<(data: string) => void>;
      onExit: ReturnType<typeof vi.fn>;
      pid: number;
      resize: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
    }> = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const state = {
        emitData(data: string) {
          for (const handler of state.onDataHandlers) {
            handler(data);
          }
        },
        kill: vi.fn(),
        onData(handler: (data: string) => void) {
          state.onDataHandlers.push(handler);
        },
        onDataHandlers: [] as Array<(data: string) => void>,
        onExit: vi.fn(),
        pid: 123,
        resize: vi.fn(),
        write: vi.fn(),
      };
      ptys.push(state);
      return state;
    });

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
    ptys[0]?.emitData("printf marker\r\n");
    ptys[0]?.emitData("marker\r\n% ");

    manager.applySerializedSnapshot({
      outputRevision: 1,
      projectId: "project-1",
      snapshot: "printf marker\r\n",
      tabId: "tab-1",
    });

    expect(await manager.getSession("project-1", "tab-1")).toMatchObject({
      history: "printf marker\r\nmarker\r\n% ",
      outputRevision: 2,
    });
  });

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

    const previousHistoryPath = path.join(historyDir, "project-1_command_shared_dev.log");
    const nextHistoryPath = path.join(historyDir, "project-1_command_local_dev.log");
    fs.writeFileSync(previousHistoryPath, "echo hello\n", "utf8");

    await manager.moveSessionTab("project-1", "command:shared:dev", "command:local:dev");

    expect(fs.existsSync(previousHistoryPath)).toBe(false);
    expect(fs.readFileSync(nextHistoryPath, "utf8")).toBe("echo hello\n");
    expect(await manager.getSession("project-1", "command:local:dev")).toBeNull();
  });

  it("moves persisted shell history even when no session is loaded", async () => {
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

    const previousHistoryPath = (manager as any).shellHistoryPath("project-1", "command:shared:dev");
    const nextHistoryPath = (manager as any).shellHistoryPath("project-1", "command:local:dev");
    fs.writeFileSync(previousHistoryPath, ": 1712500000:0;echo scoped\n", "utf8");

    await manager.moveSessionTab("project-1", "command:shared:dev", "command:local:dev");

    expect(fs.existsSync(previousHistoryPath)).toBe(false);
    expect(fs.readFileSync(nextHistoryPath, "utf8")).toBe(": 1712500000:0;echo scoped\n");
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

    const previousHistoryPath = path.join(historyDir, "project-1_command_dev.log");
    const nextHistoryPath = path.join(historyDir, "project-1_command_shared_dev.log");
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
