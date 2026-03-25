export type TabKind = "command" | "shell";
export const GENERAL_SPACE_ID = "general";

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTabRecord {
  id: string;
  projectId: string;
  kind: TabKind;
  title: string;
  commandId: string | null;
  shellCwd: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTabState {
  activeTabId: string | null;
  tabs: ProjectTabRecord[];
}

export type ProjectRuntimeState =
  | "not-running"
  | "starting"
  | "partially-running"
  | "running"
  | "stopping";

export interface ProjectWithRuntime {
  configExists: boolean;
  groupId: string | null;
  iconUrl: string | null;
  id: string;
  name: string;
  path: string;
  startupCommandCount: number;
  runningCommandCount: number;
  runtimeState: ProjectRuntimeState;
  sortOrder: number;
}

export interface ProjectGroupRecord {
  id: string;
  isCollapsed: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
