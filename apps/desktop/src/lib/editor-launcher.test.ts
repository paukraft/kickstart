import { describe, expect, it } from "vitest";

import { getEditorLaunchCommand, listAvailableEditors } from "./editor-launcher";

describe("listAvailableEditors", () => {
  it("falls back to app bundle detection on macOS when PATH does not include editor CLIs", () => {
    const editors = listAvailableEditors(
      "darwin",
      { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      {
        homeDirectory: "/Users/tester",
        pathExists: (path) =>
          path === "/Applications/Cursor.app" ||
          path === "/Applications/Windsurf.app" ||
          path === "/Applications/Visual Studio Code.app" ||
          path === "/Applications/Zed.app" ||
          path === "/Applications/IntelliJ IDEA.app" ||
          path === "/Applications/WebStorm.app" ||
          path === "/Applications/PyCharm.app" ||
          path === "/Applications/GoLand.app" ||
          path === "/Applications/PhpStorm.app" ||
          path === "/Applications/RubyMine.app" ||
          path === "/Applications/CLion.app" ||
          path === "/Applications/Rider.app" ||
          path === "/Applications/Android Studio.app" ||
          path === "/Applications/Sublime Text.app" ||
          path === "/Applications/Nova.app" ||
          path === "/usr/bin/open",
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual([
      "cursor",
      "windsurf",
      "vscode",
      "zed",
      "intellij",
      "webstorm",
      "pycharm",
      "goland",
      "phpstorm",
      "rubymine",
      "clion",
      "rider",
      "android-studio",
      "sublime-text",
      "nova",
      "file-manager",
    ]);
  });
});

describe("getEditorLaunchCommand", () => {
  it("uses open -a on macOS when the editor app exists but the CLI shim is unavailable", () => {
    expect(
      getEditorLaunchCommand("project-path", "vscode", "darwin", { HOME: "/Users/tester", PATH: "/usr/bin:/bin" }, {
        homeDirectory: "/Users/tester",
        pathExists: (path) =>
          path === "/Applications/Visual Studio Code.app" || path === "/usr/bin/open",
      }),
    ).toEqual({
      args: ["-a", "Visual Studio Code", "project-path"],
      command: "open",
    });
  });

  it("keeps using the CLI command when it is available in PATH", () => {
    expect(
      getEditorLaunchCommand(
        "project-path",
        "vscode",
        "darwin",
        {
          HOME: "/Users/tester",
          PATH: "/usr/bin:/bin:/opt/homebrew/bin",
        },
        {
          pathExists: (path) => path === "/opt/homebrew/bin/code",
        },
      ),
    ).toEqual({
      args: ["project-path"],
      command: "code",
    });
  });

  it("passes the codex app subcommand before the target path", () => {
    expect(
      getEditorLaunchCommand(
        "project-path",
        "codex",
        "darwin",
        {
          HOME: "/Users/tester",
          PATH: "/usr/bin:/bin:/opt/homebrew/bin",
        },
        {
          pathExists: (path) => path === "/opt/homebrew/bin/codex",
        },
      ),
    ).toEqual({
      args: ["app", "project-path"],
      command: "codex",
    });
  });

  it("falls back to open -a for Windsurf on macOS when the CLI shim is unavailable", () => {
    expect(
      getEditorLaunchCommand("project-path", "windsurf", "darwin", {
        HOME: "/Users/tester",
        PATH: "/usr/bin:/bin",
      }, {
        homeDirectory: "/Users/tester",
        pathExists: (path) => path === "/Applications/Windsurf.app" || path === "/usr/bin/open",
      }),
    ).toEqual({
      args: ["-a", "Windsurf", "project-path"],
      command: "open",
    });
  });

  it("uses open --args for JetBrains IDEs on macOS when the launcher script is unavailable", () => {
    expect(
      getEditorLaunchCommand("project-path", "pycharm", "darwin", {
        HOME: "/Users/tester",
        PATH: "/usr/bin:/bin",
      }, {
        homeDirectory: "/Users/tester",
        pathExists: (path) => path === "/Applications/PyCharm.app" || path === "/usr/bin/open",
      }),
    ).toEqual({
      args: ["-n", "-a", "PyCharm", "--args", "project-path"],
      command: "open",
    });
  });
});
