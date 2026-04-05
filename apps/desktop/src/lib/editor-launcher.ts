import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

import { EDITOR_OPTIONS, type EditorId, type EditorOption } from "./editors";

interface EditorLauncherOptions {
  homeDirectory?: string;
  pathExists?: (path: string) => boolean;
}

const DARWIN_APP_NAMES: Partial<Record<EditorId, readonly string[]>> = {
  cursor: ["Cursor"],
  windsurf: ["Windsurf"],
  vscode: ["Visual Studio Code"],
  zed: ["Zed"],
  intellij: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA CE"],
  webstorm: ["WebStorm"],
  pycharm: ["PyCharm", "PyCharm Professional", "PyCharm CE"],
  goland: ["GoLand"],
  phpstorm: ["PhpStorm"],
  rubymine: ["RubyMine"],
  clion: ["CLion"],
  rider: ["Rider"],
  "android-studio": ["Android Studio"],
  "sublime-text": ["Sublime Text"],
  nova: ["Nova"],
};

const DARWIN_OPEN_WITH_ARGS = new Set<EditorId>([
  "intellij",
  "webstorm",
  "pycharm",
  "goland",
  "phpstorm",
  "rubymine",
  "clion",
  "rider",
  "android-studio",
]);

function pathExists(path: string) {
  try {
    const stats = statSync(path);
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function findDarwinApp(editorId: EditorId, options: EditorLauncherOptions = {}) {
  const appNames = DARWIN_APP_NAMES[editorId];
  if (!appNames || appNames.length === 0) {
    return null;
  }

  const exists = options.pathExists ?? pathExists;
  const homeDirectory = options.homeDirectory ?? homedir();
  const applicationRoots = ["/Applications", join(homeDirectory, "Applications")];

  for (const appName of appNames) {
    for (const applicationRoot of applicationRoots) {
      if (exists(join(applicationRoot, `${appName}.app`))) {
        return appName;
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

function isCommandAvailable(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  const windowsExtensions = platform === "win32" ? getWindowsPathExtensions(env) : [];
  const commandCandidates = getCommandCandidates(command, platform, windowsExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.some((candidate) =>
      isExecutableFile(candidate, platform, windowsExtensions),
    );
  }

  const pathValue = getPathValue(env);
  if (!pathValue) {
    return false;
  }

  const pathEntries = pathValue
    .split(getPathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter(Boolean);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (isExecutableFile(join(pathEntry, candidate), platform, windowsExtensions)) {
        return true;
      }
    }
  }

  return false;
}

export function listAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorLauncherOptions = {},
): EditorOption[] {
  return EDITOR_OPTIONS.flatMap((editor) => {
    const command = editor.command ?? getFileManagerCommand(platform);
    const commandAvailable = isCommandAvailable(command, platform, env);
    const darwinAppAvailable =
      platform === "darwin" && editor.command ? findDarwinApp(editor.id, options) !== null : false;

    if (!commandAvailable && !darwinAppAvailable) {
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
  const editor = EDITOR_OPTIONS.find((option) => option.id === editorId);
  if (!editor) {
    throw new Error(`Unsupported editor: ${editorId}`);
  }

  if (editor.command) {
    const commandArgs = "args" in editor ? editor.args : [];

    if (platform === "darwin" && !isCommandAvailable(editor.command, platform, env)) {
      const appName = findDarwinApp(editorId, options);
      if (appName) {
        if (DARWIN_OPEN_WITH_ARGS.has(editorId)) {
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
