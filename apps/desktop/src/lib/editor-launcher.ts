import { accessSync, constants, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path, { basename, extname } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { EDITOR_OPTIONS, type EditorDefinition, type EditorId, type EditorOption } from "./editors";

interface EditorLauncherOptions {
  cacheNamespace?: string;
  homeDirectory?: string;
  pathExists?: (path: string) => boolean;
  readDirectory?: (path: string) => string[];
  readTextFile?: (path: string) => string;
  runCommand?: (command: string, args: string[]) => { status: number | null; stdout: string };
  runCommandAsync?: (command: string, args: string[]) => Promise<{ status: number | null; stdout: string }>;
}

const editorDefinitions = EDITOR_OPTIONS as readonly (EditorDefinition & { id: EditorId })[];
const execFileAsync = promisify(execFile);
const darwinAppPathCache = new Map<string, string>();
const darwinAppPathLookupTasks = new Map<string, Promise<string | null>>();

interface ResolvedEditorPaths {
  commandAvailable: boolean;
  darwinAppPath: string | null;
  darwinExecutablePath: string | null;
  windowsExecutablePath: string | null;
}

type CommandResult = { status: number | null; stdout: string };
type CommandRunner = (command: string, args: string[]) => CommandResult;
type AsyncCommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

function pathExists(path: string) {
  try {
    const stats = statSync(path);
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]) {
  return (platform === "win32" ? path.win32 : path.posix).join(...parts);
}

function readTextFile(filePath: string) {
  return readFileSync(filePath, "utf8");
}

function readDirectory(directoryPath: string) {
  return readdirSync(directoryPath);
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
  };
}

async function runCommandAsync(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const stdout = result.stdout;
    return {
      status: 0,
      stdout: typeof stdout === "string" ? stdout : "",
    };
  } catch (error) {
    const commandError = error as { code?: number; stdout?: string | Buffer };
    return {
      status: typeof commandError.code === "number" ? commandError.code : null,
      stdout:
        typeof commandError.stdout === "string"
          ? commandError.stdout
          : (commandError.stdout?.toString() ?? ""),
    };
  }
}

function getEditorDefinition(editorId: EditorId) {
  return editorDefinitions.find((option) => option.id === editorId) ?? null;
}

function getDarwinAppCacheKey(editor: EditorDefinition, options: EditorLauncherOptions = {}) {
  const namespace = options.cacheNamespace ?? "default";
  const homeDirectory = options.homeDirectory ?? homedir();
  return `${namespace}:${homeDirectory}:${editor.id}`;
}

function getDarwinApplicationRoots(options: EditorLauncherOptions = {}) {
  const homeDirectory = options.homeDirectory ?? homedir();
  return ["/Applications", joinPath("darwin", homeDirectory, "Applications")];
}

function buildDarwinIndexedQueries(editor: EditorDefinition) {
  const queries: string[] = [];

  for (const bundleIdentifier of editor.darwinBundleIdentifiers ?? []) {
    queries.push(`kMDItemCFBundleIdentifier == '${bundleIdentifier.replace(/'/g, "\\'")}'`);
  }

  for (const appName of editor.darwinAppNames ?? []) {
    queries.push(`kMDItemFSName == '${`${appName}.app`.replace(/'/g, "\\'")}'c`);
  }

  return queries;
}

function parseDarwinIndexedAppPath(stdout: string, exists: (path: string) => boolean) {
  return stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(".app") && exists(entry)) ?? null;
}

function findDarwinAppPathInStandardLocations(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const appNames = editor.darwinAppNames;
  if (!appNames?.length) {
    return null;
  }

  const exists = options.pathExists ?? pathExists;
  for (const appName of appNames) {
    for (const applicationRoot of getDarwinApplicationRoots(options)) {
      const appPath = joinPath("darwin", applicationRoot, `${appName}.app`);
      if (exists(appPath)) {
        return appPath;
      }
    }
  }

  return null;
}

function getAsyncCommandRunner(options: EditorLauncherOptions = {}): AsyncCommandRunner {
  if (options.runCommandAsync) {
    return options.runCommandAsync;
  }

  if (options.runCommand) {
    return async (command: string, args: string[]) => options.runCommand!(command, args);
  }

  return runCommandAsync;
}

function findDarwinExecutablePathForAppPath(
  appPath: string,
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  for (const relativePath of editor.darwinExecutableCandidates ?? []) {
    const candidatePath = joinPath("darwin", appPath, relativePath);
    if (exists(candidatePath)) {
      return candidatePath;
    }
  }

  if (editor.darwinRequiresExecutableWhenCommandMissing) {
    return resolveDarwinBundleExecutablePath(appPath, options);
  }

  return null;
}

function resolveCommandAvailability(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
) {
  const command = editor.command ?? getFileManagerCommand(platform);
  return {
    command,
    commandAvailable: isCommandAvailable(command, platform, env),
  };
}

function isEditorLaunchable(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: EditorLauncherOptions = {},
) {
  return isResolvedEditorLaunchable(editor, platform, resolveEditorPaths(editor, platform, env, options));
}

async function isEditorLaunchableAsync(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: EditorLauncherOptions = {},
) {
  return isResolvedEditorLaunchable(editor, platform, await resolveEditorPathsAsync(editor, platform, env, options));
}

function isResolvedEditorLaunchable(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  resolved: ResolvedEditorPaths,
) {
  if (!editor.command) {
    return resolved.commandAvailable;
  }

  if (resolved.commandAvailable) {
    return true;
  }

  if (platform === "darwin") {
    if (resolved.darwinExecutablePath) {
      return true;
    }

    if (editor.darwinRequiresExecutableWhenCommandMissing) {
      return false;
    }

    return resolved.darwinAppPath !== null;
  }

  if (platform === "win32") {
    return resolved.windowsExecutablePath !== null;
  }

  return false;
}

function getDarwinIndexedAppCandidates(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  const execute: CommandRunner = options.runCommand ?? runCommand;

  for (const query of buildDarwinIndexedQueries(editor)) {
    const result = execute("/usr/bin/mdfind", [query]);
    if (result.status !== 0 || !result.stdout) {
      continue;
    }

    const appPath = parseDarwinIndexedAppPath(result.stdout, exists);
    if (appPath) {
      return appPath;
    }
  }

  return null;
}

async function getDarwinIndexedAppCandidatesAsync(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  const execute = getAsyncCommandRunner(options);

  for (const query of buildDarwinIndexedQueries(editor)) {
    const result = await execute("/usr/bin/mdfind", [query]);
    if (result.status !== 0 || !result.stdout) {
      continue;
    }

    const appPath = parseDarwinIndexedAppPath(result.stdout, exists);
    if (appPath) {
      return appPath;
    }
  }

  return null;
}

function findDarwinAppPath(editor: EditorDefinition, options: EditorLauncherOptions = {}) {
  return findDarwinAppPathInStandardLocations(editor, options) ?? getDarwinIndexedAppCandidates(editor, options);
}

async function findDarwinAppPathAsync(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  const appPath = findDarwinAppPathInStandardLocations(editor, options);
  if (appPath) {
    return appPath;
  }

  const cacheKey = getDarwinAppCacheKey(editor, options);
  const cached = darwinAppPathCache.get(cacheKey);
  if (cached && exists(cached)) {
    return cached;
  }
  if (cached) {
    darwinAppPathCache.delete(cacheKey);
  }

  const inFlight = darwinAppPathLookupTasks.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = getDarwinIndexedAppCandidatesAsync(editor, options)
    .then((appPath) => {
      darwinAppPathLookupTasks.delete(cacheKey);
      if (appPath) {
        darwinAppPathCache.set(cacheKey, appPath);
      }
      return appPath;
    })
    .catch((error) => {
      darwinAppPathLookupTasks.delete(cacheKey);
      throw error;
    });
  darwinAppPathLookupTasks.set(cacheKey, task);
  return task;
}

function findDarwinExecutablePath(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const appPath = findDarwinAppPath(editor, options);
  return appPath ? findDarwinExecutablePathForAppPath(appPath, editor, options) : null;
}

async function findDarwinExecutablePathAsync(
  editor: EditorDefinition,
  options: EditorLauncherOptions = {},
) {
  const appPath = await findDarwinAppPathAsync(editor, options);
  return appPath ? findDarwinExecutablePathForAppPath(appPath, editor, options) : null;
}

function resolveEditorPaths(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: EditorLauncherOptions = {},
): ResolvedEditorPaths {
  const { commandAvailable } = resolveCommandAvailability(editor, platform, env);

  return {
    commandAvailable,
    darwinAppPath:
      platform === "darwin" && !editor.darwinSystemAppPath ? findDarwinAppPath(editor, options) : null,
    darwinExecutablePath:
      platform === "darwin" && editor.command && !commandAvailable
        ? findDarwinExecutablePath(editor, options)
        : null,
    windowsExecutablePath:
      platform === "win32" && editor.command && !commandAvailable
        ? findWindowsExecutablePath(editor, env, options)
        : null,
  };
}

async function resolveEditorPathsAsync(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: EditorLauncherOptions = {},
): Promise<ResolvedEditorPaths> {
  const { commandAvailable } = resolveCommandAvailability(editor, platform, env);

  return {
    commandAvailable,
    darwinAppPath:
      platform === "darwin" && !editor.darwinSystemAppPath ? await findDarwinAppPathAsync(editor, options) : null,
    darwinExecutablePath:
      platform === "darwin" && editor.command && !commandAvailable
        ? await findDarwinExecutablePathAsync(editor, options)
        : null,
    windowsExecutablePath:
      platform === "win32" && editor.command && !commandAvailable
        ? findWindowsExecutablePath(editor, env, options)
        : null,
  };
}

function getWindowsExecutableRoots(env: NodeJS.ProcessEnv) {
  return [
    env.LOCALAPPDATA,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ]
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry));
}

function getWindowsExplorerPath(env: NodeJS.ProcessEnv = process.env) {
  const windowsRoot = env.SystemRoot?.trim() || env.WINDIR?.trim() || "C:\\Windows";
  return joinPath("win32", windowsRoot, "explorer.exe");
}

function findWindowsExecutablePath(
  editor: EditorDefinition,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const relativePaths = editor.windowsExecutableCandidates ?? [];

  const exists = options.pathExists ?? pathExists;
  const readDir = options.readDirectory ?? readDirectory;

  for (const root of getWindowsExecutableRoots(env)) {
    for (const relativePath of relativePaths) {
      const executablePath = joinPath("win32", root, relativePath);
      if (exists(executablePath)) {
        return executablePath;
      }
    }
  }

  if (relativePaths.length > 0) {
    const groupedCandidates = new Map<string, string[]>();
    for (const relativePath of relativePaths) {
      const parts = relativePath.split("/");
      if (parts.length < 4) {
        continue;
      }

      const executableDirectory = parts.at(-2);
      const executableName = parts.at(-1);
      const productDirectory = parts.at(-3);
      const baseDirectory = parts.slice(0, -3).join("/");
      if (!productDirectory || !executableDirectory || !executableName || !baseDirectory) {
        continue;
      }

      const key = `${baseDirectory}/${productDirectory}/${executableDirectory}`;
      const entry = groupedCandidates.get(key) ?? [];
      entry.push(executableName);
      groupedCandidates.set(key, entry);
    }

    for (const root of getWindowsExecutableRoots(env)) {
      for (const [candidateDirectory, executableNames] of groupedCandidates) {
        const directoryParts = candidateDirectory.split("/");
        const executableDirectory = directoryParts.at(-1);
        const productName = directoryParts.at(-2);
        const parentDirectory = directoryParts.slice(0, -2).join("/");
        if (!productName || !parentDirectory || !executableDirectory) {
          continue;
        }

        const parentPath = joinPath("win32", root, parentDirectory);
        let entries: string[];
        try {
          entries = readDir(parentPath);
        } catch {
          continue;
        }

        const matchingDirectories = entries
          .filter(
            (entry) =>
              entry === productName ||
              entry.startsWith(`${productName} `) ||
              entry.startsWith(`${productName}_`) ||
              entry.startsWith(`${productName}-`),
          )
          .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }));

        for (const directoryName of matchingDirectories) {
          for (const executableName of executableNames) {
            const executablePath = joinPath(
              "win32",
              parentPath,
              directoryName,
              executableDirectory,
              executableName,
            );
            if (exists(executablePath)) {
              return executablePath;
            }
          }
        }
      }
    }
  }

  return findWindowsAppxExecutablePath(editor, env, options);
}

function getFileManagerCommand(platform: NodeJS.Platform) {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

function getPathValue(env: NodeJS.ProcessEnv) {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function stripWrappingQuotes(value: string) {
  return value.replace(/^"+|"+$/g, "");
}

function getWindowsPathExtensions(env: NodeJS.ProcessEnv) {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) {
    return fallback;
  }

  const values = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));

  return values.length > 0 ? Array.from(new Set(values)) : fallback;
}

function getPathDelimiter(platform: NodeJS.Platform) {
  return platform === "win32" ? ";" : ":";
}

function getCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsExtensions: readonly string[],
) {
  if (platform !== "win32") {
    return [command];
  }

  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (extension.length > 0 && windowsExtensions.includes(normalizedExtension)) {
    const baseCommand = command.slice(0, -extension.length);
    return Array.from(
      new Set([
        command,
        `${baseCommand}${normalizedExtension}`,
        `${baseCommand}${normalizedExtension.toLowerCase()}`,
      ]),
    );
  }

  const candidates: string[] = [];
  for (const windowsExtension of windowsExtensions) {
    candidates.push(`${command}${windowsExtension}`);
    candidates.push(`${command}${windowsExtension.toLowerCase()}`);
  }

  return Array.from(new Set(candidates));
}

function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsExtensions: readonly string[],
) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }

    if (platform === "win32") {
      const extension = extname(filePath);
      return extension.length > 0 && windowsExtensions.includes(extension.toUpperCase());
    }

    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCommandPath(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  const windowsExtensions = platform === "win32" ? getWindowsPathExtensions(env) : [];
  const commandCandidates = getCommandCandidates(command, platform, windowsExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.find((candidate) =>
      isExecutableFile(candidate, platform, windowsExtensions),
    ) ?? null;
  }

  const pathValue = getPathValue(env);
  if (!pathValue) {
    return null;
  }

  const pathEntries = pathValue
    .split(getPathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter(Boolean);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      const candidatePath = joinPath(platform, pathEntry, candidate);
      if (isExecutableFile(candidatePath, platform, windowsExtensions)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function isCommandAvailable(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return findCommandPath(command, platform, env) !== null;
}

function getDarwinAppName(appPath: string) {
  return basename(appPath, ".app");
}

function parsePlistStringValue(plist: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`).exec(plist);
  return match?.[1]?.trim() ?? null;
}

function resolveDarwinBundleExecutablePath(
  appPath: string,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  const readText = options.readTextFile ?? readTextFile;
  const infoPlistPath = joinPath("darwin", appPath, "Contents", "Info.plist");

  try {
    const infoPlist = readText(infoPlistPath);
    const bundleExecutable = parsePlistStringValue(infoPlist, "CFBundleExecutable");
    if (!bundleExecutable) {
      return null;
    }

    const executablePath = joinPath("darwin", appPath, "Contents", "MacOS", bundleExecutable);
    return exists(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}

function parseWindowsAppxExecutablePaths(manifest: string) {
  const matches = manifest.matchAll(/<Application\b[^>]*\bExecutable="([^"]+)"/gi);
  return Array.from(
    new Set(
      Array.from(matches, (match) => match[1]?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => value.replace(/\\/g, "/")),
    ),
  );
}

function findWindowsAppxExecutablePath(
  editor: EditorDefinition,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const packagePrefixes = editor.windowsAppxPackagePrefixes;
  if (!packagePrefixes?.length) {
    return null;
  }

  const exists = options.pathExists ?? pathExists;
  const readDir = options.readDirectory ?? readDirectory;
  const readText = options.readTextFile ?? readTextFile;

  for (const root of getWindowsExecutableRoots(env)) {
    const packagesRoot = joinPath("win32", root, "WindowsApps");

    let packageDirectories: string[];
    try {
      packageDirectories = readDir(packagesRoot);
    } catch {
      continue;
    }

    for (const packagePrefix of packagePrefixes) {
      const matchingDirectories = packageDirectories
        .filter(
          (entry) =>
            entry === packagePrefix ||
            entry.startsWith(`${packagePrefix}_`) ||
            entry.startsWith(`${packagePrefix}-`),
        )
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }));

      for (const directoryName of matchingDirectories) {
        const packagePath = joinPath("win32", packagesRoot, directoryName);
        const manifestPath = joinPath("win32", packagePath, "AppxManifest.xml");

        let manifest: string;
        try {
          manifest = readText(manifestPath);
        } catch {
          continue;
        }

        for (const executableRelativePath of parseWindowsAppxExecutablePaths(manifest)) {
          const executablePath = joinPath("win32", packagePath, ...executableRelativePath.split("/"));
          if (exists(executablePath)) {
            return executablePath;
          }
        }
      }
    }
  }

  return null;
}

function resolveDarwinBundleIconPath(
  appPath: string,
  options: EditorLauncherOptions = {},
) {
  const exists = options.pathExists ?? pathExists;
  const readText = options.readTextFile ?? readTextFile;
  const infoPlistPath = joinPath("darwin", appPath, "Contents", "Info.plist");
  const resourcesPath = joinPath("darwin", appPath, "Contents", "Resources");
  const candidateNames = new Set<string>();

  candidateNames.add(getDarwinAppName(appPath));

  try {
    const infoPlist = readText(infoPlistPath);
    const bundleIconFile = parsePlistStringValue(infoPlist, "CFBundleIconFile");
    const bundleIconName = parsePlistStringValue(infoPlist, "CFBundleIconName");

    if (bundleIconFile) {
      candidateNames.add(bundleIconFile);
    }
    if (bundleIconName) {
      candidateNames.add(bundleIconName);
    }
  } catch {
    // Ignore plist parsing failures and fall back to common bundle icon names.
  }

  for (const candidateName of candidateNames) {
    const candidatePaths = candidateName.includes(".")
      ? [joinPath("darwin", resourcesPath, candidateName)]
      : [
          joinPath("darwin", resourcesPath, `${candidateName}.icns`),
          joinPath("darwin", resourcesPath, `${candidateName}.png`),
        ];

    for (const candidatePath of candidatePaths) {
      if (exists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function getResolvedEditorSystemIconPath(
  editor: EditorDefinition,
  resolved: ResolvedEditorPaths,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: EditorLauncherOptions = {},
) {
  if (platform === "darwin") {
    if (editor.darwinSystemAppPath) {
      return resolveDarwinBundleIconPath(editor.darwinSystemAppPath, options);
    }

    return resolved.darwinAppPath ? resolveDarwinBundleIconPath(resolved.darwinAppPath, options) : null;
  }

  if (platform === "win32") {
    if (editor.windowsSystemExecutable) {
      const executablePath =
        editor.windowsSystemExecutable.includes("\\") || editor.windowsSystemExecutable.includes("/")
          ? editor.windowsSystemExecutable
          : getWindowsExplorerPath(env);
      return (options.pathExists ?? pathExists)(executablePath) ? executablePath : null;
    }

    if (!editor.command) {
      return null;
    }

    return resolved.windowsExecutablePath ?? findCommandPath(editor.command, platform, env);
  }

  return null;
}

function getResolvedEditorLaunchCommand(
  editor: EditorDefinition,
  targetPath: string,
  platform: NodeJS.Platform,
  resolved: ResolvedEditorPaths,
) {
  if (editor.command) {
    const commandArgs = editor.args ?? [];

    if (platform === "darwin" && !resolved.commandAvailable) {
      if (resolved.darwinExecutablePath) {
        return {
          args: [...commandArgs, targetPath],
          command: resolved.darwinExecutablePath,
        };
      }

      if (editor.darwinRequiresExecutableWhenCommandMissing) {
        throw new Error(`Could not find executable launch target for editor: ${editor.id}`);
      }

      if (resolved.darwinAppPath) {
        const appName = getDarwinAppName(resolved.darwinAppPath);
        if (editor.darwinOpenWithArgs) {
          return {
            args: ["-n", "-a", appName, "--args", targetPath],
            command: getFileManagerCommand(platform),
          };
        }

        return {
          args: ["-a", appName, targetPath],
          command: getFileManagerCommand(platform),
        };
      }
    }

    if (platform === "win32" && !resolved.commandAvailable && resolved.windowsExecutablePath) {
      return {
        args: [targetPath],
        command: resolved.windowsExecutablePath,
      };
    }

    return {
      args: [...commandArgs, targetPath],
      command: editor.command,
    };
  }

  return {
    args: [targetPath],
    command: getFileManagerCommand(platform),
  };
}

export function getEditorSystemIconPath(
  editorId: EditorId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const editor = getEditorDefinition(editorId);
  if (!editor) {
    return null;
  }

  return getResolvedEditorSystemIconPath(editor, resolveEditorPaths(editor, platform, env, options), platform, env, options);
}

export async function getEditorSystemIconPathAsync(
  editorId: EditorId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const editor = getEditorDefinition(editorId);
  if (!editor) {
    return null;
  }

  return getResolvedEditorSystemIconPath(
    editor,
    await resolveEditorPathsAsync(editor, platform, env, options),
    platform,
    env,
    options,
  );
}

export function listAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
): EditorOption[] {
  return editorDefinitions.flatMap((editor) => {
    if (!isEditorLaunchable(editor, platform, env, options)) {
      return [];
    }

    return [{ id: editor.id, label: editor.label }];
  });
}

export async function listAvailableEditorsAsync(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
): Promise<EditorOption[]> {
  const editors = await Promise.all(
    editorDefinitions.map(async (editor) => {
      if (!(await isEditorLaunchableAsync(editor, platform, env, options))) {
        return null;
      }

      return { id: editor.id, label: editor.label } satisfies EditorOption;
    }),
  );

  return editors.filter((editor): editor is EditorOption => editor !== null);
}

export function getEditorLaunchCommand(
  targetPath: string,
  editorId: EditorId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const editor = getEditorDefinition(editorId);
  if (!editor) {
    throw new Error(`Unsupported editor: ${editorId}`);
  }

  return getResolvedEditorLaunchCommand(
    editor,
    targetPath,
    platform,
    resolveEditorPaths(editor, platform, env, options),
  );
}

export async function getEditorLaunchCommandAsync(
  targetPath: string,
  editorId: EditorId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
) {
  const editor = getEditorDefinition(editorId);
  if (!editor) {
    throw new Error(`Unsupported editor: ${editorId}`);
  }

  return getResolvedEditorLaunchCommand(
    editor,
    targetPath,
    platform,
    await resolveEditorPathsAsync(editor, platform, env, options),
  );
}
