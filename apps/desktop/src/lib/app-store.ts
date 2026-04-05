import fs from "node:fs";
import path from "node:path";

import {
  GENERAL_SPACE_ID,
  commandIdSchema,
  createCommandTabId,
  createEffectiveCommandId,
  parseCommandTabId,
  parseEffectiveCommandId,
  type ProjectGroupRecord,
  type ProjectRecord,
  type ProjectTabRecord,
  type ProjectTabState,
  type ResolvedCommandConfig,
} from "@kickstart/contracts";
import { mergeProjectTabs } from "@kickstart/core";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const GENERAL_SPACE_TAB_STATE_KEY = "generalSpaceActiveTabId";

function now() {
  return new Date().toISOString();
}

function normalizeTabs(tabs: ProjectTabRecord[]): ProjectTabRecord[] {
  return tabs
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((tab, index) => ({
      ...tab,
      sortOrder: index,
    }));
}

function isGeneralSpace(projectId: string) {
  return projectId === GENERAL_SPACE_ID;
}

type RailSortItem =
  | { createdAt: string; id: string; sortOrder: number; type: "group" }
  | { createdAt: string; id: string; sortOrder: number; type: "project" };

interface StoredProjectCommandState {
  createdAt: string;
  localConfigJson: string | null;
  projectPath: string;
  updatedAt: string;
}

export interface LegacyCommandTabMigration {
  nextCommandId: string;
  nextTabId: string;
  previousCommandId: string;
  previousTabId: string;
  projectId: string;
}

export class AppStore {
  private readonly db: Database.Database;
  private pendingLegacyCommandTabMigrations: LegacyCommandTabMigration[] = [];

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_tabs (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        command_id TEXT,
        shell_cwd TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_ui_state (
        project_id TEXT PRIMARY KEY,
        active_tab_id TEXT,
        selected_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_groups (
        id TEXT PRIMARY KEY,
        is_collapsed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS general_space_tabs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        shell_cwd TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_command_state (
        project_path TEXT PRIMARY KEY,
        local_config_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Add group_id column if missing (migration for existing databases)
    const columns = this.db.pragma("table_info(projects)") as { name: string }[];
    if (!columns.some((col) => col.name === "group_id")) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES project_groups(id) ON DELETE SET NULL`);
    }

    // Drop legacy name column from project_groups if it exists
    const groupCols = this.db.pragma("table_info(project_groups)") as { name: string }[];
    if (groupCols.some((col) => col.name === "name")) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_groups_new (
          id TEXT PRIMARY KEY,
          is_collapsed INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO project_groups_new SELECT id, is_collapsed, sort_order, created_at, updated_at FROM project_groups;
        DROP TABLE project_groups;
        ALTER TABLE project_groups_new RENAME TO project_groups;
      `);
    }

    this.pendingLegacyCommandTabMigrations = this.migrateLegacyCommandTabs();
  }

  close() {
    this.db.close();
  }

  consumeLegacyCommandTabMigrations(): LegacyCommandTabMigration[] {
    const migrations = this.pendingLegacyCommandTabMigrations;
    this.pendingLegacyCommandTabMigrations = [];
    return migrations;
  }

  private migrateLegacyCommandTabs(): LegacyCommandTabMigration[] {
    const rows = this.db
      .prepare(
        `SELECT project_id as projectId, id, kind, command_id as commandId
         FROM project_tabs
         WHERE command_id IS NOT NULL`,
      )
      .all() as Array<{
      commandId: string | null;
      id: string;
      kind: ProjectTabRecord["kind"];
      projectId: string;
    }>;

    const updates = rows.flatMap((row) => {
      if (!row.commandId) {
        return [];
      }
      if (parseEffectiveCommandId(row.commandId)) {
        return [];
      }
      if (!commandIdSchema.safeParse(row.commandId).success) {
        return [];
      }

      const nextCommandId = createEffectiveCommandId("shared", row.commandId);
      const nextTabId = row.kind === "command" ? createCommandTabId(nextCommandId) : row.id;
      const previousTabId =
        row.kind === "command" && parseCommandTabId(row.id)?.commandId === row.commandId
          ? row.id
          : createCommandTabId(row.commandId);

      return [{
        nextCommandId,
        nextTabId,
        previousCommandId: row.commandId,
        previousTabId,
        projectId: row.projectId,
        rowId: row.id,
      }];
    });

    if (updates.length === 0) {
      return [];
    }

    const transaction = this.db.transaction((items: typeof updates) => {
      const timestamp = now();
      for (const item of items) {
        if (item.rowId !== item.nextTabId) {
          const collision = this.db
            .prepare(
              `SELECT 1
               FROM project_tabs
               WHERE project_id = ? AND id = ?`,
            )
            .get(item.projectId, item.nextTabId);
          if (collision) {
            throw new Error(
              `Cannot migrate command tab ${item.projectId}:${item.rowId} because ${item.nextTabId} already exists.`,
            );
          }
        }

        this.db
          .prepare(
            `UPDATE project_tabs
             SET id = ?,
                 command_id = ?,
                 updated_at = ?
             WHERE project_id = ? AND id = ?`,
          )
          .run(item.nextTabId, item.nextCommandId, timestamp, item.projectId, item.rowId);

        if (item.rowId !== item.nextTabId) {
          this.db
            .prepare(
              `UPDATE project_ui_state
               SET active_tab_id = ?, selected_at = ?
               WHERE project_id = ? AND active_tab_id = ?`,
            )
            .run(item.nextTabId, timestamp, item.projectId, item.rowId);
        }
      }
    });

    transaction(updates);

    return updates
      .filter((item) => item.rowId !== item.nextTabId)
      .map(({ nextCommandId, nextTabId, previousCommandId, previousTabId, projectId }) => ({
        nextCommandId,
        nextTabId,
        previousCommandId,
        previousTabId,
        projectId,
      }));
  }

  private normalizeRailSortOrders() {
    const railItems: RailSortItem[] = [
      ...this.listProjects()
        .filter((project) => project.groupId === null)
        .map((project) => ({
          createdAt: project.createdAt,
          id: project.id,
          sortOrder: project.sortOrder,
          type: "project" as const,
        })),
      ...this.listGroups().map((group) => ({
        createdAt: group.createdAt,
        id: group.id,
        sortOrder: group.sortOrder,
        type: "group" as const,
      })),
    ].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );

    for (const [index, item] of railItems.entries()) {
      if (item.type === "project") {
        this.db
          .prepare(`UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND group_id IS NULL`)
          .run(index, now(), item.id);
      } else {
        this.db
          .prepare(`UPDATE project_groups SET sort_order = ?, updated_at = ? WHERE id = ?`)
          .run(index, now(), item.id);
      }
    }
  }

  private normalizeProjectGroupSortOrders(groupId: string) {
    const groupProjects = this.listProjects()
      .filter((project) => project.groupId === groupId)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );

    for (const [index, project] of groupProjects.entries()) {
      this.db
        .prepare(`UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND group_id = ?`)
        .run(index, now(), project.id, groupId);
    }
  }

  listProjects(): (ProjectRecord & { groupId: string | null })[] {
    return this.db
      .prepare(
        `SELECT id, name, path, group_id as groupId, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
         FROM projects
         ORDER BY sort_order ASC, created_at ASC, id ASC`,
      )
      .all() as (ProjectRecord & { groupId: string | null })[];
  }

  getProject(projectId: string): ProjectRecord | null {
    return (
      (this.db
        .prepare(
          `SELECT id, name, path, group_id as groupId, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
           FROM projects
           WHERE id = ?`,
        )
        .get(projectId) as ProjectRecord | undefined) ?? null
    );
  }

  getProjectCommandState(projectPath: string): StoredProjectCommandState | null {
    return (
      (this.db
        .prepare(
          `SELECT project_path as projectPath,
                  local_config_json as localConfigJson,
                  created_at as createdAt,
                  updated_at as updatedAt
           FROM project_command_state
           WHERE project_path = ?`,
        )
        .get(projectPath) as StoredProjectCommandState | undefined) ?? null
    );
  }

  setProjectLocalConfig(projectPath: string, localConfigJson: string | null) {
    const existing = this.getProjectCommandState(projectPath);
    this.writeProjectCommandState(projectPath, {
      createdAt: existing?.createdAt ?? now(),
      localConfigJson,
    });
  }

  restoreProjectCommandState(
    projectPath: string,
    input: {
      localConfigJson: string | null;
    },
  ) {
    const existing = this.getProjectCommandState(projectPath);
    this.writeProjectCommandState(projectPath, {
      createdAt: existing?.createdAt ?? now(),
      localConfigJson: input.localConfigJson,
    });
  }

  private writeProjectCommandState(
    projectPath: string,
    input: {
      createdAt: string;
      localConfigJson: string | null;
    },
  ) {
    if (!input.localConfigJson) {
      this.db.prepare(`DELETE FROM project_command_state WHERE project_path = ?`).run(projectPath);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO project_command_state (
           project_path,
           local_config_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_path) DO UPDATE SET
           local_config_json = excluded.local_config_json,
           updated_at = excluded.updated_at`,
      )
      .run(projectPath, input.localConfigJson, input.createdAt, now());
  }

  createProject(projectPath: string, name: string): ProjectRecord {
    const existing = this.db
      .prepare(
        `SELECT id, name, path, group_id as groupId, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
         FROM projects
         WHERE path = ?`,
      )
      .get(projectPath) as ProjectRecord | undefined;
    if (existing) {
      return existing;
    }

    const createdAt = now();
    const project = {
      createdAt,
      id: randomUUID(),
      name,
      path: projectPath,
      sortOrder: this.listProjects().length,
      updatedAt: createdAt,
    } satisfies ProjectRecord;

    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, sort_order, created_at, updated_at)
         VALUES (@id, @name, @path, @sortOrder, @createdAt, @updatedAt)`,
      )
      .run(project);

    return project;
  }

  deleteProject(projectId: string) {
    const transaction = this.db.transaction((id: string) => {
      const project = this.db
        .prepare(`SELECT group_id as groupId, path FROM projects WHERE id = ?`)
        .get(id) as { groupId: string | null; path: string } | undefined;

      this.db.prepare(`DELETE FROM project_tabs WHERE project_id = ?`).run(id);
      this.db.prepare(`DELETE FROM project_ui_state WHERE project_id = ?`).run(id);
      if (project) {
        this.db.prepare(`DELETE FROM project_command_state WHERE project_path = ?`).run(project.path);
      }
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);

      if (project?.groupId) {
        const remaining = (this.db
          .prepare(`SELECT COUNT(*) as c FROM projects WHERE group_id = ?`)
          .get(project.groupId) as { c: number }).c;
        if (remaining === 0) {
          this.db.prepare(`DELETE FROM project_groups WHERE id = ?`).run(project.groupId);
        }
      }
    });
    transaction(projectId);
  }

  setProjectName(projectId: string, name: string) {
    this.db
      .prepare(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name, now(), projectId);
  }

  reorderProjects(projectIds: string[]) {
    const transaction = this.db.transaction((ids: string[]) => {
      for (const [index, projectId] of ids.entries()) {
        this.db
          .prepare(`UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?`)
          .run(index, now(), projectId);
      }
    });
    transaction(projectIds);
    return this.listProjects();
  }

  listTabs(projectId: string): ProjectTabRecord[] {
    if (isGeneralSpace(projectId)) {
      return this.db
        .prepare(
          `SELECT id, kind, title, shell_cwd as shellCwd, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
           FROM general_space_tabs
           ORDER BY sort_order ASC, created_at ASC, id ASC`,
        )
        .all()
        .map((row) => ({
          ...(row as Omit<ProjectTabRecord, "commandId" | "projectId">),
          commandId: null,
          projectId,
        })) as ProjectTabRecord[];
    }

    return this.db
      .prepare(
        `SELECT id, project_id as projectId, kind, title, command_id as commandId, shell_cwd as shellCwd,
                sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
         FROM project_tabs
         WHERE project_id = ?
         ORDER BY sort_order ASC, created_at ASC, id ASC`,
      )
      .all(projectId) as ProjectTabRecord[];
  }

  replaceTabs(projectId: string, tabs: ProjectTabRecord[]) {
    if (isGeneralSpace(projectId)) {
      const transaction = this.db.transaction((nextTabs: ProjectTabRecord[]) => {
        this.db.prepare(`DELETE FROM general_space_tabs`).run();
        const insert = this.db.prepare(
          `INSERT INTO general_space_tabs (id, kind, title, shell_cwd, sort_order, created_at, updated_at)
           VALUES (@id, @kind, @title, @shellCwd, @sortOrder, @createdAt, @updatedAt)`,
        );
        for (const tab of nextTabs) {
          insert.run(tab);
        }
      });
      transaction(normalizeTabs(tabs));
      return;
    }

    const transaction = this.db.transaction((projectIdValue: string, nextTabs: ProjectTabRecord[]) => {
      this.db.prepare(`DELETE FROM project_tabs WHERE project_id = ?`).run(projectIdValue);
      const insert = this.db.prepare(
        `INSERT INTO project_tabs (id, project_id, kind, title, command_id, shell_cwd, sort_order, created_at, updated_at)
         VALUES (@id, @projectId, @kind, @title, @commandId, @shellCwd, @sortOrder, @createdAt, @updatedAt)`,
      );
      for (const tab of nextTabs) {
        insert.run(tab);
      }
    });
    transaction(projectId, normalizeTabs(tabs));
  }

  syncTabs(
    projectId: string,
    commands: ResolvedCommandConfig[],
    runningTabIds?: ReadonlySet<string>,
  ): ProjectTabState {
    if (isGeneralSpace(projectId)) {
      return this.getTabState(projectId);
    }
    const nextTabs = mergeProjectTabs(projectId, commands, this.listTabs(projectId), runningTabIds);
    this.replaceTabs(projectId, nextTabs);
    return this.getTabState(projectId);
  }

  createShellTab(projectId: string): ProjectTabState {
    const tabs = this.listTabs(projectId);
    const shellCount = tabs.filter((tab) => tab.kind === "shell").length;
    const timestamp = now();
    const tab: ProjectTabRecord = {
      commandId: null,
      createdAt: timestamp,
      id: `shell:${randomUUID()}`,
      kind: "shell",
      projectId,
      shellCwd: isGeneralSpace(projectId) ? process.env.HOME ?? process.cwd() : ".",
      sortOrder: tabs.length,
      title: `Shell ${shellCount + 1}`,
      updatedAt: timestamp,
    };
    this.replaceTabs(projectId, [...tabs, tab]);
    this.selectTab(projectId, tab.id);
    return this.getTabState(projectId);
  }

  updateTabShellCwd(projectId: string, tabId: string, shellCwd: string) {
    const timestamp = now();
    if (isGeneralSpace(projectId)) {
      this.db
        .prepare(
          `UPDATE general_space_tabs
           SET shell_cwd = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(shellCwd, timestamp, tabId);
      return;
    }

    this.db
      .prepare(
        `UPDATE project_tabs
         SET shell_cwd = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      )
      .run(shellCwd, timestamp, projectId, tabId);
  }

  moveCommandTab(
    projectId: string,
    previousTabId: string,
    nextTab: {
      commandId: string;
      id: string;
      shellCwd: string;
      title: string;
    },
  ) {
    if (isGeneralSpace(projectId) || previousTabId === nextTab.id) {
      return;
    }

    const transaction = this.db.transaction((
      projectIdValue: string,
      previousId: string,
      next,
    ) => {
      const existing = this.db
        .prepare(
          `SELECT id
           FROM project_tabs
           WHERE project_id = ? AND id = ? AND kind = 'command'`,
        )
        .get(projectIdValue, previousId) as { id: string } | undefined;
      if (!existing) {
        return;
      }

      const collision = this.db
        .prepare(
          `SELECT id
           FROM project_tabs
           WHERE project_id = ? AND id = ?`,
        )
        .get(projectIdValue, next.id) as { id: string } | undefined;
      if (collision) {
        throw new Error(`Tab ${next.id} already exists.`);
      }

      const timestamp = now();
      this.db
        .prepare(
          `UPDATE project_tabs
           SET id = ?,
               command_id = ?,
               title = ?,
               shell_cwd = ?,
               updated_at = ?
           WHERE project_id = ? AND id = ?`,
        )
        .run(
          next.id,
          next.commandId,
          next.title,
          next.shellCwd,
          timestamp,
          projectIdValue,
          previousId,
        );

      this.db
        .prepare(
          `UPDATE project_ui_state
           SET active_tab_id = ?, selected_at = ?
           WHERE project_id = ? AND active_tab_id = ?`,
        )
        .run(next.id, timestamp, projectIdValue, previousId);
    });

    transaction(projectId, previousTabId, nextTab);
  }

  deleteShellTab(projectId: string, tabId: string): ProjectTabState {
    const tabs = this.listTabs(projectId);
    const deletedIndex = tabs.findIndex((tab) => tab.id === tabId);
    const previousActiveTabId = this.getTabState(projectId).activeTabId;
    const remaining = tabs.filter(
      (tab) => !(tab.kind === "shell" && tab.id === tabId),
    );
    this.replaceTabs(projectId, remaining);
    if (previousActiveTabId === tabId && remaining.length > 0) {
      const fallbackIndex = Math.max(0, deletedIndex - 1);
      this.selectTab(projectId, remaining[fallbackIndex]?.id ?? null);
    }
    return this.getTabState(projectId);
  }

  reorderTabs(projectId: string, tabIds: string[]): ProjectTabState {
    const tabs = this.listTabs(projectId);
    const commandTabs = tabs.filter((tab) => tab.kind === "command");
    const shellTabs = tabs.filter((tab) => tab.kind === "shell");
    const shellById = new Map(shellTabs.map((tab) => [tab.id, tab]));
    const orderedShellTabs = tabIds
      .map((id) => shellById.get(id))
      .filter((tab): tab is ProjectTabRecord => Boolean(tab));
    const remainingShellTabs = shellTabs.filter((tab) => !tabIds.includes(tab.id));
    this.replaceTabs(projectId, [...commandTabs, ...orderedShellTabs, ...remainingShellTabs]);
    return this.getTabState(projectId);
  }

  getTab(projectId: string, tabId: string): ProjectTabRecord | null {
    if (isGeneralSpace(projectId)) {
      return this.listTabs(projectId).find((tab) => tab.id === tabId) ?? null;
    }

    return (
      (this.db
        .prepare(
          `SELECT id, project_id as projectId, kind, title, command_id as commandId, shell_cwd as shellCwd,
                  sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
           FROM project_tabs
           WHERE project_id = ? AND id = ?`,
        )
        .get(projectId, tabId) as ProjectTabRecord | undefined) ?? null
    );
  }

  selectTab(projectId: string, tabId: string | null) {
    const selectedAt = now();
    if (isGeneralSpace(projectId)) {
      this.db
        .prepare(
          `INSERT INTO app_state (key, value)
           VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(GENERAL_SPACE_TAB_STATE_KEY, JSON.stringify({ selectedAt, tabId }));
      return;
    }

    this.db
      .prepare(
        `INSERT INTO project_ui_state (project_id, active_tab_id, selected_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET active_tab_id = excluded.active_tab_id, selected_at = excluded.selected_at`,
      )
      .run(projectId, tabId, selectedAt);
  }

  getTabState(projectId: string): ProjectTabState {
    const tabs = this.listTabs(projectId);
    if (isGeneralSpace(projectId)) {
      const row = this.db
        .prepare(`SELECT value FROM app_state WHERE key = ?`)
        .get(GENERAL_SPACE_TAB_STATE_KEY) as { value: string } | undefined;
      let activeTabId: string | null = null;
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value) as { tabId?: string | null };
          activeTabId = parsed.tabId ?? null;
        } catch {
          activeTabId = null;
        }
      }
      return {
        activeTabId:
          activeTabId && tabs.some((tab) => tab.id === activeTabId)
            ? activeTabId
            : (tabs[0]?.id ?? null),
        tabs,
      };
    }

    const row = this.db
      .prepare(`SELECT active_tab_id as activeTabId FROM project_ui_state WHERE project_id = ?`)
      .get(projectId) as { activeTabId: string | null } | undefined;
    const activeTabId =
      row?.activeTabId && tabs.some((tab) => tab.id === row.activeTabId)
        ? row.activeTabId
        : (tabs[0]?.id ?? null);
    return {
      activeTabId,
      tabs,
    };
  }

  getSelectedProjectId(): string | null {
    const row = this.db
      .prepare(`SELECT value FROM app_state WHERE key = 'selectedProjectId'`)
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  selectProject(projectId: string) {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value)
         VALUES ('selectedProjectId', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(projectId);
  }

  // ── Groups ──────────────────────────────────────────────────

  listGroups(): ProjectGroupRecord[] {
    return this.db
      .prepare(
        `SELECT id, is_collapsed as isCollapsed, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
         FROM project_groups
         ORDER BY sort_order ASC, created_at ASC, id ASC`,
      )
      .all()
      .map((row) => ({
        ...(row as Record<string, unknown>),
        isCollapsed: Boolean((row as Record<string, unknown>).isCollapsed),
      })) as ProjectGroupRecord[];
  }

  /** Drag project A onto project B → create a group containing both. */
  createGroupFromProjects(projectIdA: string, projectIdB: string): ProjectGroupRecord {
    const timestamp = now();
    const projectB = this.getProject(projectIdB);
    const group: ProjectGroupRecord = {
      id: randomUUID(),
      isCollapsed: false,
      sortOrder: projectB?.sortOrder ?? 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO project_groups (id, is_collapsed, sort_order, created_at, updated_at)
           VALUES (?, 0, ?, ?, ?)`,
        )
        .run(group.id, group.sortOrder, timestamp, timestamp);
      this.db
        .prepare(`UPDATE projects SET group_id = ?, sort_order = 0, updated_at = ? WHERE id = ?`)
        .run(group.id, timestamp, projectIdA);
      this.db
        .prepare(`UPDATE projects SET group_id = ?, sort_order = 1, updated_at = ? WHERE id = ?`)
        .run(group.id, timestamp, projectIdB);
      this.normalizeRailSortOrders();
    })();
    return group;
  }

  moveProjectToGroup(projectId: string, groupId: string) {
    this.db.transaction((projectIdValue: string, targetGroupId: string) => {
      const project = this.db
        .prepare(`SELECT group_id as groupId FROM projects WHERE id = ?`)
        .get(projectIdValue) as { groupId: string | null } | undefined;
      if (!project) {
        return;
      }

      if (project.groupId !== targetGroupId) {
        const maxOrder = (this.db
          .prepare(`SELECT COALESCE(MAX(sort_order), -1) as m FROM projects WHERE group_id = ?`)
          .get(targetGroupId) as { m: number }).m;
        this.db
          .prepare(`UPDATE projects SET group_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`)
          .run(targetGroupId, maxOrder + 1, now(), projectIdValue);
      }

      if (!project.groupId || project.groupId === targetGroupId) {
        return;
      }

      const remaining = (this.db
        .prepare(`SELECT COUNT(*) as c FROM projects WHERE group_id = ?`)
        .get(project.groupId) as { c: number }).c;

      if (remaining <= 1) {
        const sourceGroup = this.db
          .prepare(`SELECT sort_order as sortOrder FROM project_groups WHERE id = ?`)
          .get(project.groupId) as { sortOrder: number } | undefined;
        this.db
          .prepare(`UPDATE projects SET group_id = NULL, sort_order = ?, updated_at = ? WHERE group_id = ?`)
          .run(sourceGroup?.sortOrder ?? 0, now(), project.groupId);
        this.db.prepare(`DELETE FROM project_groups WHERE id = ?`).run(project.groupId);
      } else {
        this.normalizeProjectGroupSortOrders(project.groupId);
      }

      this.normalizeProjectGroupSortOrders(targetGroupId);
      this.normalizeRailSortOrders();
    })(projectId, groupId);
  }

  /** Remove project from its group. Auto-dissolves group if ≤1 project remains. */
  removeProjectFromGroup(projectId: string) {
    const project = this.db
      .prepare(`SELECT group_id as groupId FROM projects WHERE id = ?`)
      .get(projectId) as { groupId: string | null } | undefined;
    if (!project?.groupId) return;

    const groupId = project.groupId;
    this.db.transaction(() => {
      const group = this.db
        .prepare(`SELECT sort_order as sortOrder FROM project_groups WHERE id = ?`)
        .get(groupId) as { sortOrder: number } | undefined;
      const groupSortOrder = group?.sortOrder ?? 0;
      this.db
        .prepare(`UPDATE projects SET group_id = NULL, sort_order = ?, updated_at = ? WHERE id = ?`)
        .run(groupSortOrder, now(), projectId);

      const remaining = (this.db
        .prepare(`SELECT COUNT(*) as c FROM projects WHERE group_id = ?`)
        .get(groupId) as { c: number }).c;

      if (remaining <= 1) {
        this.db
          .prepare(`UPDATE projects SET group_id = NULL, sort_order = ?, updated_at = ? WHERE group_id = ?`)
          .run(groupSortOrder + 1, now(), groupId);
        this.db.prepare(`DELETE FROM project_groups WHERE id = ?`).run(groupId);
      } else {
        this.normalizeProjectGroupSortOrders(groupId);
      }

      this.normalizeRailSortOrders();
    })();
  }

  toggleGroupCollapsed(groupId: string) {
    this.db
      .prepare(
        `UPDATE project_groups SET is_collapsed = CASE WHEN is_collapsed = 0 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?`,
      )
      .run(now(), groupId);
  }

  /** Reorder the rail — items is an ordered array of {type, id} for ungrouped projects and groups. */
  reorderRail(items: { type: "project" | "group"; id: string }[]) {
    this.db.transaction(() => {
      for (const [index, item] of items.entries()) {
        if (item.type === "project") {
          this.db
            .prepare(`UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND group_id IS NULL`)
            .run(index, now(), item.id);
        } else {
          this.db
            .prepare(`UPDATE project_groups SET sort_order = ?, updated_at = ? WHERE id = ?`)
            .run(index, now(), item.id);
        }
      }

      this.normalizeRailSortOrders();
    })();
  }

  reorderProjectsInGroup(groupId: string, projectIds: string[]) {
    this.db.transaction(() => {
      for (const [index, projectId] of projectIds.entries()) {
        this.db
          .prepare(`UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND group_id = ?`)
          .run(index, now(), projectId, groupId);
      }

      this.normalizeProjectGroupSortOrders(groupId);
    })();
  }
}
