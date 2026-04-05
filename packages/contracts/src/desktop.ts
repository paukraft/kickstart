import type {
  CommandSource,
  EditableCommandConfig,
  EditableKickstartConfig,
  EffectiveCommandId,
} from "./config";
import type {
  ProjectGroupRecord,
  ProjectTabRecord,
  ProjectTabState,
  ProjectWithRuntime,
} from "./state";
import type {
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalRestartInput,
  TerminalResizeInput,
  TerminalRunInput,
  TerminalSessionSnapshot,
  TerminalStopInput,
  TerminalWriteInput,
} from "./terminal";

export const EDITOR_OPTIONS = [
  { command: "cursor", id: "cursor", label: "Cursor" },
  { args: ["app"], command: "codex", id: "codex", label: "Codex" },
  { command: "windsurf", id: "windsurf", label: "Windsurf" },
  { command: "code", id: "vscode", label: "VS Code" },
  { command: "zed", id: "zed", label: "Zed" },
  { command: "idea", id: "intellij", label: "IntelliJ IDEA" },
  { command: "webstorm", id: "webstorm", label: "WebStorm" },
  { command: "pycharm", id: "pycharm", label: "PyCharm" },
  { command: "goland", id: "goland", label: "GoLand" },
  { command: "phpstorm", id: "phpstorm", label: "PhpStorm" },
  { command: "rubymine", id: "rubymine", label: "RubyMine" },
  { command: "clion", id: "clion", label: "CLion" },
  { command: "rider", id: "rider", label: "Rider" },
  { command: "studio", id: "android-studio", label: "Android Studio" },
  { command: "subl", id: "sublime-text", label: "Sublime Text" },
  { command: "nova", id: "nova", label: "Nova" },
  { command: null, id: "file-manager", label: "File Manager" },
] as const;

export type EditorId = (typeof EDITOR_OPTIONS)[number]["id"];
export type EditorOption = Pick<(typeof EDITOR_OPTIONS)[number], "id" | "label">;

export interface DesktopBootstrap {
  platform: NodeJS.Platform;
  version: string;
}

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"
  | "disabled";

export type DesktopUpdateErrorContext = "check" | "download" | "install" | null;
export type DesktopUpdateMode = "auto" | "manual";

export interface DesktopUpdateState {
  availableVersion: string | null;
  canRetry: boolean;
  checkedAt: string | null;
  currentVersion: string;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  enabled: boolean;
  errorContext: DesktopUpdateErrorContext;
  message: string | null;
  status: DesktopUpdateStatus;
  updateMode: DesktopUpdateMode;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export type ShortcutActionId =
  | "toggle-project-command-menu"
  | "new-shell-tab"
  | "close-tab"
  | "select-previous-tab"
  | "select-next-tab"
  | "select-tab-1"
  | "select-tab-2"
  | "select-tab-3"
  | "select-tab-4"
  | "select-tab-5"
  | "select-tab-6"
  | "select-tab-7"
  | "select-tab-8"
  | "select-tab-9"
  | "open-project"
  | "open-project-settings"
  | "show-keyboard-shortcuts";

export interface CreateProjectInput {
  path: string;
}

export interface UpsertCommandInput {
  command: EditableCommandConfig;
  projectId: string;
  source: CommandSource;
}

export interface UpdateCommandInput extends UpsertCommandInput {
  existingCommandId: EffectiveCommandId;
}

export interface DeleteCommandInput {
  commandId: EffectiveCommandId;
  projectId: string;
}

export interface ReorderProjectsInput {
  projectIds: string[];
}

export interface ReorderTabsInput {
  projectId: string;
  tabIds: string[];
}

export interface ReorderCommandsInput {
  commandIds: EffectiveCommandId[];
  projectId: string;
}

export interface NewShellTabInput {
  projectId: string;
}

export interface SelectProjectInput {
  projectId: string;
}

export interface SelectTabInput {
  projectId: string;
  tabId: string;
}

export interface CreateGroupFromProjectsInput {
  projectIdA: string;
  projectIdB: string;
}

export interface MoveProjectToGroupInput {
  projectId: string;
  groupId: string;
}

export interface RailItem {
  type: "project" | "group";
  id: string;
}

export interface ReorderRailInput {
  items: RailItem[];
}

export interface ReorderProjectsInGroupInput {
  groupId: string;
  projectIds: string[];
}

export interface ProjectConfigSourcePayload {
  config: EditableKickstartConfig | null;
  configError?: string | null;
  configExists: boolean;
}

export interface ProjectConfigPayload {
  hasCommands: boolean;
  local: ProjectConfigSourcePayload;
  shared: ProjectConfigSourcePayload;
}

export interface ConfigChangedPayload {
  hasCommands: boolean;
  local: ProjectConfigSourcePayload;
  projectId: string;
  shared: ProjectConfigSourcePayload;
  tabs: ProjectTabRecord[];
}

export interface DesktopBridge {
  checkForUpdates: () => Promise<DesktopUpdateActionResult>;
  createCommand: (input: UpsertCommandInput) => Promise<ProjectConfigPayload>;
  createGroupFromProjects: (input: CreateGroupFromProjectsInput) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<ProjectWithRuntime>;
  createProjectConfig: (projectId: string) => Promise<ProjectConfigPayload>;
  createShellTab: (input: NewShellTabInput) => Promise<ProjectTabState>;
  deleteCommand: (input: DeleteCommandInput) => Promise<ProjectConfigPayload>;
  deleteProject: (projectId: string) => Promise<void>;
  deleteShellTab: (projectId: string, tabId: string) => Promise<ProjectTabState>;
  getUpdateState: () => Promise<DesktopUpdateState>;
  getProjectConfig: (projectId: string) => Promise<ProjectConfigPayload>;
  getProjectTerminalSessions: (projectId: string) => Promise<TerminalSessionSnapshot[]>;
  getProjectTabs: (projectId: string) => Promise<ProjectTabState>;
  listAvailableEditors: () => Promise<EditorOption[]>;
  listGroups: () => Promise<ProjectGroupRecord[]>;
  listProjects: () => Promise<ProjectWithRuntime[]>;
  moveProjectToGroup: (input: MoveProjectToGroupInput) => Promise<void>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  getPathForFile: (file: File) => string;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  openTerminal: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot | null>;
  openInEditor: (path: string, editorId: EditorId) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  onUpdateState: (
    listener: (state: DesktopUpdateState) => void,
  ) => () => void;
  removeProjectFromGroup: (projectId: string) => Promise<void>;
  reorderCommands: (input: ReorderCommandsInput) => Promise<ProjectConfigPayload>;
  reorderProjects: (input: ReorderProjectsInput) => Promise<ProjectWithRuntime[]>;
  reorderProjectsInGroup: (input: ReorderProjectsInGroupInput) => Promise<void>;
  reorderRail: (input: ReorderRailInput) => Promise<void>;
  reorderTabs: (input: ReorderTabsInput) => Promise<ProjectTabState>;
  runProjectStart: (projectId: string) => Promise<void>;
  restartTerminalCommand: (input: TerminalRestartInput) => Promise<void>;
  runTerminalCommand: (input: TerminalRunInput) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  selectProject: (input: SelectProjectInput) => Promise<void>;
  selectTab: (input: SelectTabInput) => Promise<void>;
  stopProjectStart: (projectId: string) => Promise<void>;
  stopTerminalCommand: (input: TerminalStopInput) => Promise<void>;
  toggleGroupCollapsed: (groupId: string) => Promise<void>;
  terminalClose: (input: TerminalCloseInput) => Promise<void>;
  terminalResize: (input: TerminalResizeInput) => Promise<void>;
  terminalWrite: (input: TerminalWriteInput) => Promise<void>;
  updateCommand: (input: UpdateCommandInput) => Promise<ProjectConfigPayload>;
  watchShortcutActions: (
    listener: (actionId: ShortcutActionId) => void,
  ) => () => void;
  watchConfig: (
    listener: (payload: ConfigChangedPayload) => void,
  ) => () => void;
  watchTerminalEvents: (
    listener: (event: TerminalEvent) => void,
  ) => () => void;
}
