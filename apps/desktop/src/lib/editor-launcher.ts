import { accessSync, constants, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path, { basename, extname } from "node:path";

import { EDITOR_OPTIONS, type EditorDefinition, type EditorId, type EditorOption } from "./editors";

interface EditorLauncherOptions {
  homeDirectory?: string;
  pathExists?: (path: string) => boolean;
  readDirectory?: (path: string) => string[];
  readTextFile?: (path: string) => string;
}

const editorDefinitions = EDITOR_OPTIONS as readonly (EditorDefinition & { id: EditorId })[];

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

function getEditorDefinition(editorId: EditorId) {
  return editorDefinitions.find((option) => option.id === editorId) ?? null;
}

function findDarwinAppPath(editor: EditorDefinition, options: EditorLauncherOptions = {}) {
  const appNames = editor.darwinAppNames;
  if (!appNames?.length) {
    return null;
  }

  const exists = options.pathExists ?? pathExists;
  const homeDirectory = options.homeDirectory ?? homedir();
  const applicationRoots = ["/Applications", joinPath("darwin", homeDirectory, "Applications")];

  for (const appName of appNames) {
    for (const applicationRoot of applicationRoots) {
      const appPath = joinPath("darwin", applicationRoot, `${appName}.app`);
      if (exists(appPath)) {
        return appPath;
      }
    }
  }

  return null;
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
  const relativePaths = editor.windowsExecutableCandidates;
  if (!relativePaths?.length) {
    return null;
  }

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
        .filter((entry) => entry === productName || entry.startsWith(`${productName} `))
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

  return null;
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

  if (platform === "darwin") {
    if (editor.darwinSystemAppPath) {
      return resolveDarwinBundleIconPath(editor.darwinSystemAppPath, options);
    }

    const appPath = findDarwinAppPath(editor, options);
    return appPath ? resolveDarwinBundleIconPath(appPath, options) : null;
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

    return (
      findWindowsExecutablePath(editor, env, options) ??
      findCommandPath(editor.command, platform, env)
    );
  }

  return null;
}

export function listAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
): EditorOption[] {
  return editorDefinitions.flatMap((editor) => {
    const command = editor.command ?? getFileManagerCommand(platform);
    const commandAvailable = isCommandAvailable(command, platform, env);
    const darwinAppAvailable =
      platform === "darwin"
        ? (editor.darwinSystemAppPath
            ? true
            : editor.darwinAppNames?.length
              ? findDarwinAppPath(editor, options) !== null
              : false)
        : false;
    const windowsExecutableAvailable =
      platform === "win32" &&
      editor.command
        ? findWindowsExecutablePath(editor, env, options) !== null
        : editor.windowsSystemExecutable
          ? getEditorSystemIconPath(editor.id, platform, env, options) !== null
          : false;

    if (!commandAvailable && !darwinAppAvailable && !windowsExecutableAvailable) {
      return [];
    }
    return [{ id: editor.id, label: editor.label }];
  });
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

  if (editor.command) {
    const commandArgs = editor.args ?? [];

    if (platform === "darwin" && !isCommandAvailable(editor.command, platform, env)) {
      const appPath = findDarwinAppPath(editor, options);
      if (appPath) {
        const appName = getDarwinAppName(appPath);
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

    if (platform === "win32" && !isCommandAvailable(editor.command, platform, env)) {
      const executablePath = findWindowsExecutablePath(editor, env, options);
      if (executablePath) {
        return {
          args: [targetPath],
          command: executablePath,
        };
      }
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
