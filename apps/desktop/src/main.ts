import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import { autoUpdater } from "electron-updater";

import {
  CONFIG_FILE_NAME,
  GENERAL_SPACE_ID,
  createCommandTabId,
  isAutoStartCommand,
  createEffectiveCommandId,
  isTerminalSessionTransitioning,
  parseEffectiveCommandId,
  type ConfigChangedPayload,
  type CreateGroupFromProjectsInput,
  type CreateProjectInput,
  type DeleteCommandInput,
  type DesktopUpdateActionResult,
  type DesktopUpdateMode,
  type DesktopUpdateState,
  type EffectiveCommandId,
  type MoveProjectToGroupInput,
  type NewShellTabInput,
  type ProjectConfigPayload,
  type ProjectRecord,
  type ProjectWithRuntime,
  type RenameShellTabInput,
  type ReorderCommandsInput,
  type ReorderProjectsInGroupInput,
  type ReorderProjectsInput,
  type ReorderRailInput,
  type ReorderTabsInput,
  type SelectProjectInput,
  type SelectTabInput,
  type ShortcutActionId,
  type TerminalEvent,
  type UpdateCommandInput,
  type UpsertCommandInput,
} from "@kickstart/contracts";
import {
  createCommandInConfig,
  createEmptyKickstartConfig,
  deleteCommandFromConfig,
  normalizeKickstartConfig,
  reorderCommandsInConfig,
  reorderResolvedCommands,
  resolveProjectFavicon,
} from "@kickstart/core";

import { AppStore } from "./lib/app-store";
import {
  getEditorLaunchCommandAsync,
  getEditorSystemIconPathAsync,
  listAvailableEditorsAsync,
} from "./lib/editor-launcher";
import {
  DesktopTelemetryClient,
  resolvePostHogConfig,
  type DesktopTelemetryContext,
  type EmbeddedPostHogConfig,
} from "./lib/posthog-telemetry";
import { ensureProjectTab } from "./lib/project-tabs";
import {
  decomposeResolvedCommands,
  loadProjectCommandPayload,
  persistProjectCommandConfigs,
  persistSharedProjectConfig,
  resolveProjectCommands,
} from "./lib/project-command-state";
import { resolveProjectRuntimeState } from "./lib/project-runtime";
import { getShortcutDefinitionsForMenu } from "./lib/shortcuts";
import { TerminalManager } from "./lib/terminal-manager";

function isGeneralSpace(projectId: string) {
  return projectId === GENERAL_SPACE_ID;
}

const started =
  process.platform === "win32"
    ? Boolean(require("electron-squirrel-startup"))
    : false;

if (started) {
  app.quit();
}

app.setName("Kickstart");

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  }) as T;
}

function getWindowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff";
}

type DesktopPackageMetadata = {
  kickstart?: {
    telemetry?: {
      enabled?: unknown;
      posthogHost?: unknown;
      posthogKey?: unknown;
    };
    updateMode?: unknown;
  };
  version?: unknown;
};

function resolveDesktopPackageMetadata(): DesktopPackageMetadata | null {
  const candidatePaths = [
    path.join(app.getAppPath(), "package.json"),
    path.join(__dirname, "../package.json"),
    path.join(process.cwd(), "package.json"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      if (!existsSync(candidatePath)) {
        continue;
      }

      return JSON.parse(readFileSync(candidatePath, "utf8")) as DesktopPackageMetadata;
    } catch {
      // Fall through to the next candidate.
    }
  }

  return null;
}

function resolveDesktopAppVersion(packageMetadata: DesktopPackageMetadata | null): string {
  const version = packageMetadata?.version;
  if (typeof version === "string" && version.trim().length > 0) {
    return version.trim();
  }

  return app.getVersion();
}

function resolveEmbeddedPostHogConfig(
  packageMetadata: DesktopPackageMetadata | null,
): EmbeddedPostHogConfig | null {
  const telemetry = packageMetadata?.kickstart?.telemetry;
  if (!telemetry) {
    return null;
  }

  return {
    enabled: typeof telemetry.enabled === "boolean" ? telemetry.enabled : null,
    host: typeof telemetry.posthogHost === "string" ? telemetry.posthogHost : null,
    key: typeof telemetry.posthogKey === "string" ? telemetry.posthogKey : null,
  };
}

const desktopPackageMetadata = resolveDesktopPackageMetadata();
const desktopAppVersion = resolveDesktopAppVersion(desktopPackageMetadata);
const desktopPostHogConfig = resolvePostHogConfig(
  resolveEmbeddedPostHogConfig(desktopPackageMetadata),
);

let mainWindow: BrowserWindow | null = null;
let store: AppStore | null = null;
let terminalManager: TerminalManager | null = null;
let telemetry: DesktopTelemetryClient | null = null;
let isQuitting = false;
const configWatchers = new Map<string, FSWatcher>();
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updaterConfigured = false;
let releaseChecksConfigured = false;

const UPDATE_STATE_CHANNEL = "kickstart:update-state";
const UPDATE_GET_STATE_CHANNEL = "kickstart:get-update-state";
const UPDATE_CHECK_CHANNEL = "kickstart:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "kickstart:update-download";
const UPDATE_INSTALL_CHANNEL = "kickstart:update-install";
const SHORTCUT_ACTION_CHANNEL = "kickstart:shortcut-action";
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_UPDATE_REPOSITORY = "paukraft/kickstart";
const execFileAsync = promisify(execFile);
const editorIconDataUrlCache = new Map<string, Promise<string | null>>();

function resolvePackagedUpdateMode(): "auto" | "manual" {
  if (!app.isPackaged) {
    return "auto";
  }

  return desktopPackageMetadata?.kickstart?.updateMode === "manual" ? "manual" : "auto";
}

async function listAvailableEditorsWithIcons() {
  const editors = await listAvailableEditorsAsync();

  if (process.platform !== "darwin" && process.platform !== "win32") {
    return editors;
  }

  return Promise.all(
    editors.map(async (editor) => {
      const iconPath = await getEditorSystemIconPathAsync(editor.id);
      if (!iconPath) {
        return editor;
      }

      try {
        const iconDataUrl =
          process.platform === "darwin"
            ? await getMacIconDataUrl(iconPath)
            : (await app.getFileIcon(iconPath, { size: "normal" })).toDataURL();

        if (!iconDataUrl) {
          return editor;
        }

        return {
          ...editor,
          iconDataUrl,
        };
      } catch {
        return editor;
      }
    }),
  );
}

function getMacIconDataUrl(iconPath: string) {
  const cached = editorIconDataUrlCache.get(iconPath);
  if (cached) {
    return cached;
  }

  const task = loadMacIconDataUrl(iconPath).then((result) => {
    if (!result) {
      editorIconDataUrlCache.delete(iconPath);
    }
    return result;
  });
  editorIconDataUrlCache.set(iconPath, task);
  return task;
}

async function loadMacIconDataUrl(iconPath: string) {
  const extension = path.extname(iconPath).toLowerCase();

  if (extension === ".png") {
    return `data:image/png;base64,${(await readFile(iconPath)).toString("base64")}`;
  }

  if (extension !== ".icns") {
    return null;
  }

  const tempDir = await mkdtemp(path.join(app.getPath("temp"), "kickstart-editor-icon-"));
  const outputPath = path.join(tempDir, "icon.png");

  try {
    await execFileAsync("sips", ["-s", "format", "png", iconPath, "--out", outputPath]);
    if (!existsSync(outputPath)) {
      return null;
    }

    return `data:image/png;base64,${(await readFile(outputPath)).toString("base64")}`;
  } catch {
    return null;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function createInitialDesktopUpdateState(
  currentVersion: string,
  updateMode: DesktopUpdateMode,
): DesktopUpdateState {
  return {
    availableVersion: null,
    canRetry: false,
    checkedAt: null,
    currentVersion,
    downloadedVersion: null,
    downloadPercent: null,
    enabled: false,
    errorContext: null,
    message: null,
    status: "disabled",
    updateMode,
  };
}

let updateState: DesktopUpdateState = createInitialDesktopUpdateState(
  desktopAppVersion,
  resolvePackagedUpdateMode(),
);

function getUpdateCheckDisabledReason(args: {
  hasUpdateRepository: boolean;
  isDevelopment: boolean;
  isPackaged: boolean;
  disabledByEnv: boolean;
}): string | null {
  if (args.isDevelopment || !args.isPackaged) {
    return "Update checks are only available in packaged production builds.";
  }
  if (args.disabledByEnv) {
    return "Update checks are disabled by the KICKSTART_DISABLE_AUTO_UPDATE setting.";
  }
  if (!args.hasUpdateRepository) {
    return "Update checks are not configured yet because no release feed has been set up.";
  }
  return null;
}

function getAutoUpdateDisabledReason(args: {
  hasUpdateRepository: boolean;
  isDevelopment: boolean;
  isPackaged: boolean;
  isManualUpdateBuild: boolean;
  platform: NodeJS.Platform;
  disabledByEnv: boolean;
}): string | null {
  const checkDisabledReason = getUpdateCheckDisabledReason(args);
  if (checkDisabledReason) {
    return checkDisabledReason;
  }
  if (args.platform !== "darwin" && args.platform !== "win32") {
    return "Automatic installs are currently available on macOS and Windows builds only.";
  }
  if (args.isManualUpdateBuild) {
    return "This build checks for new releases, but installs updates manually from GitHub Releases.";
  }
  return null;
}

function resolveUpdateRepository(): string {
  return (
    process.env.KICKSTART_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_UPDATE_REPOSITORY
  );
}

function resolveUpdateRepositoryParts() {
  const repository = resolveUpdateRepository();
  if (!repository) {
    return null;
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function shouldEnableReleaseChecks(): boolean {
  return (
    getUpdateCheckDisabledReason({
      disabledByEnv: process.env.KICKSTART_DISABLE_AUTO_UPDATE === "1",
      hasUpdateRepository: resolveUpdateRepository().length > 0,
      isDevelopment: Boolean(getRendererDevServerUrl()),
      isPackaged: app.isPackaged,
    }) === null
  );
}

function shouldEnableAutoUpdates(): boolean {
  return (
    getAutoUpdateDisabledReason({
      disabledByEnv: process.env.KICKSTART_DISABLE_AUTO_UPDATE === "1",
      hasUpdateRepository: resolveUpdateRepository().length > 0,
      isDevelopment: Boolean(getRendererDevServerUrl()),
      isPackaged: app.isPackaged,
      isManualUpdateBuild: resolvePackagedUpdateMode() === "manual",
      platform: process.platform,
    }) === null
  );
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string): number {
  const [leftCore, leftPrerelease = ""] = normalizeVersion(left).split("-", 2);
  const [rightCore, rightPrerelease = ""] = normalizeVersion(right).split("-", 2);

  const leftParts = leftCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (leftPrerelease && !rightPrerelease) {
    return -1;
  }
  if (!leftPrerelease && rightPrerelease) {
    return 1;
  }
  return leftPrerelease.localeCompare(rightPrerelease);
}

async function fetchLatestReleaseVersion(args: {
  allowPrerelease: boolean;
  owner: string;
  repo: string;
}): Promise<string> {
  const endpoint = args.allowPrerelease
    ? `https://api.github.com/repos/${args.owner}/${args.repo}/releases?per_page=20`
    : `https://api.github.com/repos/${args.owner}/${args.repo}/releases/latest`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Kickstart Desktop",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as
    | { tag_name?: string }
    | Array<{ draft?: boolean; prerelease?: boolean; tag_name?: string }>;

  const release = Array.isArray(payload)
    ? payload.find((entry) => !entry.draft && (args.allowPrerelease || !entry.prerelease))
    : payload;

  if (!release?.tag_name) {
    throw new Error("GitHub did not return a latest release tag.");
  }

  return normalizeVersion(release.tag_name);
}

function emitUpdateState() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>) {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function clearUpdatePollTimer() {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function dispatchShortcutAction(actionId: ShortcutActionId, targetWindow?: BrowserWindow | null) {
  const window = targetWindow ?? BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(SHORTCUT_ACTION_CHANNEL, actionId);
}

function createShortcutMenuItems(section: Parameters<typeof getShortcutDefinitionsForMenu>[0]) {
  return getShortcutDefinitionsForMenu(section).map<MenuItemConstructorOptions>((shortcut) => ({
    accelerator: shortcut.accelerator,
    click: (_menuItem, browserWindow) => {
      dispatchShortcutAction(
        shortcut.id,
        browserWindow instanceof BrowserWindow ? browserWindow : undefined,
      );
    },
    label: shortcut.menuLabel,
  }));
}

function configureApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => {
            void handleCheckForUpdatesMenuClick();
          },
        },
        { type: "separator" },
        ...createShortcutMenuItems("app"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu:
        process.platform === "darwin"
          ? createShortcutMenuItems("file")
          : [...createShortcutMenuItems("file"), { type: "separator" }, { role: "quit" }],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Navigate",
      submenu: createShortcutMenuItems("navigate"),
    },
    process.platform === "darwin"
      ? {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        }
      : { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...createShortcutMenuItems("help"),
        { type: "separator" },
        {
          label: "Check for Updates...",
          click: () => {
            void handleCheckForUpdatesMenuClick();
          },
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleCheckForUpdatesMenuClick() {
  const disabledReason = getUpdateCheckDisabledReason({
    disabledByEnv: process.env.KICKSTART_DISABLE_AUTO_UPDATE === "1",
    hasUpdateRepository: resolveUpdateRepository().length > 0,
    isDevelopment: Boolean(getRendererDevServerUrl()),
    isPackaged: app.isPackaged,
  });

  if (disabledReason) {
    await dialog.showMessageBox({
      buttons: ["OK"],
      detail: disabledReason,
      message: "Update checks are not available right now.",
      title: "Updates unavailable",
      type: "info",
    });
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  await checkForUpdates("menu");
}

async function checkForUpdates(reason: string): Promise<void> {
  if (isQuitting || !releaseChecksConfigured || updateCheckInFlight) {
    return;
  }
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    return;
  }

  updateCheckInFlight = true;
  setUpdateState({
    canRetry: false,
    checkedAt: new Date().toISOString(),
    downloadPercent: null,
    errorContext: null,
    message: null,
    status: "checking",
  });

  try {
    if (updateState.updateMode === "manual") {
      const repository = resolveUpdateRepositoryParts();
      if (!repository) {
        throw new Error("The GitHub repository for updates is invalid.");
      }

      const latestVersion = await fetchLatestReleaseVersion({
        allowPrerelease: desktopAppVersion.includes("-"),
        owner: repository.owner,
        repo: repository.repo,
      });

      if (compareVersions(latestVersion, desktopAppVersion) > 0) {
        setUpdateState({
          availableVersion: latestVersion,
          canRetry: true,
          checkedAt: new Date().toISOString(),
          downloadedVersion: null,
          downloadPercent: null,
          errorContext: null,
          message: `Kickstart ${latestVersion} is available. Download it from GitHub Releases.`,
          status: "available",
        });
      } else {
        setUpdateState({
          availableVersion: null,
          canRetry: false,
          checkedAt: new Date().toISOString(),
          downloadedVersion: null,
          downloadPercent: null,
          errorContext: null,
          message: null,
          status: "idle",
        });
      }
      return;
    }

    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState({
      canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      checkedAt: new Date().toISOString(),
      downloadPercent: null,
      errorContext: "check",
      message,
      status: "error",
    });
    console.error(`[desktop-updater] Failed to check for updates (${reason}): ${message}`);
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }

  updateDownloadInFlight = true;
  setUpdateState({
    canRetry: false,
    downloadPercent: 0,
    errorContext: null,
    message: null,
    status: "downloading",
  });

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState({
      canRetry: updateState.availableVersion !== null,
      downloadPercent: null,
      errorContext: "download",
      message,
      status: updateState.availableVersion ? "available" : "error",
    });
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  clearUpdatePollTimer();

  try {
    autoUpdater.quitAndInstall();
    return { accepted: true, completed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    isQuitting = false;
    setUpdateState({
      canRetry: true,
      errorContext: "install",
      message,
      status: "error",
    });
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater() {
  const updateMode = resolvePackagedUpdateMode();
  const releaseChecksEnabled = shouldEnableReleaseChecks();
  const enabled = shouldEnableAutoUpdates();
  updaterConfigured = false;
  releaseChecksConfigured = false;
  setUpdateState({
    ...createInitialDesktopUpdateState(desktopAppVersion, updateMode),
    enabled: releaseChecksEnabled,
    message: releaseChecksEnabled
      ? null
      : getUpdateCheckDisabledReason({
          disabledByEnv: process.env.KICKSTART_DISABLE_AUTO_UPDATE === "1",
          hasUpdateRepository: resolveUpdateRepository().length > 0,
          isDevelopment: Boolean(getRendererDevServerUrl()),
          isPackaged: app.isPackaged,
        }),
    status: releaseChecksEnabled ? "idle" : "disabled",
  });

  if (!releaseChecksEnabled) {
    return;
  }

  const repository = resolveUpdateRepositoryParts();
  if (!repository) {
    setUpdateState({
      canRetry: false,
      enabled: false,
      message: "Automatic updates are not configured because the GitHub repository is invalid.",
      status: "disabled",
    });
    return;
  }

  releaseChecksConfigured = true;

  if (enabled) {
    updaterConfigured = true;
    autoUpdater.setFeedURL({
      owner: repository.owner,
      provider: "github",
      repo: repository.repo,
    });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = desktopAppVersion.includes("-");

    autoUpdater.on("update-available", (info) => {
      setUpdateState({
        availableVersion: info.version,
        canRetry: true,
        checkedAt: new Date().toISOString(),
        downloadedVersion: null,
        downloadPercent: null,
        errorContext: null,
        message: null,
        status: "available",
      });
    });

    autoUpdater.on("update-not-available", () => {
      setUpdateState({
        availableVersion: null,
        canRetry: false,
        checkedAt: new Date().toISOString(),
        downloadedVersion: null,
        downloadPercent: null,
        errorContext: null,
        message: null,
        status: "idle",
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      setUpdateState({
        downloadPercent: progress.percent,
        message: null,
        status: "downloading",
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      updateDownloadInFlight = false;
      setUpdateState({
        availableVersion: info.version,
        canRetry: false,
        downloadedVersion: info.version,
        downloadPercent: 100,
        errorContext: null,
        message: null,
        status: "downloaded",
      });
    });

    autoUpdater.on("error", (error) => {
      const errorContext = updateDownloadInFlight ? "download" : updateCheckInFlight ? "check" : null;
      updateDownloadInFlight = false;
      const message = error instanceof Error ? error.message : String(error);
      setUpdateState({
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext,
        message,
        status: "error",
      });
    });

    autoUpdater.on("checking-for-update", () => {
      setUpdateState({
        canRetry: false,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: null,
        message: null,
        status: "checking",
      });
    });
  }

  clearUpdatePollTimer();
  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}

function getRendererDevServerUrl() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }

  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }

  return null;
}

function getRendererHtmlPath() {
  const candidates = [
    typeof MAIN_WINDOW_VITE_NAME !== "undefined"
      ? path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
      : null,
    path.join(__dirname, "../dist-renderer/index.html"),
  ];

  const htmlPath = candidates.find(
    (candidate): candidate is string =>
      candidate !== null && existsSync(candidate),
  );

  if (!htmlPath) {
    throw new Error("Renderer entrypoint not found");
  }

  return htmlPath;
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    path.join(__dirname, "../resources", fileName),
    path.join(process.resourcesPath, "resources", fileName),
    path.join(process.resourcesPath, fileName),
  ];

  const resourcePath = candidates.find((candidate) => existsSync(candidate));
  return resourcePath ?? null;
}

function getStore() {
  if (!store) {
    throw new Error("App store not initialized.");
  }
  return store;
}

function getTerminalManager() {
  if (!terminalManager) {
    throw new Error("Terminal manager not initialized.");
  }
  return terminalManager;
}

function sendConfigChanged(payload: ConfigChangedPayload) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("kickstart:config-changed", payload);
}

function sendTerminalEvent(event: TerminalEvent) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("kickstart:terminal-event", event);
}

async function getDesktopTelemetryUsageMetrics() {
  const projects = getStore().listProjects();

  const commandCounts = await Promise.all(
    projects.map(async (project) => {
      const payload = await loadProjectCommandPayload(getStore(), project);
      const commands = resolveProjectCommands(payload);

      let sharedCommandCount = 0;
      let localCommandCount = 0;

      for (const command of commands) {
        if (command.source === "shared") {
          sharedCommandCount += 1;
        } else if (command.source === "local") {
          localCommandCount += 1;
        }
      }

      return {
        localCommandCount,
        sharedCommandCount,
      };
    }),
  );

  const sharedCommandCount = commandCounts.reduce((total, entry) => total + entry.sharedCommandCount, 0);
  const localCommandCount = commandCounts.reduce((total, entry) => total + entry.localCommandCount, 0);

  return {
    localCommandCount,
    projectCount: projects.length,
    sharedCommandCount,
  } as const;
}

function markDesktopAppUsed(trigger: "app-activate" | "app-opened" | "window-focus") {
  void (async () => {
    if (!(await telemetry?.shouldTrackDailyAppUsed())) {
      return;
    }
    const metrics = await getDesktopTelemetryUsageMetrics();
    await telemetry?.trackDailyAppUsed(trigger, metrics);
  })();
}

function getDesktopTelemetryContext(): DesktopTelemetryContext {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const appLocale = app.getLocale().trim();
  const systemLocale = app.getSystemLocale().trim();
  const inferredCountryCode = app.getLocaleCountryCode().trim().toUpperCase();

  return {
    appLocale: appLocale.length > 0 ? appLocale : null,
    inferredCountryCode: inferredCountryCode.length > 0 ? inferredCountryCode : null,
    isPackaged: app.isPackaged,
    osRelease: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : null,
    platform: process.platform,
    preferredSystemLanguages: app.getPreferredSystemLanguages().slice(0, 5),
    runningUnderArm64Translation: app.runningUnderARM64Translation,
    systemLocale: systemLocale.length > 0 ? systemLocale : null,
    timezone: typeof timezone === "string" && timezone.length > 0 ? timezone : null,
  };
}

async function loadProjectConfig(project: ProjectRecord): Promise<ProjectConfigPayload> {
  return loadProjectCommandPayload(getStore(), project);
}

async function configPayloadForProject(projectId: string): Promise<ProjectConfigPayload> {
  const project = getStore().getProject(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return loadProjectConfig(project);
}

async function syncProjectTabs(projectId: string, payload: ProjectConfigPayload) {
  const commands = resolveProjectCommands(payload);
  const sessions = await getTerminalManager().getProjectSessions(projectId);
  const runningTabIds = new Set(
    sessions
      .filter((session) =>
        session.hasActiveProcess || isTerminalSessionTransitioning(session.status),
      )
      .map((session) => session.tabId),
  );
  return getStore().syncTabs(projectId, commands, runningTabIds);
}

async function syncProjectTabsForProject(projectId: string) {
  if (isGeneralSpace(projectId)) {
    return getStore().getTabState(projectId);
  }
  const payload = await configPayloadForProject(projectId);
  return syncProjectTabs(projectId, payload);
}

async function ensureProjectTabAvailable(projectId: string, tabId: string) {
  return ensureProjectTab({
    getTab: (currentProjectId, currentTabId) => getStore().getTab(currentProjectId, currentTabId),
    projectId,
    syncProjectTabs: async (currentProjectId) => {
      await syncProjectTabsForProject(currentProjectId);
    },
    tabId,
  });
}

async function getProjectStartupCommands(projectId: string) {
  const payload = await configPayloadForProject(projectId);
  await syncProjectTabs(projectId, payload);
  return resolveProjectCommands(payload).filter(isAutoStartCommand);
}

async function listProjectsWithRuntime(): Promise<ProjectWithRuntime[]> {
  const projects = getStore().listProjects();
  return Promise.all(
    projects.map(async (project) => {
      const config = await loadProjectConfig(project);
      const commands = resolveProjectCommands(config);
      const startupCommandIds = commands.filter(isAutoStartCommand).map((command) => command.id);
      const trackedTabIds = startupCommandIds.map((commandId) => createCommandTabId(commandId));
      const trackedTabIdSet = new Set<string>(trackedTabIds);
      const sessions = await getTerminalManager().getProjectSessions(project.id);
      const trackedSessions = sessions.filter((session) => trackedTabIdSet.has(session.tabId));
      const startupCommandCount = startupCommandIds.length;
      const runningCommandCount = trackedSessions.filter((session) => session.hasActiveProcess).length;
      const runtimeState = resolveProjectRuntimeState({
        sessions: trackedSessions,
        startupCommandCount,
      });
      const favicon = await resolveProjectFavicon(project.path);
      return {
        groupId: project.groupId,
        hasCommands: commands.length > 0,
        iconUrl: favicon
          ? `data:${favicon.contentType};base64,${
              (typeof favicon.body === "string"
                ? Buffer.from(favicon.body, "utf8")
                : Buffer.from(favicon.body)
              ).toString("base64")
        }`
          : null,
        id: project.id,
        name: project.name,
        path: project.path,
        sharedConfigExists: config.shared.configExists,
        startupCommandCount,
        runningCommandCount,
        runtimeState,
        sortOrder: project.sortOrder,
      } satisfies ProjectWithRuntime;
    }),
  );
}

async function emitConfigChanged(projectId: string) {
  const project = getStore().getProject(projectId);
  if (!project) {
    return;
  }
  const payload = await loadProjectConfig(project);
  const tabs = await syncProjectTabs(projectId, payload);
  sendConfigChanged({
    hasCommands: payload.hasCommands,
    local: payload.local,
    projectId,
    shared: payload.shared,
    tabs: tabs.tabs,
  });
}

function watchProjectConfig(project: ProjectRecord) {
  if (configWatchers.has(project.id)) {
    return;
  }
  const reload = debounce(() => {
    void emitConfigChanged(project.id);
  }, 120);

  try {
    const watcher = watch(project.path, (eventType, filename) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }
      if (filename && filename !== CONFIG_FILE_NAME) {
        return;
      }
      reload();
    });
    configWatchers.set(project.id, watcher);
  } catch {
    // Ignore watcher failures for now.
  }
}

function refreshProjectWatchers() {
  const nextIds = new Set(getStore().listProjects().map((project) => project.id));
  for (const [projectId, watcher] of configWatchers.entries()) {
    if (nextIds.has(projectId)) {
      continue;
    }
    watcher.close();
    configWatchers.delete(projectId);
  }
  for (const project of getStore().listProjects()) {
    watchProjectConfig(project);
  }
}

async function persistProjectResolvedCommandOrder(
  project: ProjectRecord,
  payload: ProjectConfigPayload,
  orderedCommandIds: readonly EffectiveCommandId[],
) {
  const resolved = reorderResolvedCommands(resolveProjectCommands(payload), orderedCommandIds);
  const decomposed = decomposeResolvedCommands(resolved);

  let nextSharedConfig: ReturnType<typeof normalizeKickstartConfig> | undefined;
  if (payload.shared.config) {
    nextSharedConfig = reorderCommandsInConfig(
      normalizeKickstartConfig(payload.shared.config),
      decomposed.sharedCommandIds,
    );
  }

  let nextLocalConfig: ReturnType<typeof normalizeKickstartConfig> | undefined;
  if (payload.local.config || resolved.some((command) => command.source === "local")) {
    nextLocalConfig = reorderCommandsInConfig(
      normalizeKickstartConfig(payload.local.config ?? createEmptyKickstartConfig()),
      decomposed.localCommandIds,
    );
  }

  await persistProjectCommandConfigs({
    local: nextLocalConfig,
    project,
    shared: nextSharedConfig,
    store: getStore(),
  });
}

async function updateProjectCommand(input: UpdateCommandInput) {
  const project = getStore().getProject(input.projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  const payload = await loadProjectConfig(project);
  const existing = parseEffectiveCommandId(input.existingCommandId);
  if (!existing) {
    throw new Error("Command not found.");
  }

  const currentSourceState = payload[existing.source];
  const nextSourceState = payload[input.source];
  if (currentSourceState.configError) {
    throw new Error(`Cannot update ${existing.source} commands while that config is invalid.`);
  }
  if (nextSourceState.configError) {
    throw new Error(`Cannot update ${input.source} commands while that config is invalid.`);
  }

  const currentSharedConfig = normalizeKickstartConfig(payload.shared.config ?? createEmptyKickstartConfig());
  const currentLocalConfig = normalizeKickstartConfig(payload.local.config ?? createEmptyKickstartConfig());
  const existingSourceConfig = existing.source === "shared" ? currentSharedConfig : currentLocalConfig;
  if (!existingSourceConfig.commands.some((command) => command.id === existing.sourceCommandId)) {
    throw new Error("Command not found.");
  }
  const nextSourceBase =
    existing.source === "shared"
      ? deleteCommandFromConfig(currentSharedConfig, existing.sourceCommandId)
      : deleteCommandFromConfig(currentLocalConfig, existing.sourceCommandId);
  const targetBase =
    input.source === existing.source
      ? nextSourceBase
      : input.source === "shared"
        ? currentSharedConfig
        : currentLocalConfig;
  const targetWithCommand = createCommandInConfig(targetBase, input.command);
  const nextSourceCommand = targetWithCommand.commands.at(-1);
  if (!nextSourceCommand) {
    throw new Error("Command not found.");
  }

  const nextSharedConfig =
    input.source === "shared"
      ? targetWithCommand
      : existing.source === "shared"
        ? nextSourceBase
        : currentSharedConfig;
  const nextLocalConfig =
    input.source === "local"
      ? targetWithCommand
      : existing.source === "local"
        ? nextSourceBase
        : currentLocalConfig;

  const nextEffectiveCommandId = createEffectiveCommandId(
    input.source,
    nextSourceCommand.id,
  );
  const previousTabId = createCommandTabId(input.existingCommandId);
  const nextTabId = createCommandTabId(nextEffectiveCommandId);
  if (
    previousTabId !== nextTabId &&
    getStore().getTab(project.id, previousTabId) &&
    getStore().getTab(project.id, nextTabId)
  ) {
    throw new Error("Command tab already exists.");
  }
  const currentResolved = resolveProjectCommands(payload);
  const nextResolved = currentResolved.map((command) =>
    command.id === input.existingCommandId
      ? {
          ...nextSourceCommand,
          id: nextEffectiveCommandId,
          source: input.source,
          sourceCommandId: nextSourceCommand.id,
        }
      : command,
  );
  const decomposed = decomposeResolvedCommands(nextResolved);
  await persistProjectCommandConfigs({
    local:
      input.source === "local" || existing.source === "local"
        ? reorderCommandsInConfig(nextLocalConfig, decomposed.localCommandIds)
        : undefined,
    project,
    shared:
      input.source === "shared" || existing.source === "shared"
        ? reorderCommandsInConfig(nextSharedConfig, decomposed.sharedCommandIds)
        : undefined,
    store: getStore(),
  });

  if (previousTabId !== nextTabId) {
    getStore().moveCommandTab(project.id, previousTabId, {
      commandId: nextEffectiveCommandId,
      id: nextTabId,
      shellCwd: nextSourceCommand.cwd,
      title: nextSourceCommand.name,
    });
    await getTerminalManager().moveSessionTab(project.id, previousTabId, nextTabId);
  }

  await emitConfigChanged(input.projectId);
  return loadProjectConfig(project);
}

async function createProjectCommand(input: UpsertCommandInput) {
  const project = getStore().getProject(input.projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  const payload = await loadProjectConfig(project);
  const sourceState = payload[input.source];
  if (sourceState.configError) {
    throw new Error(`Cannot update ${input.source} commands while that config is invalid.`);
  }

  const nextConfig = createCommandInConfig(
    normalizeKickstartConfig(sourceState.config ?? createEmptyKickstartConfig()),
    input.command,
  );
  await persistProjectCommandConfigs({
    local: input.source === "local" ? nextConfig : undefined,
    project,
    shared: input.source === "shared" ? nextConfig : undefined,
    store: getStore(),
  });
  await emitConfigChanged(input.projectId);
  return loadProjectConfig(project);
}

function createWindow() {
  const window = new BrowserWindow({
    backgroundColor: getWindowBackgroundColor(),
    height: 900,
    titleBarStyle: "hiddenInset",
    width: 1460,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
    },
  });

  const rendererDevServerUrl = getRendererDevServerUrl();
  if (rendererDevServerUrl) {
    void window.loadURL(rendererDevServerUrl);
  } else {
    void window.loadFile(getRendererHtmlPath());
  }

  window.on("focus", () => {
    markDesktopAppUsed("window-focus");
  });

  return window;
}

function registerIpcHandlers() {
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    await checkForUpdates("renderer");
    return {
      accepted: releaseChecksConfigured,
      completed: updateState.status !== "checking",
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.handle("kickstart:list-projects", async () => listProjectsWithRuntime());
  ipcMain.handle("kickstart:list-available-editors", async () => listAvailableEditorsWithIcons());
  ipcMain.handle("kickstart:get-selected-project-id", async () => getStore().getSelectedProjectId());

  ipcMain.handle("kickstart:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "kickstart:open-in-editor",
    async (_event, payload: { editorId: import("@kickstart/contracts").EditorId; path: string }) => {
      const launch = await getEditorLaunchCommandAsync(payload.path, payload.editorId);
      await new Promise<void>((resolve, reject) => {
        let child;

        try {
          child = spawn(launch.command, launch.args, {
            detached: true,
            shell: process.platform === "win32",
            stdio: "ignore",
          });
        } catch (error) {
          reject(error);
          return;
        }

        child.once("spawn", () => {
          child.unref();
          resolve();
        });
        child.once("error", reject);
      });
    },
  );

  ipcMain.handle("kickstart:open-external-url", async (_event, rawUrl: string) => {
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url) {
      throw new Error("A URL is required.");
    }

    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http and https URLs are allowed.");
    }

    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("kickstart:create-project", async (_event, input: CreateProjectInput) => {
    const projectName = path.basename(input.path);
    const project = getStore().createProject(input.path, projectName);
    refreshProjectWatchers();
    await emitConfigChanged(project.id);
    return (await listProjectsWithRuntime()).find((item) => item.id === project.id);
  });

  ipcMain.handle("kickstart:delete-project", async (_event, projectId: string) => {
    configWatchers.get(projectId)?.close();
    configWatchers.delete(projectId);
    await getTerminalManager().closeProject(projectId);
    getStore().deleteProject(projectId);
  });

  ipcMain.handle("kickstart:reorder-projects", async (_event, input: ReorderProjectsInput) => {
    getStore().reorderProjects(input.projectIds);
    return listProjectsWithRuntime();
  });

  ipcMain.handle("kickstart:select-project", async (_event, input: SelectProjectInput) => {
    getStore().selectProject(input.projectId);
  });

  // ── Groups ──────────────────────────────────────────────────

  ipcMain.handle("kickstart:list-groups", async () => getStore().listGroups());

  ipcMain.handle("kickstart:create-group-from-projects", async (_event, input: CreateGroupFromProjectsInput) => {
    getStore().createGroupFromProjects(input.projectIdA, input.projectIdB);
  });

  ipcMain.handle("kickstart:move-project-to-group", async (_event, input: MoveProjectToGroupInput) => {
    getStore().moveProjectToGroup(input.projectId, input.groupId);
  });

  ipcMain.handle("kickstart:remove-project-from-group", async (_event, projectId: string) => {
    getStore().removeProjectFromGroup(projectId);
  });

  ipcMain.handle("kickstart:toggle-group-collapsed", async (_event, groupId: string) => {
    getStore().toggleGroupCollapsed(groupId);
  });

  ipcMain.handle("kickstart:reorder-rail", async (_event, input: ReorderRailInput) => {
    getStore().reorderRail(input.items);
  });

  ipcMain.handle("kickstart:reorder-projects-in-group", async (_event, input: ReorderProjectsInGroupInput) => {
    getStore().reorderProjectsInGroup(input.groupId, input.projectIds);
  });

  ipcMain.handle("kickstart:get-project-config", async (_event, projectId: string) => {
    return configPayloadForProject(projectId);
  });

  ipcMain.handle("kickstart:get-project-terminal-sessions", async (_event, projectId: string) => {
    return getTerminalManager().getProjectSessions(projectId);
  });

  ipcMain.handle("kickstart:create-project-config", async (_event, projectId: string) => {
    const project = getStore().getProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    const config = createEmptyKickstartConfig();
    await persistSharedProjectConfig({
      config,
      project,
      store: getStore(),
    });
    await emitConfigChanged(projectId);
    return loadProjectConfig(project);
  });

  ipcMain.handle("kickstart:create-command", async (_event, input: UpsertCommandInput) => {
    return createProjectCommand(input);
  });

  ipcMain.handle("kickstart:update-command", async (_event, input: UpdateCommandInput) => {
    return updateProjectCommand(input);
  });

  ipcMain.handle("kickstart:delete-command", async (_event, input: DeleteCommandInput) => {
    const project = getStore().getProject(input.projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    const payload = await loadProjectConfig(project);
    const parsed = parseEffectiveCommandId(input.commandId);
    if (!parsed) {
      throw new Error("Command not found.");
    }
    const sourceState = payload[parsed.source];
    if (sourceState.configError) {
      throw new Error(`Cannot update ${parsed.source} commands while that config is invalid.`);
    }
    const nextConfig = deleteCommandFromConfig(
      normalizeKickstartConfig(sourceState.config ?? createEmptyKickstartConfig()),
      parsed.sourceCommandId,
    );
    await persistProjectCommandConfigs({
      local: parsed.source === "local" ? nextConfig : undefined,
      project,
      shared: parsed.source === "shared" ? nextConfig : undefined,
      store: getStore(),
    });
    await emitConfigChanged(input.projectId);
    return loadProjectConfig(project);
  });

  ipcMain.handle("kickstart:reorder-commands", async (_event, input: ReorderCommandsInput) => {
    const project = getStore().getProject(input.projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    const payload = await loadProjectConfig(project);
    await persistProjectResolvedCommandOrder(project, payload, input.commandIds);
    await emitConfigChanged(input.projectId);
    return loadProjectConfig(project);
  });

  ipcMain.handle("kickstart:get-project-tabs", async (_event, projectId: string) => {
    return syncProjectTabsForProject(projectId);
  });

  ipcMain.handle("kickstart:create-shell-tab", async (_event, input: NewShellTabInput) => {
    return getStore().createShellTab(input.projectId);
  });

  ipcMain.handle("kickstart:rename-shell-tab", async (_event, input: RenameShellTabInput) => {
    return getStore().renameShellTab(input.projectId, input.tabId, input.title);
  });

  ipcMain.handle("kickstart:delete-shell-tab", async (_event, projectId: string, tabId: string) => {
    await getTerminalManager().close({
      deleteHistory: true,
      projectId,
      tabId,
    });
    return getStore().deleteShellTab(projectId, tabId);
  });

  ipcMain.handle("kickstart:reorder-tabs", async (_event, input: ReorderTabsInput) => {
    return getStore().reorderTabs(input.projectId, input.tabIds);
  });

  ipcMain.handle("kickstart:select-tab", async (_event, input: SelectTabInput) => {
    getStore().selectTab(input.projectId, input.tabId);
  });

  ipcMain.handle("kickstart:terminal-open", async (_event, input) => {
    return getTerminalManager().open(input);
  });
  ipcMain.handle("kickstart:terminal-write", async (_event, input) => {
    return getTerminalManager().write(input);
  });
  ipcMain.handle("kickstart:terminal-resize", async (_event, input) => {
    return getTerminalManager().resize(input);
  });
  ipcMain.handle("kickstart:terminal-run", async (_event, input) => {
    return getTerminalManager().runCommand(input);
  });
  ipcMain.handle("kickstart:terminal-restart", async (_event, input) => {
    return getTerminalManager().restartCommand(input);
  });
  ipcMain.handle("kickstart:terminal-stop", async (_event, input) => {
    return getTerminalManager().stopCommand(input);
  });
  ipcMain.handle("kickstart:terminal-close", async (_event, input) => {
    return getTerminalManager().close(input);
  });

  ipcMain.handle("kickstart:run-project-start", async (_event, projectId: string) => {
    const startupCommands = await getProjectStartupCommands(projectId);

    await Promise.all(
      startupCommands.map(async (command) => {
        const tabId = createCommandTabId(command.id);
        const session = await getTerminalManager().getSession(projectId, tabId);
        if (session?.managedRunActive) {
          return;
        }
        await getTerminalManager().runCommand({
          projectId,
          tabId,
        });
      }),
    );
  });

  ipcMain.handle("kickstart:restart-project-start", async (_event, projectId: string) => {
    const startupCommands = await getProjectStartupCommands(projectId);

    await Promise.all(
      startupCommands.map((command) =>
        getTerminalManager().restartCommand({
          projectId,
          tabId: createCommandTabId(command.id),
        }),
      ),
    );
  });

  ipcMain.handle("kickstart:stop-project-start", async (_event, projectId: string) => {
    const startupCommands = await getProjectStartupCommands(projectId);

    await Promise.all(
      startupCommands.map((command) =>
        getTerminalManager().stopCommand({
          projectId,
          tabId: createCommandTabId(command.id),
        }),
      ),
    );
  });
}

async function createAppState() {
  const userDataPath = app.getPath("userData");
  telemetry = new DesktopTelemetryClient({
    appVersion: desktopAppVersion,
    config: desktopPostHogConfig,
    context: getDesktopTelemetryContext(),
    productName: app.getName(),
    userDataPath,
  });
  store = new AppStore(path.join(userDataPath, "kickstart.sqlite"));
  terminalManager = new TerminalManager({
    historyDir: path.join(userDataPath, "terminal-history"),
    loadCommand: async (projectId, commandId) => {
      const project = getStore().getProject(projectId);
      if (!project) {
        return null;
      }
      const payload = await loadProjectConfig(project);
      const commands = resolveProjectCommands(payload);
      return commands.find((command) => command.id === commandId) ?? null;
    },
    loadProject: async (projectId) => getStore().getProject(projectId),
    loadTab: async (projectId, tabId) => ensureProjectTabAvailable(projectId, tabId),
    persistTabCwd: async (projectId, tabId, cwd) => getStore().updateTabShellCwd(projectId, tabId, cwd),
    onEvent: sendTerminalEvent,
  });
  await getTerminalManager().migrateCommandHistoryTabIds(getStore().consumeLegacyCommandTabMigrations());

  for (const project of getStore().listProjects()) {
    await emitConfigChanged(project.id);
  }
  refreshProjectWatchers();
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveResourcePath("icon.png");
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
  }

  await createAppState();
  configureApplicationMenu();
  configureAutoUpdater();
  registerIpcHandlers();
  mainWindow = createWindow();
  markDesktopAppUsed("app-opened");

  app.on("activate", () => {
    markDesktopAppUsed("app-activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  clearUpdatePollTimer();
  for (const watcher of configWatchers.values()) {
    watcher.close();
  }
  configWatchers.clear();
  store?.close();
});
