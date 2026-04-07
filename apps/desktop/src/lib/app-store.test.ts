import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCommandTabId,
  createEffectiveCommandId,
  type ResolvedCommandConfig,
} from "@kickstart/contracts";

class SqliteStatement {
  constructor(private readonly statement: StatementSync) {}

  run(...args: Parameters<StatementSync["run"]>) {
    return this.statement.run(...args);
  }

  get(...args: Parameters<StatementSync["get"]>) {
    return this.statement.get(...args);
  }

  all(...args: Parameters<StatementSync["all"]>) {
    return this.statement.all(...args);
  }
}

function createBetterSqlite3Compat() {
  return class BetterSqlite3Compat {
    private readonly db: DatabaseSync;

    constructor(filename: string) {
      this.db = new DatabaseSync(filename);
    }

    pragma(source: string) {
      return this.db.prepare(`PRAGMA ${source}`).all();
    }

    exec(source: string) {
      this.db.exec(source);
    }

    prepare(source: string) {
      return new SqliteStatement(this.db.prepare(source));
    }

    transaction<TArgs extends unknown[]>(callback: (...args: TArgs) => void) {
      return (...args: TArgs) => {
        this.db.exec("BEGIN");
        try {
          callback(...args);
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      };
    }

    close() {
      this.db.close();
    }
  };
}

vi.mock("better-sqlite3", () => ({
  default: createBetterSqlite3Compat(),
}));

const { AppStore } = await import("./app-store");

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const target of cleanupPaths) {
    fs.rmSync(target, { force: true, recursive: true });
  }
  cleanupPaths.clear();
});

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-app-store-"));
  cleanupPaths.add(dir);
  return new AppStore(path.join(dir, "app.db"));
}

function createLegacyStore(seed: (db: DatabaseSync) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-app-store-legacy-"));
  cleanupPaths.add(dir);
  const dbPath = path.join(dir, "app.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_tabs (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      command_id TEXT,
      shell_cwd TEXT,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE project_ui_state (
      project_id TEXT PRIMARY KEY,
      active_tab_id TEXT,
      selected_at TEXT NOT NULL
    );
    CREATE TABLE app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE project_groups (
      id TEXT PRIMARY KEY,
      is_collapsed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE general_space_tabs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      shell_cwd TEXT,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  seed(db);
  db.close();
  return new AppStore(dbPath);
}

function createCommand(commandId: string): ResolvedCommandConfig {
  return {
    command: "pnpm dev",
    cwd: ".",
    id: createEffectiveCommandId("shared", commandId),
    name: "Dev",
    source: "shared",
    sourceCommandId: commandId,
    startMode: "manual",
    type: "service",
  };
}

describe("AppStore.deleteProject", () => {
  it("removes empty groups when deleting their last project", () => {
    const store = createStore();

    try {
      const alpha = store.createProject("/tmp/alpha", "alpha");
      const beta = store.createProject("/tmp/beta", "beta");
      const group = store.createGroupFromProjects(alpha.id, beta.id);

      store.deleteProject(alpha.id);
      store.deleteProject(beta.id);

      expect(store.listGroups()).not.toContainEqual(expect.objectContaining({ id: group.id }));
      expect(store.listGroups()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("clears persisted project command state for the deleted project path", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.setProjectLocalConfig(project.path, JSON.stringify({ commands: [{ command: "pnpm dev" }] }));

      store.deleteProject(project.id);

      expect(store.getProjectCommandState(project.path)).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("AppStore legacy command migration", () => {
  it("migrates legacy command tab ids, shell references, and active selection", () => {
    const store = createLegacyStore((db) => {
      db.prepare(
        `INSERT INTO projects (id, name, path, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("project-1", "alpha", "/tmp/alpha", 0, "2026-04-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
      db.prepare(
        `INSERT INTO project_tabs (id, project_id, kind, title, command_id, shell_cwd, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "command:dev",
        "project-1",
        "command",
        "Dev",
        "dev",
        ".",
        0,
        "2026-04-01T00:00:00.000Z",
        "2026-04-01T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO project_tabs (id, project_id, kind, title, command_id, shell_cwd, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "shell:preserved",
        "project-1",
        "shell",
        "Dev",
        "dev",
        ".",
        1,
        "2026-04-01T00:00:00.000Z",
        "2026-04-01T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO project_ui_state (project_id, active_tab_id, selected_at)
         VALUES (?, ?, ?)`,
      ).run("project-1", "command:dev", "2026-04-01T00:00:00.000Z");
    });

    try {
      const nextCommandId = createEffectiveCommandId("shared", "dev");
      const nextTabId = createCommandTabId(nextCommandId);

      expect(store.consumeLegacyCommandTabMigrations()).toEqual([
        {
          nextCommandId,
          nextTabId,
          previousCommandId: "dev",
          previousTabId: "command:dev",
          projectId: "project-1",
        },
      ]);
      expect(store.getTab("project-1", nextTabId)).toMatchObject({
        commandId: nextCommandId,
        id: nextTabId,
      });
      expect(store.getTab("project-1", "shell:preserved")).toMatchObject({
        commandId: nextCommandId,
      });
      expect(store.getTabState("project-1").activeTabId).toBe(nextTabId);
    } finally {
      store.close();
    }
  });
});

describe("AppStore.moveProjectToGroup", () => {
  it("dissolves the source group when moving out its second-to-last project", () => {
    const store = createStore();

    try {
      const alpha = store.createProject("/tmp/alpha", "alpha");
      const beta = store.createProject("/tmp/beta", "beta");
      const gamma = store.createProject("/tmp/gamma", "gamma");
      const delta = store.createProject("/tmp/delta", "delta");

      const sourceGroup = store.createGroupFromProjects(alpha.id, beta.id);
      const targetGroup = store.createGroupFromProjects(gamma.id, delta.id);

      store.moveProjectToGroup(alpha.id, targetGroup.id);

      expect(store.listGroups()).not.toContainEqual(expect.objectContaining({ id: sourceGroup.id }));
      expect(store.getProject(beta.id)).toMatchObject({ groupId: null });
      expect(store.getProject(alpha.id)).toMatchObject({ groupId: targetGroup.id });
    } finally {
      store.close();
    }
  });

  it("preserves the dissolved group's rail slot for the remaining project", () => {
    const store = createStore();

    try {
      const alpha = store.createProject("/tmp/alpha", "alpha");
      const beta = store.createProject("/tmp/beta", "beta");
      const gamma = store.createProject("/tmp/gamma", "gamma");
      const delta = store.createProject("/tmp/delta", "delta");

      store.createGroupFromProjects(alpha.id, beta.id);
      const targetGroup = store.createGroupFromProjects(gamma.id, delta.id);

      store.moveProjectToGroup(alpha.id, targetGroup.id);

      expect(store.getProject(beta.id)).toMatchObject({ groupId: null, sortOrder: 0 });
    } finally {
      store.close();
    }
  });
});

describe("AppStore.removeProjectFromGroup", () => {
  it("keeps both projects in stable rail order when dissolving a two-project group", () => {
    const store = createStore();

    try {
      const alpha = store.createProject("/tmp/alpha", "alpha");
      const beta = store.createProject("/tmp/beta", "beta");

      store.createGroupFromProjects(alpha.id, beta.id);
      store.removeProjectFromGroup(alpha.id);

      expect(store.getProject(alpha.id)).toMatchObject({ groupId: null, sortOrder: 0 });
      expect(store.getProject(beta.id)).toMatchObject({ groupId: null, sortOrder: 1 });
    } finally {
      store.close();
    }
  });
});

describe("AppStore.updateTabShellCwd", () => {
  it("persists the latest cwd for shell tabs", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      const state = store.createShellTab(project.id);
      const tabId = state.activeTabId!;

      store.updateTabShellCwd(project.id, tabId, "/tmp");

      expect(store.getTab(project.id, tabId)).toMatchObject({
        shellCwd: "/tmp",
      });
    } finally {
      store.close();
    }
  });
});

describe("AppStore selected project state", () => {
  it("persists the selected project across store reloads", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-app-store-selected-project-"));
    cleanupPaths.add(dir);
    const dbPath = path.join(dir, "app.db");

    const firstStore = new AppStore(dbPath);
    const project = firstStore.createProject("/tmp/alpha", "alpha");
    firstStore.selectProject(project.id);
    firstStore.close();

    const secondStore = new AppStore(dbPath);

    try {
      expect(secondStore.getSelectedProjectId()).toBe(project.id);
    } finally {
      secondStore.close();
    }
  });
});

describe("AppStore.moveCommandTab", () => {
  it("renames a persisted command tab in place and preserves active selection", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.syncTabs(project.id, [createCommand("dev")]);
      store.selectTab(project.id, `command:${createEffectiveCommandId("shared", "dev")}`);

      store.moveCommandTab(project.id, `command:${createEffectiveCommandId("shared", "dev")}`, {
        commandId: createEffectiveCommandId("local", "dev"),
        id: `command:${createEffectiveCommandId("local", "dev")}`,
        shellCwd: "apps/web",
        title: "Dev Personal",
      });

      expect(store.getTab(project.id, `command:${createEffectiveCommandId("shared", "dev")}`)).toBeNull();
      expect(store.getTab(project.id, `command:${createEffectiveCommandId("local", "dev")}`)).toMatchObject({
        commandId: createEffectiveCommandId("local", "dev"),
        id: `command:${createEffectiveCommandId("local", "dev")}`,
        shellCwd: "apps/web",
        title: "Dev Personal",
      });
      expect(store.getTabState(project.id).activeTabId).toBe(
        `command:${createEffectiveCommandId("local", "dev")}`,
      );
    } finally {
      store.close();
    }
  });

  it("fails when the target tab id already exists", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.syncTabs(project.id, [createCommand("dev"), createCommand("test")]);

      expect(() =>
        store.moveCommandTab(project.id, `command:${createEffectiveCommandId("shared", "dev")}`, {
          commandId: createEffectiveCommandId("shared", "test"),
          id: `command:${createEffectiveCommandId("shared", "test")}`,
          shellCwd: ".",
          title: "Test",
        }),
      ).toThrow("already exists");
    } finally {
      store.close();
    }
  });
});

describe("AppStore project command state", () => {
  it("persists local config by project path", () => {
    const store = createStore();

    try {
      store.setProjectLocalConfig("/tmp/alpha", JSON.stringify({ commands: [{ command: "pnpm dev" }] }));

      expect(store.getProjectCommandState("/tmp/alpha")).toMatchObject({
        localConfigJson: JSON.stringify({ commands: [{ command: "pnpm dev" }] }),
        projectPath: "/tmp/alpha",
      });
    } finally {
      store.close();
    }
  });

  it("drops the project command state row when local config becomes empty", () => {
    const store = createStore();

    try {
      store.setProjectLocalConfig("/tmp/alpha", JSON.stringify({ commands: [{ command: "pnpm dev" }] }));

      store.setProjectLocalConfig("/tmp/alpha", null);
      expect(store.getProjectCommandState("/tmp/alpha")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("restores local config", () => {
    const store = createStore();

    try {
      store.setProjectLocalConfig("/tmp/alpha", JSON.stringify({ commands: [{ command: "pnpm dev" }] }));

      store.restoreProjectCommandState("/tmp/alpha", {
        localConfigJson: JSON.stringify({ commands: [{ command: "pnpm test" }] }),
      });

      expect(store.getProjectCommandState("/tmp/alpha")).toMatchObject({
        localConfigJson: JSON.stringify({ commands: [{ command: "pnpm test" }] }),
      });
    } finally {
      store.close();
    }
  });
});

describe("AppStore.deleteShellTab", () => {
  it("selects the tab above the deleted shell tab", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.syncTabs(project.id, [createCommand("dev")]);
      store.createShellTab(project.id);
      const second = store.createShellTab(project.id);
      const third = store.createShellTab(project.id);

      store.selectTab(project.id, second.activeTabId);

      const nextState = store.deleteShellTab(project.id, second.activeTabId!);

      expect(nextState.activeTabId).toBe(nextState.tabs[1]?.id ?? null);
      expect(nextState.activeTabId).not.toBe(nextState.tabs[0]?.id ?? null);
      expect(nextState.activeTabId).not.toBe(third.activeTabId);
    } finally {
      store.close();
    }
  });
});

describe("AppStore.syncTabs", () => {
  it("moves running missing command tabs into the shell section and restores them later", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.syncTabs(project.id, [createCommand("dev")]);

      let state = store.syncTabs(
        project.id,
        [],
        new Set([`command:${createEffectiveCommandId("shared", "dev")}`]),
      );
      expect(state.tabs).toEqual([
        expect.objectContaining({
          commandId: createEffectiveCommandId("shared", "dev"),
          id: `command:${createEffectiveCommandId("shared", "dev")}`,
          kind: "shell",
          title: "Dev",
        }),
      ]);

      state = store.syncTabs(project.id, [createCommand("dev")]);

      expect(state.tabs).toEqual([
        expect.objectContaining({
          commandId: createEffectiveCommandId("shared", "dev"),
          id: `command:${createEffectiveCommandId("shared", "dev")}`,
          kind: "command",
          title: "Dev",
        }),
      ]);
    } finally {
      store.close();
    }
  });
});
