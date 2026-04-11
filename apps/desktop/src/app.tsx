import {
  RiArrowDownSLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiPlayFill,
  RiRefreshLine,
  RiStopFill,
} from "@remixicon/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  type CommandSource,
  GENERAL_SPACE_ID,
  type DesktopUpdateState,
  type EffectiveCommandId,
  isAutoStartCommand,
  type ProjectConfigPayload,
  type ProjectGroupRecord,
  type ProjectTabRecord,
  type ProjectWithRuntime,
  type ResolvedCommandConfig,
  type ShortcutActionId,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@kickstart/contracts";
import { resolveMergedKickstartConfig } from "@kickstart/core";

import { CommandDialog } from "@/components/app/command-dialog";
import { MainContent } from "@/components/app/main-content";
import { ProjectCommandMenu } from "@/components/app/project-command-menu";
import { ProjectDropdown } from "@/components/app/project-dropdown";
import { ProjectRail, type RailItem } from "@/components/app/project-rail";
import { ProjectSidebar } from "@/components/app/project-sidebar";
import { ShortcutsDialog } from "@/components/app/shortcuts-dialog";
import { StartupSplash } from "@/components/app/startup-splash";
import { TitleBar } from "@/components/app/title-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { TooltipProvider } from "@/components/ui/tooltip";
import { commandByTabId, getPreferredCommandTabId } from "@/lib/command-utils";
import { prefersReducedMotion } from "@/lib/media-preferences";
import { reorderByIds, type RelativePosition } from "@/lib/reorder";
import { getShortcutTabIndex } from "@/lib/shortcuts";
import { installSoundAutoplayUnlock, playSound } from "@/lib/sounds";

const GENERAL_SPACE_NAME = "General";
const RELEASES_URL = "https://github.com/paukraft/kickstart/releases/latest";
type CommandDialogState =
  | { mode: "create"; preferredSource: CommandSource }
  | { mode: "edit"; commandId: string }
  | { mode: "list" }
  | null;

// ── Build rail items from projects + groups ───────────────────

function buildRailItems(
  projects: ProjectWithRuntime[],
  groups: ProjectGroupRecord[],
): RailItem[] {
  const groupMap = new Map<string, ProjectGroupRecord>(
    groups.map((g) => [g.id, g]),
  );
  const projectsByGroup = new Map<string, ProjectWithRuntime[]>();
  const ungrouped: ProjectWithRuntime[] = [];

  for (const project of projects) {
    if (project.groupId && groupMap.has(project.groupId)) {
      const list = projectsByGroup.get(project.groupId) ?? [];
      list.push(project);
      projectsByGroup.set(project.groupId, list);
    } else {
      ungrouped.push(project);
    }
  }

  // Build a unified sorted list: ungrouped projects and groups share sort_order space
  const items: (RailItem & { sortOrder: number })[] = [];

  for (const project of ungrouped) {
    items.push({ type: "project", project, sortOrder: project.sortOrder });
  }

  for (const group of groups) {
    const groupProjects = (projectsByGroup.get(group.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    items.push({
      type: "group",
      group,
      projects: groupProjects,
      sortOrder: group.sortOrder,
    });
  }

  items.sort((a, b) => a.sortOrder - b.sortOrder);
  return items;
}

function railItemId(item: RailItem) {
  return item.type === "project" ? item.project.id : item.group.id;
}

export function reorderRailItems(args: {
  railItems: RailItem[];
  sourceId: string;
  targetId: string;
  position: RelativePosition;
}) {
  const reordered = reorderByIds(
    args.railItems.map((item) => ({
      id: railItemId(item),
      item,
    })),
    args.sourceId,
    args.targetId,
    args.position,
  );

  return reordered.map((entry) => ({
    type: entry.item.type,
    id: entry.id,
  }));
}

function shouldShowUpdateBanner(updateState: DesktopUpdateState) {
  return (
    updateState.status === "checking" ||
    updateState.status === "available" ||
    updateState.status === "downloading" ||
    updateState.status === "downloaded" ||
    updateState.status === "error"
  );
}

function getUpdateBannerCopy(updateState: DesktopUpdateState) {
  switch (updateState.status) {
    case "checking":
      return updateState.updateMode === "manual"
        ? "Checking for a new build..."
        : "Checking for updates...";
    case "available":
      return updateState.updateMode === "manual"
        ? updateState.message ?? `Kickstart ${updateState.availableVersion ?? ""} is ready on GitHub.`
        : `Kickstart ${updateState.availableVersion ?? ""} is available.`;
    case "downloading":
      if (updateState.availableVersion) {
        return `Downloading Kickstart ${updateState.availableVersion}${
          updateState.downloadPercent !== null
            ? ` (${Math.round(updateState.downloadPercent)}%)`
            : "..."
        }`;
      }
      return "Downloading update...";
    case "downloaded":
      return `Kickstart ${updateState.downloadedVersion ?? updateState.availableVersion ?? ""} is ready to install.`;
    case "error":
      return updateState.message ?? "Update failed. Try again.";
    default:
      return null;
  }
}

function getUpdateBannerSessionKey(updateState: DesktopUpdateState) {
  switch (updateState.status) {
    case "checking":
      return "checking";
    case "available":
      return `available:${updateState.availableVersion ?? ""}`;
    case "downloading":
      return `downloading:${updateState.availableVersion ?? ""}`;
    case "downloaded":
      return `downloaded:${updateState.downloadedVersion ?? updateState.availableVersion ?? ""}`;
    case "error":
      return `error:${updateState.checkedAt ?? ""}:${updateState.message ?? ""}`;
    default:
      return null;
  }
}

function getSessionEventKey(projectId: string, tabId: string) {
  return `${projectId}:${tabId}`;
}

const ACTION_COMPLETION_CONFIRM_DELAY_MS = 400;
const RUNTIME_EVENT_TYPES = new Set<TerminalEvent["type"]>([
  "started",
  "stopped",
  "cleared",
  "updated",
]);

function showsSidebarStartAction(session: TerminalSessionSnapshot | undefined) {
  return (
    !session ||
    (!session.hasActiveProcess &&
      session.status !== "starting" &&
      session.status !== "stopping")
  );
}

function didActionSidebarTransitionToStart(
  previous: TerminalSessionSnapshot | undefined,
  next: TerminalSessionSnapshot | undefined,
) {
  const previouslyBlocked =
    previous !== undefined && !showsSidebarStartAction(previous);
  return previouslyBlocked && showsSidebarStartAction(next);
}

export function reorderCommandsWithinSection(args: {
  commandTabs: readonly ProjectTabRecord[];
  commands: readonly ResolvedCommandConfig[];
  source: CommandSource;
  sourceId: string;
  targetId: string;
  type: ResolvedCommandConfig["type"];
}): EffectiveCommandId[] {
  const scopedTabs = args.commandTabs.filter((tab) => {
    const command = commandByTabId(args.commands, tab.id);
    if (!command) {
      return false;
    }
    return command.source === args.source && command.type === args.type;
  });
  const reorderedScopedTabs = reorderByIds(scopedTabs, args.sourceId, args.targetId);
  const reorderedScopedCommands = reorderedScopedTabs
    .map((tab) => commandByTabId(args.commands, tab.id))
    .filter((command): command is ResolvedCommandConfig => command !== null);

  let scopedIndex = 0;
  return args.commands
    .map((command) => {
      if (command.source !== args.source || command.type !== args.type) {
        return command;
      }

      const nextCommand = reorderedScopedCommands[scopedIndex];
      scopedIndex += 1;
      return nextCommand ?? command;
    })
    .map((command) => command.id);
}

export function mergeSelectedProjectRuntime(
  project: ProjectWithRuntime | null,
  runtime: Pick<
    ProjectWithRuntime,
    "hasCommands" | "sharedConfigExists" | "startupCommandCount"
  >,
  options?: {
    isCurrentProjectConfig?: boolean;
  },
): ProjectWithRuntime | null {
  if (!project) {
    return null;
  }
  if (!options?.isCurrentProjectConfig) {
    return project;
  }

  return {
    ...project,
    hasCommands: runtime.hasCommands,
    sharedConfigExists: runtime.sharedConfigExists,
    startupCommandCount: runtime.startupCommandCount,
  };
}

export function resolveSelectedProjectId(args: {
  currentSelectedProjectId: string | null;
  keepSelection?: boolean;
  persistedSelectedProjectId: string | null;
  projects: ProjectWithRuntime[];
}) {
  const { currentSelectedProjectId, keepSelection, persistedSelectedProjectId, projects } = args;

  if (keepSelection) {
    if (currentSelectedProjectId === GENERAL_SPACE_ID) {
      return GENERAL_SPACE_ID;
    }
    if (
      currentSelectedProjectId &&
      projects.some((project) => project.id === currentSelectedProjectId)
    ) {
      return currentSelectedProjectId;
    }
  }

  if (persistedSelectedProjectId === GENERAL_SPACE_ID) {
    return GENERAL_SPACE_ID;
  }
  if (
    persistedSelectedProjectId &&
    projects.some((project) => project.id === persistedSelectedProjectId)
  ) {
    return persistedSelectedProjectId;
  }

  return GENERAL_SPACE_ID;
}

export function resolveSelectedTabId(
  nextTabs: ProjectTabRecord[],
  preferredTabId: string | null,
) {
  if (preferredTabId && nextTabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }

  return nextTabs[0]?.id ?? null;
}

export function resolveRefreshedSelectedTabId(args: {
  currentSelectedTabId: string | null;
  nextTabs: ProjectTabRecord[];
  persistedActiveTabId: string | null;
  previousProjectId: string | null;
  projectId: string;
}) {
  const preferredTabId =
    args.previousProjectId === args.projectId
      ? (args.currentSelectedTabId ?? args.persistedActiveTabId)
      : args.persistedActiveTabId;

  return resolveSelectedTabId(args.nextTabs, preferredTabId);
}

export function shouldClearPendingProjectSettingsId(args: {
  pendingProjectSettingsId: string | null;
  selectedProjectId: string | null;
}) {
  return Boolean(
    args.pendingProjectSettingsId &&
      args.selectedProjectId &&
      args.pendingProjectSettingsId !== args.selectedProjectId,
  );
}

export function shouldOpenPendingProjectSettings(args: {
  hydratedProjectId: string | null;
  pendingProjectSettingsId: string | null;
}) {
  return Boolean(
    args.pendingProjectSettingsId &&
      args.hydratedProjectId === args.pendingProjectSettingsId,
  );
}

export function shouldProcessVisibleProjectTerminalEvent(args: {
  displayedProjectId: string | null;
  event: Pick<TerminalEvent, "projectId" | "type">;
}) {
  return Boolean(
    args.displayedProjectId &&
      args.event.projectId === args.displayedProjectId &&
      RUNTIME_EVENT_TYPES.has(args.event.type),
  );
}

export function shouldBlockProjectScopedShortcut(args: {
  actionId: ShortcutActionId;
  isProjectStateLoading: boolean;
}) {
  if (!args.isProjectStateLoading) {
    return false;
  }

  return (
    getShortcutTabIndex(args.actionId) !== null ||
    args.actionId === "new-shell-tab" ||
    args.actionId === "close-tab" ||
    args.actionId === "select-previous-tab" ||
    args.actionId === "select-next-tab" ||
    args.actionId === "open-project-settings"
  );
}

function getDefaultCreateCommandSource(
  projectConfig: ProjectConfigPayload | null,
): CommandSource {
  return projectConfig?.shared.configExists && !projectConfig.shared.configError
    ? "shared"
    : "local";
}

export function getBrokenSharedConfigBanner(args: {
  project: ProjectWithRuntime | null;
  projectConfig: ProjectConfigPayload | null;
  projectConfigProjectId: string | null;
  selectedProjectId: string | null;
}): { detail: string; title: string } | null {
  if (
    !args.project ||
    !args.projectConfig?.shared.configError ||
    !args.selectedProjectId ||
    args.selectedProjectId === GENERAL_SPACE_ID ||
    args.projectConfigProjectId !== args.selectedProjectId
  ) {
    return null;
  }

  return {
    detail: args.projectConfig.shared.configError,
    title: `${args.project.name} has an invalid kickstart.json`,
  };
}

interface ProjectStateSnapshot {
  projectConfig: ProjectConfigPayload | null;
  projectConfigProjectId: string | null;
  selectedTabId: string | null;
  tabs: ProjectTabRecord[];
  terminalSessions: Record<string, TerminalSessionSnapshot>;
}

interface LoadedProjectStateSnapshot {
  persistedActiveTabId: string | null;
  projectConfig: ProjectConfigPayload | null;
  projectConfigProjectId: string | null;
  tabs: ProjectTabRecord[];
  terminalSessions: Record<string, TerminalSessionSnapshot>;
}

export function App() {
  // ── Core state ──────────────────────────────────────────────
  const [showStartupSplash, setShowStartupSplash] = useState(
    () => import.meta.env.MODE !== "test" && !prefersReducedMotion(),
  );
  const [projects, setProjects] = useState<ProjectWithRuntime[]>([]);
  const [groups, setGroups] = useState<ProjectGroupRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [projectConfig, setProjectConfig] =
    useState<ProjectConfigPayload | null>(null);
  const [tabs, setTabs] = useState<ProjectTabRecord[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<
    Record<string, TerminalSessionSnapshot>
  >({});
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
  const [projectConfigProjectId, setProjectConfigProjectId] = useState<string | null>(null);
  // ── Dialog state ────────────────────────────────────────────
  const [commandDialogState, setCommandDialogState] =
    useState<CommandDialogState>(null);
  const [projectCommandMenuOpen, setProjectCommandMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [pendingProjectSettingsId, setPendingProjectSettingsId] = useState<string | null>(null);
  const [pendingShellCloseTabId, setPendingShellCloseTabId] = useState<
    string | null
  >(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(
    null,
  );
  const [updateActionPending, setUpdateActionPending] = useState(false);
  const [dismissedBannerKey, setDismissedBannerKey] = useState<string | null>(
    null,
  );
  const selectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const selectedTabIdRef = useRef<string | null>(selectedTabId);
  const projectListRequestRef = useRef(0);
  const projectStateRequestRef = useRef(0);
  const terminalSessionsRequestRef = useRef(0);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const displayedProjectIdRef = useRef<string | null>(null);
  const projectStateCacheRef = useRef<Record<string, ProjectStateSnapshot>>({});
  const previousTerminalSessionsRef = useRef<Record<string, TerminalSessionSnapshot>>({});
  const latestTerminalSessionsRef = useRef<Record<string, TerminalSessionSnapshot>>({});
  const pendingCompletionSoundTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  selectedProjectIdRef.current = selectedProjectId;
  selectedTabIdRef.current = selectedTabId;
  latestTerminalSessionsRef.current = terminalSessions;

  // ── Derived ─────────────────────────────────────────────────
  const commands = useMemo(
    () => {
      if (!projectConfig) {
        return [];
      }
      return resolveMergedKickstartConfig({
        local: projectConfig.local.config,
        shared: projectConfig.shared.config,
      }).commands;
    },
    [projectConfig],
  );
  const displayedProjectId = hydratedProjectId ?? selectedProjectId;
  const displayedProject = useMemo(
    () =>
      mergeSelectedProjectRuntime(
        projects.find((p) => p.id === displayedProjectId) ?? null,
        {
          hasCommands: commands.length > 0,
          sharedConfigExists: projectConfig?.shared.configExists ?? false,
          startupCommandCount: commands.filter(isAutoStartCommand).length,
        },
        {
          isCurrentProjectConfig:
            displayedProjectId !== null &&
            displayedProjectId !== GENERAL_SPACE_ID &&
            projectConfigProjectId === displayedProjectId,
        },
      ),
    [commands, displayedProjectId, projectConfig, projectConfigProjectId, projects],
  );
  const pendingDeleteProject = useMemo(
    () => projects.find((project) => project.id === pendingDeleteProjectId) ?? null,
    [pendingDeleteProjectId, projects],
  );
  displayedProjectIdRef.current = displayedProjectId;
  const isGeneralSpaceSelected = displayedProjectId === GENERAL_SPACE_ID;
  const isProjectStateLoading =
    selectedProjectId !== null && selectedProjectId !== hydratedProjectId;
  const activeTab =
    tabs.find((t) => t.id === selectedTabId) ??
    tabs[0] ??
    null;
  const activeCommand = activeTab
    ? commandByTabId(commands, activeTab.id)
    : null;
  const commandTabs = tabs.filter((t) => t.kind === "command");
  const shellTabs = tabs.filter((t) => t.kind === "shell");
  const pendingShellCloseTab =
    shellTabs.find((tab) => tab.id === pendingShellCloseTabId) ?? null;
  const railItems = useMemo(
    () => buildRailItems(projects, groups),
    [projects, groups],
  );
  const commandMenuProjects = useMemo(
    () =>
      railItems.flatMap((item) =>
        item.type === "project" ? [item.project] : item.projects,
      ),
    [railItems],
  );
  const projectHeaderControl = displayedProject
    ? displayedProject.runtimeState === "running"
      ? {
          kind: "group" as const,
          restart: {
            ariaLabel: "Restart project commands",
            icon: <RiRefreshLine />,
            onClick: () => void handleRestartProject(),
          },
          stop: {
            icon: <RiStopFill />,
            label: "Stop",
            onClick: () => void handleStopProject(),
            variant: "outline" as const,
          },
        }
      : displayedProject.runtimeState === "starting"
        ? {
            kind: "button" as const,
            button: {
              disabled: true,
              icon: <RiLoader4Line className="animate-spin" />,
              label: "Starting...",
              onClick: () => {},
              variant: "default" as const,
            },
          }
        : displayedProject.runtimeState === "stopping"
          ? {
              kind: "button" as const,
              button: {
                disabled: true,
                icon: <RiLoader4Line className="animate-spin" />,
                label: "Stopping...",
                onClick: () => {},
                variant: "outline" as const,
              },
            }
          : displayedProject.runtimeState === "partially-running"
            ? {
                kind: "button" as const,
                button: {
                  disabled: false,
                  icon: <RiPlayFill />,
                  label: "Start Missing",
                  onClick: () => void handleRunProject(),
                  variant: "default" as const,
                },
              }
            : {
                kind: "button" as const,
                button: {
                  disabled: displayedProject.startupCommandCount === 0,
                  icon: <RiPlayFill />,
                  label: "Start",
                  onClick: () => void handleRunProject(),
                  variant: "default" as const,
                },
              }
    : null;

  // ── Data fetching ───────────────────────────────────────────
  function mapSessionsByTabId(sessions: TerminalSessionSnapshot[]) {
    return Object.fromEntries(
      sessions.map((session) => [session.tabId, session]),
    );
  }

  function applyProjectStateSnapshot(
    projectId: string,
    snapshot: ProjectStateSnapshot,
  ) {
    setProjectConfig(snapshot.projectConfig);
    setProjectConfigProjectId(snapshot.projectConfigProjectId);
    setTerminalSessions(snapshot.terminalSessions);
    setTabs(snapshot.tabs);
    setSelectedTabId(snapshot.selectedTabId);
    setHydratedProjectId(projectId);
    hydratedProjectIdRef.current = projectId;
  }

  async function loadProjectStateSnapshot(
    projectId: string,
  ): Promise<LoadedProjectStateSnapshot> {
    if (projectId === GENERAL_SPACE_ID) {
      const [sessions, tabs] = await Promise.all([
        window.desktop.getProjectTerminalSessions(projectId),
        window.desktop.getProjectTabs(projectId),
      ]);

      return {
        persistedActiveTabId: tabs.activeTabId,
        projectConfig: null,
        projectConfigProjectId: null,
        tabs: tabs.tabs,
        terminalSessions: mapSessionsByTabId(sessions),
      };
    }

    const [config, sessions, tabs] = await Promise.all([
      window.desktop.getProjectConfig(projectId),
      window.desktop.getProjectTerminalSessions(projectId),
      window.desktop.getProjectTabs(projectId),
    ]);

    return {
      persistedActiveTabId: tabs.activeTabId,
      projectConfig: config,
      projectConfigProjectId: projectId,
      tabs: tabs.tabs,
      terminalSessions: mapSessionsByTabId(sessions),
    };
  }

  async function refreshProjects(options?: { keepSelection?: boolean }) {
    const requestId = ++projectListRequestRef.current;
    const [items, groupItems, persistedSelectedProjectId] = await Promise.all([
      window.desktop.listProjects(),
      window.desktop.listGroups(),
      window.desktop.getSelectedProjectId(),
    ]);
    if (requestId !== projectListRequestRef.current) {
      return { groups: groupItems, projects: items };
    }
    const nextProjectIds = new Set([
      GENERAL_SPACE_ID,
      ...items.map((project) => project.id),
    ]);
    for (const projectId of Object.keys(projectStateCacheRef.current)) {
      if (!nextProjectIds.has(projectId)) {
        delete projectStateCacheRef.current[projectId];
      }
    }
    setProjects(items);
    setGroups(groupItems);
    setSelectedProjectId((current) => {
      return resolveSelectedProjectId({
        currentSelectedProjectId: current,
        keepSelection: options?.keepSelection,
        persistedSelectedProjectId,
        projects: items,
      });
    });
    return { groups: groupItems, projects: items };
  }

  async function refreshProjectState(projectId: string) {
    const requestId = ++projectStateRequestRef.current;
    const snapshot = await loadProjectStateSnapshot(projectId);
    if (
      requestId !== projectStateRequestRef.current ||
      selectedProjectIdRef.current !== projectId
    ) {
      return;
    }
    const previousProjectId = hydratedProjectIdRef.current;
    applyProjectStateSnapshot(projectId, {
      projectConfig: snapshot.projectConfig,
      projectConfigProjectId: snapshot.projectConfigProjectId,
      selectedTabId: resolveRefreshedSelectedTabId({
        currentSelectedTabId: selectedTabIdRef.current,
        nextTabs: snapshot.tabs,
        persistedActiveTabId: snapshot.persistedActiveTabId,
        previousProjectId,
        projectId,
      }),
      tabs: snapshot.tabs,
      terminalSessions: snapshot.terminalSessions,
    });
  }

  useEffect(() => {
    const missingProjectIds = projects
      .map((project) => project.id)
      .filter(
        (projectId) =>
          projectId !== selectedProjectId &&
          !projectStateCacheRef.current[projectId],
      );
    if (missingProjectIds.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const projectId of missingProjectIds) {
        if (cancelled || projectStateCacheRef.current[projectId]) {
          continue;
        }

        const snapshot = await loadProjectStateSnapshot(projectId);
        if (cancelled || projectStateCacheRef.current[projectId]) {
          continue;
        }

        projectStateCacheRef.current[projectId] = {
          projectConfig: snapshot.projectConfig,
          projectConfigProjectId: snapshot.projectConfigProjectId,
          selectedTabId: resolveSelectedTabId(
            snapshot.tabs,
            snapshot.persistedActiveTabId,
          ),
          tabs: snapshot.tabs,
          terminalSessions: snapshot.terminalSessions,
        };
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!hydratedProjectId) {
      return;
    }

    projectStateCacheRef.current[hydratedProjectId] = {
      projectConfig,
      projectConfigProjectId,
      selectedTabId,
      tabs,
      terminalSessions,
    };
  }, [
    hydratedProjectId,
    projectConfig,
    projectConfigProjectId,
    selectedTabId,
    tabs,
    terminalSessions,
  ]);

  async function refreshTerminalSessions(projectId: string) {
    const requestId = ++terminalSessionsRequestRef.current;
    const sessions = await window.desktop.getProjectTerminalSessions(projectId);
    if (
      requestId !== terminalSessionsRequestRef.current ||
      displayedProjectIdRef.current !== projectId
    ) {
      return;
    }
    setTerminalSessions(mapSessionsByTabId(sessions));
  }

  const refreshSelectedProjectRuntime = useEffectEvent(
    async (projectId: string) => {
      await refreshTerminalSessions(projectId);
      if (displayedProjectIdRef.current !== projectId) {
        return;
      }
      await refreshProjects({ keepSelection: true });
    },
  );

  const fetchProjectRuntime = useEffectEvent(async (projectId: string) => {
    const [nextTabs, sessions, config] = await Promise.all([
      window.desktop.getProjectTabs(projectId),
      window.desktop.getProjectTerminalSessions(projectId),
      window.desktop.getProjectConfig(projectId),
    ]);
    return {
      tabs: nextTabs,
      sessions,
      commands: resolveMergedKickstartConfig({
        local: config.local.config,
        shared: config.shared.config,
      }).commands,
    };
  });

  const playActionCompletionSound = useEffectEvent(
    async (projectId: string, tabId: string) => {
      const [runtime, sessions] = await Promise.all([
        fetchProjectRuntime(projectId),
        window.desktop.getProjectTerminalSessions(projectId),
      ]);
      const session = sessions.find((item) => item.tabId === tabId);
      if (!showsSidebarStartAction(session)) {
        return;
      }
      const tab = runtime.tabs.tabs.find((item) => item.id === tabId);
      if (!tab?.commandId) {
        return;
      }
      const command = runtime.commands.find((item) => item.id === tab.commandId);
      if (command?.type !== "action" || !command.soundId) {
        return;
      }
      await playSound(command.soundId);
    },
  );
  const dismissStartupSplash = useEffectEvent(() => {
    setShowStartupSplash(false);
  });

  // ── Effects ─────────────────────────────────────────────────
  useEffect(() => {
    installSoundAutoplayUnlock();
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(pendingCompletionSoundTimersRef.current)) {
        clearTimeout(timer);
      }
      pendingCompletionSoundTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    let mounted = true;

    void window.desktop.getUpdateState().then((state) => {
      if (mounted) {
        setUpdateState(state);
      }
    });

    const unsubscribe = window.desktop.onUpdateState((state) => {
      setUpdateState(state);
      if (state.status !== "checking" && state.status !== "downloading") {
        setUpdateActionPending(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return window.desktop.watchTerminalEvents((event) => {
      if (!shouldProcessVisibleProjectTerminalEvent({ displayedProjectId, event })) {
        return;
      }
      void refreshSelectedProjectRuntime(event.projectId);
    });
  }, [displayedProjectId]);

  useEffect(() => {
    if (!displayedProjectId) {
      previousTerminalSessionsRef.current = {};
      return;
    }

    const previousSessions = previousTerminalSessionsRef.current;

    for (const [tabId, session] of Object.entries(terminalSessions)) {
      const previousSession = previousSessions[tabId];
      if (!didActionSidebarTransitionToStart(previousSession, session)) {
        continue;
      }

      const tab = tabs.find((item) => item.id === tabId);
      if (!tab?.commandId) {
        continue;
      }
      const command = commands.find((item) => item.id === tab.commandId);
      if (command?.type !== "action" || !command.soundId) {
        continue;
      }

      const key = getSessionEventKey(displayedProjectId, tabId);
      const pendingTimer = pendingCompletionSoundTimersRef.current[key];
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
      pendingCompletionSoundTimersRef.current[key] = setTimeout(() => {
        const latestSession = latestTerminalSessionsRef.current[tabId];
        if (didActionSidebarTransitionToStart(previousSession, latestSession)) {
          void playActionCompletionSound(displayedProjectId, tabId);
        }
        delete pendingCompletionSoundTimersRef.current[key];
      }, ACTION_COMPLETION_CONFIRM_DELAY_MS);
    }

    for (const [key, timer] of Object.entries(pendingCompletionSoundTimersRef.current)) {
      const tabId = key.split(":").slice(1).join(":");
      const session = terminalSessions[tabId];
      if (!showsSidebarStartAction(session)) {
        clearTimeout(timer);
        delete pendingCompletionSoundTimersRef.current[key];
      }
    }

    previousTerminalSessionsRef.current = terminalSessions;
  }, [commands, displayedProjectId, tabs, terminalSessions]);

  useEffect(() => {
    if (
      shouldClearPendingProjectSettingsId({
        pendingProjectSettingsId,
        selectedProjectId,
      })
    ) {
      setPendingProjectSettingsId(null);
    }
  }, [pendingProjectSettingsId, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectConfig(null);
      setProjectConfigProjectId(null);
      setTerminalSessions({});
      setTabs([]);
      setSelectedTabId(null);
      setHydratedProjectId(null);
      setPendingProjectSettingsId(null);
      setPendingShellCloseTabId(null);
      hydratedProjectIdRef.current = null;
      return;
    }

    if (hydratedProjectIdRef.current !== selectedProjectId) {
      const cachedState = projectStateCacheRef.current[selectedProjectId];
      if (cachedState) {
        applyProjectStateSnapshot(selectedProjectId, cachedState);
        previousTerminalSessionsRef.current = cachedState.terminalSessions;
      }
      setPendingShellCloseTabId(null);
      setCommandDialogState(null);
    }

    void window.desktop.selectProject({ projectId: selectedProjectId });
    void Promise.all([
      refreshProjectState(selectedProjectId),
      refreshProjects({ keepSelection: true }),
    ]);
  }, [selectedProjectId]);

  useEffect(() => {
    if (
      shouldOpenPendingProjectSettings({
        hydratedProjectId,
        pendingProjectSettingsId,
      })
    ) {
      setPendingProjectSettingsId(null);
      setCommandDialogState({ mode: "list" });
    }
  }, [hydratedProjectId, pendingProjectSettingsId]);

  useEffect(() => {
    const unsubscribe = window.desktop.watchConfig((payload) => {
      const cachedState = projectStateCacheRef.current[payload.projectId];
      const nextSelectedTabId = resolveSelectedTabId(
        payload.tabs,
        cachedState?.selectedTabId ??
          (payload.projectId === displayedProjectIdRef.current
            ? selectedTabIdRef.current
            : null),
      );
      projectStateCacheRef.current[payload.projectId] = {
        projectConfig: {
          hasCommands: payload.hasCommands,
          local: payload.local,
          shared: payload.shared,
        },
        projectConfigProjectId: payload.projectId,
        selectedTabId: nextSelectedTabId,
        tabs: payload.tabs,
        terminalSessions: cachedState?.terminalSessions ?? {},
      };

      if (payload.projectId === displayedProjectIdRef.current) {
        setProjectConfig({
          hasCommands: payload.hasCommands,
          local: payload.local,
          shared: payload.shared,
        });
        setProjectConfigProjectId(payload.projectId);
        setTabs(payload.tabs);
        setSelectedTabId(nextSelectedTabId);
      }
      void refreshProjects({ keepSelection: true });
    });
    return unsubscribe;
  }, []);

  // ── Handlers ────────────────────────────────────────────────
  async function handleAddProject() {
    const folderPath = await window.desktop.selectFolder();
    if (!folderPath) return;
    const created = await window.desktop.createProject({ path: folderPath });
    await refreshProjects({ keepSelection: true });
    if (created?.id) setSelectedProjectId(created.id);
  }

  async function handleDeleteProject() {
    if (!pendingDeleteProjectId) return;
    await window.desktop.deleteProject(pendingDeleteProjectId);
    setDeleteDialogOpen(false);
    setPendingDeleteProjectId(null);
    await refreshProjects(
      pendingDeleteProjectId === selectedProjectId
        ? undefined
        : { keepSelection: true },
    );
  }

  async function handleCreateConfig() {
    if (!displayedProject) return;
    const payload = await window.desktop.createProjectConfig(
      displayedProject.id,
    );
    setProjectConfig(payload);
    setProjectConfigProjectId(displayedProject.id);
    await refreshProjectState(displayedProject.id);
    openCreateCommandDialog("shared");
  }

  async function handleSelectTab(tabId: string) {
    if (!selectedProjectId) return;
    setSelectedTabId(tabId);
    await window.desktop.selectTab({ projectId: selectedProjectId, tabId });
  }

  async function handleRunProject() {
    if (!displayedProject) return;
    await window.desktop.runProjectStart(displayedProject.id);
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleStopProject() {
    if (!displayedProject) return;
    await window.desktop.stopProjectStart(displayedProject.id);
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleRestartProject() {
    if (!displayedProject) return;
    await window.desktop.restartProjectStart(displayedProject.id);
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleRunTab(tab: ProjectTabRecord) {
    if (!displayedProject) return;
    await window.desktop.runTerminalCommand({
      projectId: displayedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleRestartTab(tab: ProjectTabRecord) {
    if (!displayedProject) return;
    await window.desktop.restartTerminalCommand({
      projectId: displayedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleStopTab(tab: ProjectTabRecord) {
    if (!displayedProject) return;
    await window.desktop.stopTerminalCommand({
      projectId: displayedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(displayedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleCreateShellTab() {
    if (!selectedProjectId) return;
    const nextState = await window.desktop.createShellTab({
      projectId: selectedProjectId,
    });
    setTabs(nextState.tabs);
    setSelectedTabId(resolveSelectedTabId(nextState.tabs, nextState.activeTabId));
    await refreshTerminalSessions(selectedProjectId);
  }

  async function handleDeleteShellTab(tabId: string) {
    if (!selectedProjectId) return;
    const isClosingActiveTab = activeTab?.id === tabId;
    const nextState = await window.desktop.deleteShellTab(
      selectedProjectId,
      tabId,
    );
    const hasShellTabsRemaining = nextState.tabs.some(
      (tab) => tab.kind === "shell",
    );
    const preferredTabId =
      isClosingActiveTab && !hasShellTabsRemaining
        ? getPreferredCommandTabId(commands, nextState.tabs)
        : null;
    const nextActiveTabId = preferredTabId ?? nextState.activeTabId;

    setTabs(nextState.tabs);
    setSelectedTabId((current) =>
      current === tabId
        ? nextActiveTabId
        : resolveSelectedTabId(nextState.tabs, current ?? nextActiveTabId),
    );
    if (preferredTabId && preferredTabId !== nextState.activeTabId) {
      await window.desktop.selectTab({
        projectId: selectedProjectId,
        tabId: preferredTabId,
      });
    }
    await refreshTerminalSessions(selectedProjectId);
  }

  async function handleRenameShellTab(tabId: string, title: string) {
    if (!selectedProjectId) return;
    const nextState = await window.desktop.renameShellTab({
      projectId: selectedProjectId,
      tabId,
      title,
    });
    setTabs(nextState.tabs);
    setSelectedTabId((current) =>
      resolveSelectedTabId(nextState.tabs, current ?? nextState.activeTabId),
    );
  }

  function requestDeleteShellTab(tabId: string) {
    const session = terminalSessions[tabId];
    if (session?.status === "stopping") {
      return;
    }
    if (session?.hasActiveProcess) {
      setPendingShellCloseTabId(tabId);
      return;
    }
    void handleDeleteShellTab(tabId);
  }

  async function confirmDeleteShellTab() {
    if (!pendingShellCloseTabId) return;
    const tabId = pendingShellCloseTabId;
    setPendingShellCloseTabId(null);
    await handleDeleteShellTab(tabId);
  }

  async function handleSelectAdjacentTab(offset: -1 | 1) {
    if (tabs.length === 0) return;
    const currentIndex = activeTab
      ? tabs.findIndex((tab) => tab.id === activeTab.id)
      : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex =
      (baseIndex + offset + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    await handleSelectTab(nextTab.id);
  }

  async function handleSelectTabByIndex(index: number) {
    if (index < 0) return;
    const nextTab = tabs[index];
    if (!nextTab) return;
    await handleSelectTab(nextTab.id);
  }

  async function handleShortcutAction(actionId: ShortcutActionId) {
    if (actionId === "toggle-project-command-menu") {
      if (
        commandDialogState !== null ||
        deleteDialogOpen ||
        shortcutsDialogOpen ||
        pendingShellCloseTab
      ) {
        return;
      }
      setProjectCommandMenuOpen((current) => !current);
      return;
    }

    if (actionId === "show-keyboard-shortcuts") {
      setShortcutsDialogOpen(true);
      return;
    }

    if (actionId === "close-tab") {
      if (shortcutsDialogOpen) {
        setShortcutsDialogOpen(false);
        return;
      }
      if (commandDialogState) {
        setCommandDialogState(null);
        return;
      }
      if (projectCommandMenuOpen) {
        setProjectCommandMenuOpen(false);
        return;
      }
      if (deleteDialogOpen) {
        setDeleteDialogOpen(false);
        return;
      }
      if (pendingShellCloseTab) {
        setPendingShellCloseTabId(null);
        return;
      }
    }

    const blockingDialogOpen =
      projectCommandMenuOpen ||
      commandDialogState !== null ||
      deleteDialogOpen ||
      shortcutsDialogOpen ||
      Boolean(pendingShellCloseTab);

    if (blockingDialogOpen) {
      return;
    }

    if (
      shouldBlockProjectScopedShortcut({
        actionId,
        isProjectStateLoading,
      })
    ) {
      return;
    }

    const shortcutTabIndex = getShortcutTabIndex(actionId);
    if (shortcutTabIndex !== null) {
      await handleSelectTabByIndex(shortcutTabIndex);
      return;
    }

    if (actionId === "new-shell-tab") {
      await handleCreateShellTab();
      return;
    }

    if (actionId === "close-tab") {
      if (activeTab?.kind === "shell") {
        requestDeleteShellTab(activeTab.id);
      }
      return;
    }

    if (actionId === "select-previous-tab") {
      await handleSelectAdjacentTab(-1);
      return;
    }

    if (actionId === "select-next-tab") {
      await handleSelectAdjacentTab(1);
      return;
    }

    if (actionId === "open-project") {
      await handleAddProject();
      return;
    }

    if (
      actionId === "open-project-settings" &&
      selectedProjectId &&
      selectedProjectId !== GENERAL_SPACE_ID
    ) {
      openProjectSettings(selectedProjectId);
    }
  }

  // ── Rail drag-drop handlers ─────────────────────────────────

  async function handleDropProjectOnProject(
    sourceId: string,
    targetId: string,
  ) {
    const source = projects.find((p) => p.id === sourceId);
    const target = projects.find((p) => p.id === targetId);
    if (!source || !target) return;

    if (source.groupId && target.groupId && source.groupId === target.groupId) {
      // Both in same group → reorder
      await window.desktop.reorderProjectsInGroup({
        groupId: source.groupId,
        projectIds: reorderByIds(
          projects.filter((p) => p.groupId === source.groupId),
          sourceId,
          targetId,
        ).map((p) => p.id),
      });
    } else if (target.groupId) {
      // Target is in a group → move source into that group
      await window.desktop.moveProjectToGroup({
        projectId: sourceId,
        groupId: target.groupId,
      });
    } else if (source.groupId && !target.groupId) {
      // Source in group, target ungrouped → ungroup first, then place it relative to the target
      await window.desktop.removeProjectFromGroup(sourceId);
      const snapshot = await refreshProjects({ keepSelection: true });
      const reordered = reorderByIds(
        buildRailItems(snapshot.projects, snapshot.groups).map((item) => ({
          id: item.type === "project" ? item.project.id : item.group.id,
          item,
        })),
        sourceId,
        targetId,
      );
      await window.desktop.reorderRail({
        items: reordered.map((entry) => ({
          id: entry.id,
          type: entry.item.type,
        })),
      });
    } else {
      // Both ungrouped → create group
      await window.desktop.createGroupFromProjects({
        projectIdA: sourceId,
        projectIdB: targetId,
      });
    }
    await refreshProjects({ keepSelection: true });
  }

  async function handleDropProjectOnGroup(
    projectId: string,
    groupId: string,
    targetProjectId?: string,
    position?: RelativePosition,
  ) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || (project.groupId === groupId && !targetProjectId)) return;

    if (targetProjectId && position) {
      const targetGroupProjects = projects.filter(
        (p) => p.groupId === groupId && p.id !== projectId,
      );
      const reordered = reorderByIds(
        [...targetGroupProjects, { ...project, groupId }],
        projectId,
        targetProjectId,
        position,
      );
      if (project.groupId !== groupId) {
        await window.desktop.moveProjectToGroup({ projectId, groupId });
      }
      await window.desktop.reorderProjectsInGroup({
        groupId,
        projectIds: reordered.map((p) => p.id),
      });
      await refreshProjects({ keepSelection: true });
      return;
    }

    await window.desktop.moveProjectToGroup({ projectId, groupId });
    await refreshProjects({ keepSelection: true });
  }

  async function handleDropOnRail(projectId: string) {
    await window.desktop.removeProjectFromGroup(projectId);
    await refreshProjects({ keepSelection: true });
  }

  async function handleDropProjectOnRailPosition(
    projectId: string,
    targetItem: RailItem,
    position: RelativePosition,
  ) {
    await window.desktop.removeProjectFromGroup(projectId);
    const snapshot = await refreshProjects({ keepSelection: true });
    const nextRailItems = buildRailItems(snapshot.projects, snapshot.groups);
    await window.desktop.reorderRail({
      items: reorderRailItems({
        railItems: nextRailItems,
        sourceId: projectId,
        targetId: railItemId(targetItem),
        position,
      }),
    });
    await refreshProjects({ keepSelection: true });
  }

  async function handleDropProjectOnRailTail(projectId: string) {
    await window.desktop.removeProjectFromGroup(projectId);
    const snapshot = await refreshProjects({ keepSelection: true });
    const nextRailItems = buildRailItems(snapshot.projects, snapshot.groups);
    const lastItem = nextRailItems.at(-1);
    if (!lastItem) return;
    if (railItemId(lastItem) === projectId) return;
    await window.desktop.reorderRail({
      items: reorderRailItems({
        railItems: nextRailItems,
        sourceId: projectId,
        targetId: railItemId(lastItem),
        position: "after",
      }),
    });
    await refreshProjects({ keepSelection: true });
  }

  async function handleToggleGroupCollapsed(groupId: string) {
    await window.desktop.toggleGroupCollapsed(groupId);
    setGroups(await window.desktop.listGroups());
  }

  async function handleReorderRail(
    sourceItem: RailItem,
    targetItem: RailItem,
    position: RelativePosition,
  ) {
    await window.desktop.reorderRail({
      items: reorderRailItems({
        railItems,
        sourceId: railItemId(sourceItem),
        targetId: railItemId(targetItem),
        position,
      }),
    });
    await refreshProjects({ keepSelection: true });
  }

  async function handleReorderInGroup(
    groupId: string,
    sourceId: string,
    targetId: string,
    position: RelativePosition,
  ) {
    const groupProjects = projects.filter((p) => p.groupId === groupId);
    const reordered = reorderByIds(groupProjects, sourceId, targetId, position);
    await window.desktop.reorderProjectsInGroup({
      groupId,
      projectIds: reordered.map((p) => p.id),
    });
    await refreshProjects({ keepSelection: true });
  }

  async function handleReorderCommands(
    source: CommandSource,
    type: ResolvedCommandConfig["type"],
    sourceId: string,
    targetId: string,
  ) {
    if (!displayedProject || sourceId === targetId) return;
    const next = reorderCommandsWithinSection({
      commandTabs,
      commands,
      source,
      sourceId,
      targetId,
      type,
    });
    await window.desktop.reorderCommands({
      commandIds: next,
      projectId: displayedProject.id,
    });
    await refreshProjectState(displayedProject.id);
  }

  async function handleReorderShellTabs(sourceId: string, targetId: string) {
    if (!selectedProjectId || sourceId === targetId) return;
    const next = reorderByIds(shellTabs, sourceId, targetId);
    const nextState = await window.desktop.reorderTabs({
      projectId: selectedProjectId,
      tabIds: next.map((tab) => tab.id),
    });
    setTabs(nextState.tabs);
    setSelectedTabId((current) =>
      resolveSelectedTabId(nextState.tabs, current ?? nextState.activeTabId),
    );
  }

  function openCreateCommandDialog(
    preferredSource: CommandSource = getDefaultCreateCommandSource(projectConfig),
  ) {
    setCommandDialogState({ mode: "create", preferredSource });
  }

  function openProjectSettings(projectId: string) {
    setSelectedProjectId(projectId);
    if (hydratedProjectIdRef.current === projectId) {
      setPendingProjectSettingsId(null);
      setCommandDialogState({ mode: "list" });
      return;
    }

    setCommandDialogState(null);
    setPendingProjectSettingsId(projectId);
  }

  function requestDeleteProject(projectId: string) {
    setPendingDeleteProjectId(projectId);
    setDeleteDialogOpen(true);
  }

  function openEditCommandDialog(command: ResolvedCommandConfig) {
    setCommandDialogState({ mode: "edit", commandId: command.id });
  }

  async function handleCommandsChanged() {
    if (!displayedProject) return;
    await refreshProjectState(displayedProject.id);
  }

  const onShortcutAction = useEffectEvent((actionId: ShortcutActionId) => {
    void handleShortcutAction(actionId);
  });

  useEffect(() => {
    return window.desktop.watchShortcutActions((actionId) => {
      onShortcutAction(actionId);
    });
  }, []);

  async function handleCheckForUpdates() {
    setUpdateActionPending(true);
    try {
      await window.desktop.checkForUpdates();
    } finally {
      setUpdateActionPending(false);
    }
  }

  async function handleInstallUpdate() {
    setUpdateActionPending(true);
    try {
      await window.desktop.installUpdate();
    } finally {
      setUpdateActionPending(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────
  const updateBannerCopy = updateState
    ? getUpdateBannerCopy(updateState)
    : null;
  const updateBannerKey = updateState
    ? getUpdateBannerSessionKey(updateState)
    : null;
  const isUpdateBannerDismissed =
    updateBannerKey !== null && updateBannerKey === dismissedBannerKey;
  const brokenSharedConfigBanner = getBrokenSharedConfigBanner({
    project: displayedProject,
    projectConfig,
    projectConfigProjectId,
    selectedProjectId: displayedProjectId,
  });

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        <StartupSplash
          visible={showStartupSplash}
          onComplete={dismissStartupSplash}
        />

        <TitleBar />

        {updateState &&
        shouldShowUpdateBanner(updateState) &&
        updateBannerCopy &&
        !isUpdateBannerDismissed ? (
          <div className="border-b bg-muted/50 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{updateBannerCopy}</p>
                {updateState.status === "error" && updateState.checkedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last checked{" "}
                    {new Date(updateState.checkedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {updateState.status === "error" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={updateActionPending}
                    onClick={() => void handleCheckForUpdates()}
                  >
                    Check Again
                  </Button>
                ) : null}

                {updateState.status === "available" ? (
                  updateState.updateMode === "manual" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void window.desktop.openExternalUrl(RELEASES_URL)}
                    >
                      Get Latest Build
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      disabled={updateActionPending}
                      onClick={() => void window.desktop.downloadUpdate()}
                    >
                      Update
                    </Button>
                  )
                ) : null}

                {updateState.status === "downloaded" ? (
                  <Button
                    size="xs"
                    disabled={updateActionPending}
                    onClick={() => void handleInstallUpdate()}
                  >
                    Restart to Update
                  </Button>
                ) : null}

                {updateBannerKey ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dismiss banner"
                    onClick={() => {
                      setDismissedBannerKey(updateBannerKey);
                    }}
                  >
                    <RiCloseLine />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {brokenSharedConfigBanner ? (
          <div className="border-b border-amber-500/20 bg-amber-500/8 px-3 py-2 text-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400">
                <RiErrorWarningLine className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {brokenSharedConfigBanner.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  Shared commands are unavailable until the file is fixed.
                </p>
                <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                  {brokenSharedConfigBanner.detail}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <ProjectRail
            railItems={railItems}
            selectedProjectId={selectedProjectId}
            generalSpaceId={GENERAL_SPACE_ID}
            onSelect={setSelectedProjectId}
            onAdd={() => void handleAddProject()}
            onDropProjectOnProject={(s, t) =>
              void handleDropProjectOnProject(s, t)
            }
            onDropProjectOnGroup={(p, g, t, pos) =>
              void handleDropProjectOnGroup(p, g, t, pos)
            }
            onDropOnRail={(id) => void handleDropOnRail(id)}
            onDropProjectOnRailPosition={(projectId, targetItem, position) =>
              void handleDropProjectOnRailPosition(
                projectId,
                targetItem,
                position,
              )
            }
            onDropProjectOnRailTail={(projectId) =>
              void handleDropProjectOnRailTail(projectId)
            }
            onToggleGroupCollapsed={(id) => void handleToggleGroupCollapsed(id)}
            onReorderRail={(s, t, p) => void handleReorderRail(s, t, p)}
            onReorderInGroup={(g, s, t, p) =>
              void handleReorderInGroup(g, s, t, p)
            }
            fetchProjectRuntime={fetchProjectRuntime}
            onOpenProjectSettings={openProjectSettings}
            onDeleteProject={requestDeleteProject}
          />

          {/* Detail sidebar */}
          <aside
            className={[
              "flex min-h-0 w-72 shrink-0 flex-col overflow-hidden border-r p-3",
              isProjectStateLoading
                ? "pointer-events-none"
                : "pointer-events-auto",
            ].join(" ")}
          >
            <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 bg-background">
              {displayedProject ? (
                <ProjectDropdown
                  mode="dropdown-menu"
                  project={displayedProject}
                  triggerClassName="desktop-no-drag inline-flex max-w-[14rem] items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-accent"
                  onOpenSettings={openProjectSettings}
                  onDeleteProject={requestDeleteProject}
                >
                  <div className="inline-flex max-w-[14rem] items-center gap-1">
                    <h1 className="min-w-0 truncate text-sm font-semibold">
                      {displayedProject.name}
                    </h1>
                    <RiArrowDownSLine className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </ProjectDropdown>
              ) : (
                <h1 className="px-1 py-0.5 text-sm font-semibold text-muted-foreground">
                  {isGeneralSpaceSelected ? GENERAL_SPACE_NAME : "No Project"}
                </h1>
              )}

              {projectHeaderControl?.kind === "group" ? (
                <ButtonGroup className="desktop-no-drag shrink-0">
                  <Button
                    aria-label={projectHeaderControl.restart.ariaLabel}
                    className="shrink-0"
                    size="icon-xs"
                    variant="outline"
                    onClick={projectHeaderControl.restart.onClick}
                  >
                    {projectHeaderControl.restart.icon}
                  </Button>
                  <Button
                    className="shrink-0"
                    size="xs"
                    variant={projectHeaderControl.stop.variant}
                    onClick={projectHeaderControl.stop.onClick}
                  >
                    {projectHeaderControl.stop.icon}
                    {projectHeaderControl.stop.label}
                  </Button>
                </ButtonGroup>
              ) : projectHeaderControl ? (
                <Button
                  className="desktop-no-drag shrink-0"
                  disabled={projectHeaderControl.button.disabled}
                  size="xs"
                  variant={projectHeaderControl.button.variant}
                  onClick={projectHeaderControl.button.onClick}
                >
                  {projectHeaderControl.button.icon}
                  {projectHeaderControl.button.label}
                </Button>
              ) : null}

              <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                  setDeleteDialogOpen(open);
                  if (!open) {
                    setPendingDeleteProjectId(null);
                  }
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove <strong>{pendingDeleteProject?.name}</strong>{" "}
                      from Kickstart. Your files on disk won't be affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void handleDeleteProject()}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {displayedProject ? (
              <ProjectSidebar
                project={displayedProject}
                commands={commands}
                commandTabs={commandTabs}
                shellTabs={shellTabs}
                activeTabId={activeTab?.id ?? null}
                terminalSessions={terminalSessions}
                onSelectTab={(id) => void handleSelectTab(id)}
                onRunTab={(tab) => void handleRunTab(tab)}
                onRestartTab={(tab) => void handleRestartTab(tab)}
                onStopTab={(tab) => void handleStopTab(tab)}
                onEditCommand={openEditCommandDialog}
                onAddCommand={() => openCreateCommandDialog()}
                onCreateShellTab={() => void handleCreateShellTab()}
                onDeleteShellTab={requestDeleteShellTab}
                onRenameShellTab={(tabId, title) => void handleRenameShellTab(tabId, title)}
                onReorderCommands={(source, type, sourceId, targetId) =>
                  void handleReorderCommands(source, type, sourceId, targetId)
                }
                onReorderShellTabs={(sourceId, targetId) =>
                  void handleReorderShellTabs(sourceId, targetId)
                }
              />
            ) : isGeneralSpaceSelected ? (
              <ProjectSidebar
                project={null}
                commands={[]}
                commandTabs={[]}
                shellTabs={shellTabs}
                activeTabId={activeTab?.id ?? null}
                terminalSessions={terminalSessions}
                showCommands={false}
                onSelectTab={(id) => void handleSelectTab(id)}
                onRunTab={() => undefined}
                onRestartTab={() => undefined}
                onStopTab={() => undefined}
                onEditCommand={() => undefined}
                onAddCommand={() => undefined}
                onCreateShellTab={() => void handleCreateShellTab()}
                onDeleteShellTab={requestDeleteShellTab}
                onRenameShellTab={(tabId, title) => void handleRenameShellTab(tabId, title)}
                onReorderCommands={() => undefined}
                onReorderShellTabs={(sourceId, targetId) =>
                  void handleReorderShellTabs(sourceId, targetId)
                }
              />
            ) : (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyTitle>Add a project to get started</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </aside>

          {/* Main content */}
          <main
            className={[
              "min-h-0 flex-1",
              isProjectStateLoading
                ? "pointer-events-none"
                : "pointer-events-auto",
            ].join(" ")}
          >
            {
              <MainContent
                project={displayedProject}
                workspaceId={displayedProjectId}
                workspaceName={
                  isGeneralSpaceSelected ? GENERAL_SPACE_NAME : undefined
                }
                hasCommands={isGeneralSpaceSelected ? true : (projectConfig?.hasCommands ?? false)}
                sharedConfigError={
                  isGeneralSpaceSelected
                    ? null
                    : (projectConfig?.shared.configError ?? null)
                }
                sharedConfigExists={
                  isGeneralSpaceSelected
                    ? true
                    : (projectConfig?.shared.configExists ?? false)
                }
                activeTab={activeTab}
                activeCommand={activeCommand}
                onAddProject={() => void handleAddProject()}
                onAddLocalCommand={() => openCreateCommandDialog("local")}
                onCreateConfig={() => void handleCreateConfig()}
                onCreateShellTab={() => void handleCreateShellTab()}
              />
            }
          </main>
        </div>

        <CommandDialog
          open={commandDialogState !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCommandDialogState(null);
            }
          }}
          entryMode={commandDialogState?.mode ?? "list"}
          editingCommandId={
            commandDialogState?.mode === "edit"
              ? commandDialogState.commandId
              : null
          }
          preferredCreateSource={
            commandDialogState?.mode === "create"
              ? commandDialogState.preferredSource
              : getDefaultCreateCommandSource(projectConfig)
          }
          projectId={displayedProject?.id ?? ""}
          projectName={displayedProject?.name ?? GENERAL_SPACE_NAME}
          commands={commands}
          projectConfig={projectConfig}
          onCommandsChanged={handleCommandsChanged}
        />

        <ProjectCommandMenu
          open={projectCommandMenuOpen}
          onOpenChange={setProjectCommandMenuOpen}
          projects={commandMenuProjects}
          selectedProjectId={selectedProjectId}
          onSelectProject={(projectId) => {
            setSelectedProjectId(projectId);
          }}
        />

        <ShortcutsDialog
          open={shortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />

        <AlertDialog
          open={Boolean(pendingShellCloseTab)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingShellCloseTabId(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close running terminal?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>
                  {pendingShellCloseTab?.title ?? "This shell tab"}
                </strong>{" "}
                still has an active process. Closing it will stop that process
                and remove the tab.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void confirmDeleteShellTab()}
              >
                Close Terminal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
