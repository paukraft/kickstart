import { contextBridge, ipcRenderer, webUtils } from "electron";

import type {
  ConfigChangedPayload,
  DesktopBridge,
  ShortcutActionId,
  DesktopUpdateState,
  TerminalEvent,
} from "@kickstart/contracts";

const desktopBridge: DesktopBridge = {
  checkForUpdates: () => ipcRenderer.invoke("kickstart:update-check"),
  createCommand: (input) => ipcRenderer.invoke("kickstart:create-command", input),
  createGroupFromProjects: (input) => ipcRenderer.invoke("kickstart:create-group-from-projects", input),
  createProject: (input) => ipcRenderer.invoke("kickstart:create-project", input),
  createProjectConfig: (projectId) => ipcRenderer.invoke("kickstart:create-project-config", projectId),
  createShellTab: (input) => ipcRenderer.invoke("kickstart:create-shell-tab", input),
  deleteCommand: (input) => ipcRenderer.invoke("kickstart:delete-command", input),
  deleteProject: (projectId) => ipcRenderer.invoke("kickstart:delete-project", projectId),
  deleteShellTab: (projectId, tabId) => ipcRenderer.invoke("kickstart:delete-shell-tab", projectId, tabId),
  getSelectedProjectId: () => ipcRenderer.invoke("kickstart:get-selected-project-id"),
  downloadUpdate: () => ipcRenderer.invoke("kickstart:update-download"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getProjectConfig: (projectId) => ipcRenderer.invoke("kickstart:get-project-config", projectId),
  getProjectTerminalSessions: (projectId) =>
    ipcRenderer.invoke("kickstart:get-project-terminal-sessions", projectId),
  getProjectTabs: (projectId) => ipcRenderer.invoke("kickstart:get-project-tabs", projectId),
  getUpdateState: () => ipcRenderer.invoke("kickstart:get-update-state"),
  installUpdate: () => ipcRenderer.invoke("kickstart:update-install"),
  listAvailableEditors: () => ipcRenderer.invoke("kickstart:list-available-editors"),
  listGroups: () => ipcRenderer.invoke("kickstart:list-groups"),
  listProjects: () => ipcRenderer.invoke("kickstart:list-projects"),
  moveProjectToGroup: (input) => ipcRenderer.invoke("kickstart:move-project-to-group", input),
  openTerminal: (input) => ipcRenderer.invoke("kickstart:terminal-open", input),
  openInEditor: (path, editorId) => ipcRenderer.invoke("kickstart:open-in-editor", { editorId, path }),
  openExternalUrl: (url) => ipcRenderer.invoke("kickstart:open-external-url", url),
  renameShellTab: (input) => ipcRenderer.invoke("kickstart:rename-shell-tab", input),
  removeProjectFromGroup: (projectId) => ipcRenderer.invoke("kickstart:remove-project-from-group", projectId),
  reorderCommands: (input) => ipcRenderer.invoke("kickstart:reorder-commands", input),
  reorderProjects: (input) => ipcRenderer.invoke("kickstart:reorder-projects", input),
  reorderProjectsInGroup: (input) => ipcRenderer.invoke("kickstart:reorder-projects-in-group", input),
  reorderRail: (input) => ipcRenderer.invoke("kickstart:reorder-rail", input),
  reorderTabs: (input) => ipcRenderer.invoke("kickstart:reorder-tabs", input),
  restartProjectStart: (projectId) => ipcRenderer.invoke("kickstart:restart-project-start", projectId),
  restartTerminalCommand: (input) => ipcRenderer.invoke("kickstart:terminal-restart", input),
  runProjectStart: (projectId) => ipcRenderer.invoke("kickstart:run-project-start", projectId),
  runTerminalCommand: (input) => ipcRenderer.invoke("kickstart:terminal-run", input),
  selectFolder: () => ipcRenderer.invoke("kickstart:select-folder"),
  selectProject: (input) => ipcRenderer.invoke("kickstart:select-project", input),
  selectTab: (input) => ipcRenderer.invoke("kickstart:select-tab", input),
  stopProjectStart: (projectId) => ipcRenderer.invoke("kickstart:stop-project-start", projectId),
  stopTerminalCommand: (input) => ipcRenderer.invoke("kickstart:terminal-stop", input),
  toggleGroupCollapsed: (groupId) => ipcRenderer.invoke("kickstart:toggle-group-collapsed", groupId),
  terminalClose: (input) => ipcRenderer.invoke("kickstart:terminal-close", input),
  terminalResize: (input) => ipcRenderer.invoke("kickstart:terminal-resize", input),
  terminalWrite: (input) => ipcRenderer.invoke("kickstart:terminal-write", input),
  updateCommand: (input) => ipcRenderer.invoke("kickstart:update-command", input),
  onUpdateState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DesktopUpdateState) => {
      listener(payload);
    };
    ipcRenderer.on("kickstart:update-state", wrapped);
    return () => {
      ipcRenderer.off("kickstart:update-state", wrapped);
    };
  },
  watchShortcutActions: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, actionId: ShortcutActionId) => {
      listener(actionId);
    };
    ipcRenderer.on("kickstart:shortcut-action", wrapped);
    return () => {
      ipcRenderer.off("kickstart:shortcut-action", wrapped);
    };
  },
  watchConfig: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ConfigChangedPayload) => {
      listener(payload);
    };
    ipcRenderer.on("kickstart:config-changed", wrapped);
    return () => {
      ipcRenderer.off("kickstart:config-changed", wrapped);
    };
  },
  watchTerminalEvents: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalEvent) => {
      listener(payload);
    };
    ipcRenderer.on("kickstart:terminal-event", wrapped);
    return () => {
      ipcRenderer.off("kickstart:terminal-event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("desktop", desktopBridge);
