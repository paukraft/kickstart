import { describe, expect, it } from "vitest";

import {
  getEditorLaunchCommand,
  getEditorSystemIconPath,
  listAvailableEditors,
} from "./editor-launcher";

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

  it("detects Windows editors from common install paths even when PATH does not include launcher shims", () => {
    const editors = listAvailableEditors(
      "win32",
      {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      {
        pathExists: (path) =>
          path === "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe" ||
          path === "C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" ||
          path === "C:\\Users\\tester\\AppData\\Local\\Programs\\Zed\\Zed.exe" ||
          path === "C:\\Program Files\\Sublime Text\\sublime_text.exe",
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual([
      "cursor",
      "vscode",
      "zed",
      "sublime-text",
    ]);
  });

  it("detects versioned Windows installs for JetBrains editors", () => {
    const editors = listAvailableEditors(
      "win32",
      {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
      },
      {
        pathExists: (path) =>
          path === "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1\\bin\\idea64.exe",
        readDirectory: (path) => {
          if (path === "C:\\Program Files\\JetBrains") {
            return ["IntelliJ IDEA 2026.1"];
          }
          throw new Error(`ENOENT: ${path}`);
        },
      },
    );

    expect(editors.map((editor) => editor.id)).toContain("intellij");
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

  it("launches the detected Windows executable when the launcher shim is unavailable", () => {
    expect(
      getEditorLaunchCommand("project-path", "vscode", "win32", {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
      }, {
        pathExists: (path) =>
          path === "C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" ||
          path === "C:\\Windows\\System32\\explorer.EXE",
      }),
    ).toEqual({
      args: ["project-path"],
      command: "C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    });
  });

  it("launches versioned JetBrains installs on Windows when the launcher shim is unavailable", () => {
    expect(
      getEditorLaunchCommand(
        "project-path",
        "intellij",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
          PATH: "C:\\Windows\\System32",
          ProgramFiles: "C:\\Program Files",
        },
        {
          pathExists: (path) =>
            path === "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1\\bin\\idea64.exe",
          readDirectory: (path) => {
            if (path === "C:\\Program Files\\JetBrains") {
              return ["IntelliJ IDEA 2026.1"];
            }
            throw new Error(`ENOENT: ${path}`);
          },
        },
      ),
    ).toEqual({
      args: ["project-path"],
      command: "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1\\bin\\idea64.exe",
    });
  });
});

describe("getEditorSystemIconPath", () => {
  it("returns the macOS bundle icon file path for icon lookup", () => {
    expect(
      getEditorSystemIconPath(
        "vscode",
        "darwin",
        { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
        {
          homeDirectory: "/Users/tester",
          pathExists: (path) =>
            path === "/Applications/Visual Studio Code.app" ||
            path === "/Applications/Visual Studio Code.app/Contents/Resources/Code.icns" ||
            path === "/usr/bin/open",
          readTextFile: (path) => {
            expect(path).toBe("/Applications/Visual Studio Code.app/Contents/Info.plist");
            return `
              <?xml version="1.0" encoding="UTF-8"?>
              <plist version="1.0">
                <dict>
                  <key>CFBundleIconFile</key>
                  <string>Code.icns</string>
                </dict>
              </plist>
            `;
          },
        },
      ),
    ).toBe("/Applications/Visual Studio Code.app/Contents/Resources/Code.icns");
  });

  it("returns the Finder icon path for the macOS file manager", () => {
    expect(
      getEditorSystemIconPath(
        "file-manager",
        "darwin",
        { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
        {
          pathExists: (path) =>
            path === "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns",
          readTextFile: (path) => {
            expect(path).toBe("/System/Library/CoreServices/Finder.app/Contents/Info.plist");
            return `
              <?xml version="1.0" encoding="UTF-8"?>
              <plist version="1.0">
                <dict>
                  <key>CFBundleIconFile</key>
                  <string>Finder</string>
                </dict>
              </plist>
            `;
          },
        },
      ),
    ).toBe("/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns");
  });

  it("returns the Windows executable path for icon lookup", () => {
    expect(
      getEditorSystemIconPath("cursor", "win32", {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
      }, {
        pathExists: (path) =>
          path === "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
      }),
    ).toBe("C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe");
  });

  it("returns the Explorer executable path for the Windows file manager", () => {
    expect(
      getEditorSystemIconPath(
        "file-manager",
        "win32",
        {
          PATH: "C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
        },
        {
          pathExists: (path) => path === "C:\\Windows\\explorer.exe",
        },
      ),
    ).toBe("C:\\Windows\\explorer.exe");
  });
});
