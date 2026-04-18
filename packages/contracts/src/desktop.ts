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

export interface EditorDefinition {
  args?: readonly string[];
  command: string | null;
  darwinAppNames?: readonly string[];
  darwinBundleIdentifiers?: readonly string[];
  darwinExecutableCandidates?: readonly string[];
  darwinRequiresExecutableWhenCommandMissing?: boolean;
  darwinOpenWithArgs?: boolean;
  darwinSystemAppPath?: string;
  id: string;
  label: string;
  windowsAppxPackagePrefixes?: readonly string[];
  windowsExecutableCandidates?: readonly string[];
  windowsSystemExecutable?: string;
}

export const EDITOR_OPTIONS = [
  {
    command: "cursor",
    darwinAppNames: ["Cursor"],
    darwinBundleIdentifiers: ["com.todesktop.230313mzl4w4u92"],
    id: "cursor",
    label: "Cursor",
    windowsExecutableCandidates: ["Cursor/Cursor.exe", "Programs/Cursor/Cursor.exe"],
  },
  {
    args: ["app"],
    command: "codex",
    darwinAppNames: ["Codex"],
    darwinBundleIdentifiers: ["com.openai.codex"],
    darwinRequiresExecutableWhenCommandMissing: true,
    id: "codex",
    label: "Codex",
    windowsAppxPackagePrefixes: ["OpenAI.Codex"],
  },
  {
    command: "windsurf",
    darwinAppNames: ["Windsurf"],
    darwinBundleIdentifiers: ["com.exafunction.windsurf"],
    id: "windsurf",
    label: "Windsurf",
    windowsExecutableCandidates: ["Windsurf/Windsurf.exe", "Programs/Windsurf/Windsurf.exe"],
  },
  {
    command: "code",
    darwinAppNames: ["Visual Studio Code"],
    darwinBundleIdentifiers: ["com.microsoft.VSCode"],
    id: "vscode",
    label: "VS Code",
    windowsExecutableCandidates: ["Microsoft VS Code/Code.exe", "Programs/Microsoft VS Code/Code.exe"],
  },
  {
    command: "zed",
    darwinAppNames: ["Zed"],
    darwinBundleIdentifiers: ["dev.zed.Zed"],
    id: "zed",
    label: "Zed",
    windowsExecutableCandidates: ["Zed/Zed.exe", "Programs/Zed/Zed.exe"],
  },
  {
    command: "idea",
    darwinAppNames: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA CE"],
    darwinBundleIdentifiers: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    darwinOpenWithArgs: true,
    id: "intellij",
    label: "IntelliJ IDEA",
    windowsExecutableCandidates: [
      "JetBrains/IntelliJ IDEA/bin/idea64.exe",
      "JetBrains/IntelliJ IDEA/bin/idea.exe",
      "Programs/IntelliJ IDEA/bin/idea64.exe",
      "Programs/IntelliJ IDEA/bin/idea.exe",
    ],
  },
  {
    command: "webstorm",
    darwinAppNames: ["WebStorm"],
    darwinBundleIdentifiers: ["com.jetbrains.WebStorm"],
    darwinOpenWithArgs: true,
    id: "webstorm",
    label: "WebStorm",
    windowsExecutableCandidates: [
      "JetBrains/WebStorm/bin/webstorm64.exe",
      "JetBrains/WebStorm/bin/webstorm.exe",
      "Programs/WebStorm/bin/webstorm64.exe",
      "Programs/WebStorm/bin/webstorm.exe",
    ],
  },
  {
    command: "pycharm",
    darwinAppNames: ["PyCharm", "PyCharm Professional", "PyCharm CE"],
    darwinBundleIdentifiers: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    darwinOpenWithArgs: true,
    id: "pycharm",
    label: "PyCharm",
    windowsExecutableCandidates: [
      "JetBrains/PyCharm/bin/pycharm64.exe",
      "JetBrains/PyCharm/bin/pycharm.exe",
      "Programs/PyCharm/bin/pycharm64.exe",
      "Programs/PyCharm/bin/pycharm.exe",
    ],
  },
  {
    command: "goland",
    darwinAppNames: ["GoLand"],
    darwinBundleIdentifiers: ["com.jetbrains.goland"],
    darwinOpenWithArgs: true,
    id: "goland",
    label: "GoLand",
    windowsExecutableCandidates: [
      "JetBrains/GoLand/bin/goland64.exe",
      "JetBrains/GoLand/bin/goland.exe",
      "Programs/GoLand/bin/goland64.exe",
      "Programs/GoLand/bin/goland.exe",
    ],
  },
  {
    command: "phpstorm",
    darwinAppNames: ["PhpStorm"],
    darwinBundleIdentifiers: ["com.jetbrains.phpstorm"],
    darwinOpenWithArgs: true,
    id: "phpstorm",
    label: "PhpStorm",
    windowsExecutableCandidates: [
      "JetBrains/PhpStorm/bin/phpstorm64.exe",
      "JetBrains/PhpStorm/bin/phpstorm.exe",
      "Programs/PhpStorm/bin/phpstorm64.exe",
      "Programs/PhpStorm/bin/phpstorm.exe",
    ],
  },
  {
    command: "rubymine",
    darwinAppNames: ["RubyMine"],
    darwinBundleIdentifiers: ["com.jetbrains.rubymine"],
    darwinOpenWithArgs: true,
    id: "rubymine",
    label: "RubyMine",
    windowsExecutableCandidates: [
      "JetBrains/RubyMine/bin/rubymine64.exe",
      "JetBrains/RubyMine/bin/rubymine.exe",
      "Programs/RubyMine/bin/rubymine64.exe",
      "Programs/RubyMine/bin/rubymine.exe",
    ],
  },
  {
    command: "clion",
    darwinAppNames: ["CLion"],
    darwinBundleIdentifiers: ["com.jetbrains.CLion"],
    darwinOpenWithArgs: true,
    id: "clion",
    label: "CLion",
    windowsExecutableCandidates: [
      "JetBrains/CLion/bin/clion64.exe",
      "JetBrains/CLion/bin/clion.exe",
      "Programs/CLion/bin/clion64.exe",
      "Programs/CLion/bin/clion.exe",
    ],
  },
  {
    command: "rider",
    darwinAppNames: ["Rider"],
    darwinBundleIdentifiers: ["com.jetbrains.rider"],
    darwinOpenWithArgs: true,
    id: "rider",
    label: "Rider",
    windowsExecutableCandidates: [
      "JetBrains/Rider/bin/rider64.exe",
      "JetBrains/Rider/bin/rider.exe",
      "Programs/Rider/bin/rider64.exe",
      "Programs/Rider/bin/rider.exe",
    ],
  },
  {
    command: "studio",
    darwinAppNames: ["Android Studio"],
    darwinBundleIdentifiers: ["com.google.android.studio"],
    darwinOpenWithArgs: true,
    id: "android-studio",
    label: "Android Studio",
    windowsExecutableCandidates: [
      "Android/Android Studio/bin/studio64.exe",
      "Android/Android Studio/bin/studio.exe",
      "Programs/Android Studio/bin/studio64.exe",
      "Programs/Android Studio/bin/studio.exe",
    ],
  },
  {
    command: "subl",
    darwinAppNames: ["Sublime Text"],
    darwinBundleIdentifiers: ["com.sublimetext.4"],
    id: "sublime-text",
    label: "Sublime Text",
    windowsExecutableCandidates: ["Sublime Text/sublime_text.exe", "Programs/Sublime Text/sublime_text.exe"],
  },
  {
    command: "nova",
    darwinAppNames: ["Nova"],
    darwinBundleIdentifiers: ["com.panic.Nova"],
    id: "nova",
    label: "Nova",
  },
  {
    command: null,
    darwinSystemAppPath: "/System/Library/CoreServices/Finder.app",
    id: "file-manager",
    label: "File Manager",
    windowsSystemExecutable: "explorer.exe",
  },
] as const satisfies readonly EditorDefinition[];

export type EditorId = (typeof EDITOR_OPTIONS)[number]["id"];
export interface EditorOption {
  iconDataUrl?: string;
  id: EditorId;
  label: string;
}

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

export interface RenameShellTabInput {
  projectId: string;
  tabId: string;
  title: string;
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
  getSelectedProjectId: () => Promise<string | null>;
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
  renameShellTab: (input: RenameShellTabInput) => Promise<ProjectTabState>;
  removeProjectFromGroup: (projectId: string) => Promise<void>;
  reorderCommands: (input: ReorderCommandsInput) => Promise<ProjectConfigPayload>;
  reorderProjects: (input: ReorderProjectsInput) => Promise<ProjectWithRuntime[]>;
  reorderProjectsInGroup: (input: ReorderProjectsInGroupInput) => Promise<void>;
  reorderRail: (input: ReorderRailInput) => Promise<void>;
  reorderTabs: (input: ReorderTabsInput) => Promise<ProjectTabState>;
  restartProjectStart: (projectId: string) => Promise<void>;
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
