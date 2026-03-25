import {
  RiArrowDownSLine,
  RiCloseLine,
  RiLoader4Line,
  RiPlayFill,
  RiStopFill,
} from "@remixicon/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  GENERAL_SPACE_ID,
  type CommandConfig,
  type DesktopUpdateState,
  type ProjectConfigPayload,
  type ProjectGroupRecord,
  type ProjectTabRecord,
  type ProjectWithRuntime,
  type ShortcutActionId,
  type TerminalSessionSnapshot,
} from "@kickstart/contracts";
import { normalizeKickstartConfig } from "@kickstart/core";

import { CommandDialog } from "@/components/app/command-dialog";
import { MainContent } from "@/components/app/main-content";
import { ProjectCommandMenu } from "@/components/app/project-command-menu";
import { ProjectDropdown } from "@/components/app/project-dropdown";
import { ProjectRail, type RailItem } from "@/components/app/project-rail";
import { ProjectSidebar } from "@/components/app/project-sidebar";
import { ShortcutsDialog } from "@/components/app/shortcuts-dialog";
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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { TooltipProvider } from "@/components/ui/tooltip";
import { commandByTabId, getPreferredCommandTabId } from "@/lib/command-utils";
import { reorderByIds, type RelativePosition } from "@/lib/reorder";
import { getShortcutTabIndex } from "@/lib/shortcuts";

const GENERAL_SPACE_NAME = "General";
type CommandDialogState =
  | { mode: "create" }
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
      return "Checking for updates...";
    case "available":
      return `Kickstart ${updateState.availableVersion ?? ""} is available.`;
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

export function App() {
  // ── Core state ──────────────────────────────────────────────
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
  // ── Dialog state ────────────────────────────────────────────
  const [commandDialogState, setCommandDialogState] =
    useState<CommandDialogState>(null);
  const [projectCommandMenuOpen, setProjectCommandMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
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
  const projectListRequestRef = useRef(0);
  const projectStateRequestRef = useRef(0);
  const terminalSessionsRequestRef = useRef(0);
  selectedProjectIdRef.current = selectedProjectId;

  // ── Derived ─────────────────────────────────────────────────
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const isGeneralSpaceSelected = selectedProjectId === GENERAL_SPACE_ID;
  const editableCommands = projectConfig?.config?.commands ?? [];
  const commands = useMemo(
    () =>
      projectConfig?.config
        ? normalizeKickstartConfig(projectConfig.config).commands
        : [],
    [projectConfig?.config],
  );
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
  const projectHeaderAction =
    selectedProject?.runtimeState === "starting"
      ? {
          icon: <RiLoader4Line className="animate-spin" />,
          label: "Starting...",
          onClick: () => {},
          variant: "default" as const,
        }
      : selectedProject?.runtimeState === "stopping"
        ? {
            icon: <RiLoader4Line className="animate-spin" />,
            label: "Stopping...",
            onClick: () => {},
            variant: "outline" as const,
          }
        : selectedProject?.runtimeState === "running"
          ? {
              icon: <RiStopFill />,
              label: "Stop",
              onClick: () => void handleStopProject(),
              variant: "outline" as const,
            }
          : selectedProject?.runtimeState === "partially-running"
            ? {
                icon: <RiPlayFill />,
                label: "Start Missing",
                onClick: () => void handleRunProject(),
                variant: "default" as const,
              }
            : {
                icon: <RiPlayFill />,
                label: "Start",
                onClick: () => void handleRunProject(),
                variant: "default" as const,
              };

  function resolveSelectedTabId(
    nextTabs: ProjectTabRecord[],
    preferredTabId: string | null,
  ) {
    if (preferredTabId && nextTabs.some((tab) => tab.id === preferredTabId)) {
      return preferredTabId;
    }
    return nextTabs[0]?.id ?? null;
  }

  // ── Data fetching ───────────────────────────────────────────
  function mapSessionsByTabId(sessions: TerminalSessionSnapshot[]) {
    return Object.fromEntries(
      sessions.map((session) => [session.tabId, session]),
    );
  }

  async function refreshProjects(options?: { keepSelection?: boolean }) {
    const requestId = ++projectListRequestRef.current;
    const [items, groupItems] = await Promise.all([
      window.desktop.listProjects(),
      window.desktop.listGroups(),
    ]);
    if (requestId !== projectListRequestRef.current) {
      return { groups: groupItems, projects: items };
    }
    setProjects(items);
    setGroups(groupItems);
    setSelectedProjectId((current) => {
      if (
        options?.keepSelection &&
        current &&
        items.some((p) => p.id === current)
      )
        return current;
      if (options?.keepSelection && current === GENERAL_SPACE_ID)
        return current;
      return GENERAL_SPACE_ID;
    });
    return { groups: groupItems, projects: items };
  }

  async function refreshProjectState(projectId: string) {
    const requestId = ++projectStateRequestRef.current;
    if (projectId === GENERAL_SPACE_ID) {
      const [sessions, tabs] = await Promise.all([
        window.desktop.getProjectTerminalSessions(projectId),
        window.desktop.getProjectTabs(projectId),
      ]);
      if (
        requestId !== projectStateRequestRef.current ||
        selectedProjectIdRef.current !== projectId
      ) {
        return;
      }
      setProjectConfig(null);
      setTerminalSessions(mapSessionsByTabId(sessions));
      setTabs(tabs.tabs);
      setSelectedTabId((current) =>
        resolveSelectedTabId(tabs.tabs, current ?? tabs.activeTabId),
      );
      return;
    }
    const [config, sessions, tabs] = await Promise.all([
      window.desktop.getProjectConfig(projectId),
      window.desktop.getProjectTerminalSessions(projectId),
      window.desktop.getProjectTabs(projectId),
    ]);
    if (
      requestId !== projectStateRequestRef.current ||
      selectedProjectIdRef.current !== projectId
    ) {
      return;
    }
    setProjectConfig(config);
    setTerminalSessions(mapSessionsByTabId(sessions));
    setTabs(tabs.tabs);
    setSelectedTabId((current) =>
      resolveSelectedTabId(tabs.tabs, current ?? tabs.activeTabId),
    );
  }

  async function refreshTerminalSessions(projectId: string) {
    const requestId = ++terminalSessionsRequestRef.current;
    const sessions = await window.desktop.getProjectTerminalSessions(projectId);
    if (
      requestId !== terminalSessionsRequestRef.current ||
      selectedProjectIdRef.current !== projectId
    ) {
      return;
    }
    setTerminalSessions(mapSessionsByTabId(sessions));
  }

  const refreshSelectedProjectRuntime = useEffectEvent(
    async (projectId: string) => {
      await refreshTerminalSessions(projectId);
      if (selectedProjectIdRef.current !== projectId) {
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
      commands: config.config
        ? normalizeKickstartConfig(config.config).commands
        : [],
    };
  });

  // ── Effects ─────────────────────────────────────────────────
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
      if (!selectedProjectId || event.projectId !== selectedProjectId) {
        return;
      }
      if (
        event.type !== "started" &&
        event.type !== "stopped" &&
        event.type !== "cleared" &&
        event.type !== "updated"
      ) {
        return;
      }
      void refreshSelectedProjectRuntime(event.projectId);
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectConfig(null);
      setTerminalSessions({});
      setTabs([]);
      setSelectedTabId(null);
      return;
    }
    void window.desktop.selectProject({ projectId: selectedProjectId });
    void Promise.all([
      refreshProjectState(selectedProjectId),
      refreshProjects({ keepSelection: true }),
    ]);
  }, [selectedProjectId]);

  useEffect(() => {
    const unsubscribe = window.desktop.watchConfig((payload) => {
      if (payload.projectId === selectedProjectId) {
        setProjectConfig({
          config: payload.config,
          configError: payload.configError ?? null,
          configExists: payload.configExists,
        });
        setTabs(payload.tabs);
        setSelectedTabId((current) =>
          resolveSelectedTabId(payload.tabs, current),
        );
      }
      void refreshProjects({ keepSelection: true });
    });
    return unsubscribe;
  }, [selectedProjectId]);

  // ── Handlers ────────────────────────────────────────────────
  async function handleAddProject() {
    const folderPath = await window.desktop.selectFolder();
    if (!folderPath) return;
    const created = await window.desktop.createProject({ path: folderPath });
    await refreshProjects({ keepSelection: true });
    if (created?.id) setSelectedProjectId(created.id);
  }

  async function handleDeleteProject() {
    if (!selectedProject) return;
    await window.desktop.deleteProject(selectedProject.id);
    setDeleteDialogOpen(false);
    await refreshProjects();
  }

  async function handleCreateConfig() {
    if (!selectedProject) return;
    const payload = await window.desktop.createProjectConfig(
      selectedProject.id,
    );
    setProjectConfig(payload);
    await refreshProjectState(selectedProject.id);
    openCreateCommandDialog();
  }

  async function handleSelectTab(tabId: string) {
    if (!selectedProjectId) return;
    setSelectedTabId(tabId);
    await window.desktop.selectTab({ projectId: selectedProjectId, tabId });
  }

  async function handleRunProject() {
    if (!selectedProject) return;
    await window.desktop.runProjectStart(selectedProject.id);
    await refreshTerminalSessions(selectedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleStopProject() {
    if (!selectedProject) return;
    await window.desktop.stopProjectStart(selectedProject.id);
    await refreshTerminalSessions(selectedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleRunTab(tab: ProjectTabRecord) {
    if (!selectedProject) return;
    await window.desktop.runTerminalCommand({
      projectId: selectedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(selectedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleRestartTab(tab: ProjectTabRecord) {
    if (!selectedProject) return;
    await window.desktop.restartTerminalCommand({
      projectId: selectedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(selectedProject.id);
    await refreshProjects({ keepSelection: true });
  }

  async function handleStopTab(tab: ProjectTabRecord) {
    if (!selectedProject) return;
    await window.desktop.stopTerminalCommand({
      projectId: selectedProject.id,
      tabId: tab.id,
    });
    await refreshTerminalSessions(selectedProject.id);
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

    if (actionId === "open-project-settings" && selectedProject) {
      openProjectSettings(selectedProject.id);
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

  async function handleToggleGroupCollapsed(groupId: string) {
    await window.desktop.toggleGroupCollapsed(groupId);
    setGroups(await window.desktop.listGroups());
  }

  async function handleReorderRail(
    sourceItem: RailItem,
    targetItem: RailItem,
    position: RelativePosition,
  ) {
    const reordered = reorderByIds(
      railItems.map((item) => ({
        id: item.type === "project" ? item.project.id : item.group.id,
        item,
      })),
      sourceItem.type === "project"
        ? sourceItem.project.id
        : sourceItem.group.id,
      targetItem.type === "project"
        ? targetItem.project.id
        : targetItem.group.id,
      position,
    );
    await window.desktop.reorderRail({
      items: reordered.map((r) => ({
        type: r.item.type,
        id: r.id,
      })),
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

  async function handleReorderCommands(sourceId: string, targetId: string) {
    if (!selectedProject || sourceId === targetId) return;
    const next = reorderByIds(commandTabs, sourceId, targetId);
    await window.desktop.reorderCommands({
      commandIds: next
        .map((tab) => tab.commandId)
        .filter((commandId): commandId is string => Boolean(commandId)),
      projectId: selectedProject.id,
    });
    await refreshProjectState(selectedProject.id);
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

  function openCreateCommandDialog() {
    setCommandDialogState({ mode: "create" });
  }

  function openProjectSettings(projectId: string) {
    setSelectedProjectId(projectId);
    setCommandDialogState({ mode: "list" });
  }

  function requestDeleteProject(projectId: string) {
    setSelectedProjectId(projectId);
    setDeleteDialogOpen(true);
  }

  function openEditCommandDialog(command: CommandConfig) {
    setCommandDialogState({ mode: "edit", commandId: command.id });
  }

  async function handleCommandsChanged() {
    if (!selectedProject) return;
    await refreshProjectState(selectedProject.id);
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

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        <TitleBar />

        {updateState &&
        shouldShowUpdateBanner(updateState) &&
        updateBannerCopy &&
        !isUpdateBannerDismissed ? (
          <div className="border-b bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{updateBannerCopy}</p>
                {updateState.status === "error" && updateState.checkedAt ? (
                  <p className="text-xs text-amber-900/80">
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
                  <Button
                    size="xs"
                    disabled={updateActionPending}
                    onClick={() => void window.desktop.downloadUpdate()}
                  >
                    Update
                  </Button>
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
          <aside className="flex min-h-0 w-72 shrink-0 flex-col overflow-hidden border-r p-3">
            <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 bg-background">
              {selectedProject ? (
                <ProjectDropdown
                  mode="dropdown-menu"
                  project={selectedProject}
                  triggerClassName="desktop-no-drag inline-flex max-w-[14rem] items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-accent"
                  onOpenSettings={openProjectSettings}
                  onDeleteProject={requestDeleteProject}
                >
                  <div className="inline-flex max-w-[14rem] items-center gap-1">
                    <h1 className="min-w-0 truncate text-sm font-semibold">
                      {selectedProject.name}
                    </h1>
                    <RiArrowDownSLine className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </ProjectDropdown>
              ) : (
                <h1 className="px-1 py-0.5 text-sm font-semibold text-muted-foreground">
                  {isGeneralSpaceSelected ? GENERAL_SPACE_NAME : "No Project"}
                </h1>
              )}

              {selectedProject ? (
                <Button
                  className="desktop-no-drag shrink-0"
                  disabled={
                    selectedProject.startupCommandCount === 0 ||
                    selectedProject.runtimeState === "starting" ||
                    selectedProject.runtimeState === "stopping"
                  }
                  size="xs"
                  variant={projectHeaderAction.variant}
                  onClick={projectHeaderAction.onClick}
                >
                  {projectHeaderAction.icon}
                  {projectHeaderAction.label}
                </Button>
              ) : null}

              <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove <strong>{selectedProject?.name}</strong>{" "}
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

            {selectedProject ? (
              <ProjectSidebar
                project={selectedProject}
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
                onAddCommand={openCreateCommandDialog}
                onCreateShellTab={() => void handleCreateShellTab()}
                onDeleteShellTab={requestDeleteShellTab}
                onReorderCommands={(sourceId, targetId) =>
                  void handleReorderCommands(sourceId, targetId)
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
          <main className="min-h-0 flex-1">
            <MainContent
              project={selectedProject}
              workspaceId={selectedProjectId}
              workspaceName={
                isGeneralSpaceSelected ? GENERAL_SPACE_NAME : undefined
              }
              configExists={
                isGeneralSpaceSelected
                  ? true
                  : (projectConfig?.configExists ?? false)
              }
              activeTab={activeTab}
              activeCommand={activeCommand}
              onAddProject={() => void handleAddProject()}
              onCreateConfig={() => void handleCreateConfig()}
              onCreateShellTab={() => void handleCreateShellTab()}
            />
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
          projectId={selectedProject?.id ?? ""}
          projectName={selectedProject?.name ?? GENERAL_SPACE_NAME}
          commands={commands}
          editableCommands={editableCommands}
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
