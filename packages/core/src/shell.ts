import path from "node:path";

export interface ResolvedShell {
  args: string[];
  command: string;
}

export function resolveDefaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ResolvedShell {
  if (platform === "win32") {
    return {
      args: ["-NoLogo"],
      command: env.COMSPEC || "powershell.exe",
    };
  }

  const shell = env.SHELL || "/bin/zsh";
  return {
    args: ["-l"],
    command: shell,
  };
}

export function resolveProjectCwd(projectPath: string, relativeCwd: string): string {
  if (path.isAbsolute(relativeCwd)) {
    throw new Error("Absolute command cwd values are not supported.");
  }
  const resolved = path.resolve(projectPath, relativeCwd);
  const relative = path.relative(projectPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Command cwd must stay within the project root.");
  }
  return resolved;
}

