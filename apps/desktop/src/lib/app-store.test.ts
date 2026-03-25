import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

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

class BetterSqlite3Compat {
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
}

vi.mock("better-sqlite3", () => ({
  default: BetterSqlite3Compat,
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

describe("AppStore.deleteShellTab", () => {
  it("selects the tab above the deleted shell tab", () => {
    const store = createStore();

    try {
      const project = store.createProject("/tmp/alpha", "alpha");
      store.syncTabs(project.id, [
        {
          command: "pnpm dev",
          cwd: ".",
          id: "dev",
          name: "Dev",
          startMode: "manual",
          type: "service",
        },
      ]);
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
      store.syncTabs(project.id, [
        {
          command: "pnpm dev",
          cwd: ".",
          id: "dev",
          name: "Dev",
          startMode: "manual",
          type: "service",
        },
      ]);

      let state = store.syncTabs(project.id, [], new Set(["command:dev"]));
      expect(state.tabs).toEqual([
        expect.objectContaining({
          commandId: "dev",
          id: "command:dev",
          kind: "shell",
          title: "Dev",
        }),
      ]);

      state = store.syncTabs(project.id, [
        {
          command: "pnpm dev",
          cwd: ".",
          id: "dev",
          name: "Dev",
          startMode: "manual",
          type: "service",
        },
      ]);

      expect(state.tabs).toEqual([
        expect.objectContaining({
          commandId: "dev",
          id: "command:dev",
          kind: "command",
          title: "Dev",
        }),
      ]);
    } finally {
      store.close();
    }
  });
});
