import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getEditorLaunchCommand,
  getEditorLaunchCommandAsync,
  getEditorSystemIconPath,
  getEditorSystemIconPathAsync,
  listAvailableEditors,
  listAvailableEditorsAsync,
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
          path === "/Applications/Codex.app" ||
          path === "/Applications/Codex.app/Contents/MacOS/Codex" ||
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
        readTextFile: (filePath) => {
          if (filePath !== "/Applications/Codex.app/Contents/Info.plist") {
            throw new Error(`ENOENT: ${filePath}`);
          }

          return `
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0">
              <dict>
                <key>CFBundleExecutable</key>
                <string>Codex</string>
              </dict>
            </plist>
          `;
        },
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual([
      "cursor",
      "codex",
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

  it("finds macOS apps from Spotlight metadata when they are outside standard Applications folders", () => {
    const editors = listAvailableEditors(
      "darwin",
      { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      {
        homeDirectory: "/Users/tester",
        pathExists: (path) =>
          path === "/Volumes/Tools/Codex.app" ||
          path === "/Volumes/Tools/Codex.app/Contents/MacOS/Codex" ||
          path === "/usr/bin/open",
        readTextFile: (filePath) => {
          expect(filePath).toBe("/Volumes/Tools/Codex.app/Contents/Info.plist");
          return `
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0">
              <dict>
                <key>CFBundleExecutable</key>
                <string>Codex</string>
              </dict>
            </plist>
          `;
        },
        runCommand: (command, args) => {
          expect(command).toBe("/usr/bin/mdfind");
          const query = args[0] ?? "";
          if (!query.includes("com.openai.codex")) {
            return {
              status: 0,
              stdout: "",
            };
          }
          return {
            status: 0,
            stdout: "/Volumes/Tools/Codex.app\n",
          };
        },
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual(["codex", "file-manager"]);
  });

  it("does not list Codex on macOS when only the app bundle is found but the bundled executable is missing", () => {
    const editors = listAvailableEditors(
      "darwin",
      { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      {
        homeDirectory: "/Users/tester",
        pathExists: (path) => path === "/Applications/Codex.app" || path === "/usr/bin/open",
        readTextFile: (filePath) => {
          expect(filePath).toBe("/Applications/Codex.app/Contents/Info.plist");
          return `
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0">
              <dict>
                <key>CFBundleExecutable</key>
                <string>Codex</string>
              </dict>
            </plist>
          `;
        },
        runCommand: () => ({
          status: 0,
          stdout: "",
        }),
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual(["file-manager"]);
  });

  it("finds versioned macOS apps from Spotlight metadata by bundle identifier", () => {
    const editors = listAvailableEditors(
      "darwin",
      { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      {
        homeDirectory: "/Users/tester",
        pathExists: (path) => path === "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app" || path === "/usr/bin/open",
        runCommand: (_command, args) => {
          const query = args[0] ?? "";
          if (!query.includes("com.jetbrains.intellij")) {
            return {
              status: 0,
              stdout: "",
            };
          }
          return {
            status: 0,
            stdout: "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app\n",
          };
        },
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual(["intellij", "file-manager"]);
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

  it("detects Codex in versioned Windows app package directories", () => {
    const editors = listAvailableEditors(
      "win32",
      {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
      },
      {
        pathExists: (path) =>
          path === "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\app\\Codex.exe",
        readDirectory: (path) => {
          if (path === "C:\\Program Files\\WindowsApps") {
            return ["OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0"];
          }
          throw new Error(`ENOENT: ${path}`);
        },
        readTextFile: (filePath) => {
          expect(filePath).toBe(
            "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\AppxManifest.xml",
          );
          return `
            <Package>
              <Applications>
                <Application Id="App" Executable="app\\Codex.exe" />
              </Applications>
            </Package>
          `;
        },
      },
    );

    expect(editors.map((editor) => editor.id)).toContain("codex");
  });

  it("reuses cached macOS Spotlight discovery across async availability and icon lookup", async () => {
    let mdfindCalls = 0;
    const env = { HOME: "/Users/tester", PATH: "/usr/bin:/bin" };
    const options = {
      cacheNamespace: "cache-reuse-test",
      homeDirectory: "/Users/tester",
      pathExists: (filePath: string) =>
        filePath === "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app" ||
        filePath === "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app/Contents/Resources/intellij.icns" ||
        filePath === "/usr/bin/open",
      readTextFile: (filePath: string) => {
        expect(filePath).toBe("/Volumes/JetBrains/IntelliJ IDEA 2026.1.app/Contents/Info.plist");
        return `
          <?xml version="1.0" encoding="UTF-8"?>
          <plist version="1.0">
            <dict>
              <key>CFBundleIconFile</key>
              <string>intellij.icns</string>
            </dict>
          </plist>
        `;
      },
      runCommandAsync: async (_command: string, args: string[]) => {
        mdfindCalls += 1;
        const query = args[0] ?? "";
        if (!query.includes("com.jetbrains.intellij")) {
          return {
            status: 0,
            stdout: "",
          };
        }
        return {
          status: 0,
          stdout: "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app\n",
        };
      },
    };

    const editors = await listAvailableEditorsAsync("darwin", env, options);
    const mdfindCallsAfterList = mdfindCalls;
    const iconPath = await getEditorSystemIconPathAsync("intellij", "darwin", env, options);

    expect(editors.map((editor) => editor.id)).toEqual(["intellij", "file-manager"]);
    expect(iconPath).toBe("/Volumes/JetBrains/IntelliJ IDEA 2026.1.app/Contents/Resources/intellij.icns");
    expect(mdfindCallsAfterList).toBeGreaterThan(0);
    expect(mdfindCalls).toBe(mdfindCallsAfterList);
  });

  it("does not cache missing macOS Spotlight results across async calls", async () => {
    let appInstalled = false;
    const env = { HOME: "/Users/tester", PATH: "/usr/bin:/bin" };
    const options = {
      cacheNamespace: "stale-miss-test",
      homeDirectory: "/Users/tester",
      pathExists: (filePath: string) =>
        filePath === "/usr/bin/open" ||
        (appInstalled &&
          (filePath === "/Volumes/Tools/Codex.app" ||
            filePath === "/Volumes/Tools/Codex.app/Contents/MacOS/Codex")),
      readTextFile: (filePath: string) => {
        expect(filePath).toBe("/Volumes/Tools/Codex.app/Contents/Info.plist");
        return `
          <?xml version="1.0" encoding="UTF-8"?>
          <plist version="1.0">
            <dict>
              <key>CFBundleExecutable</key>
              <string>Codex</string>
            </dict>
          </plist>
        `;
      },
      runCommandAsync: async (_command: string, args: string[]) => {
        const query = args[0] ?? "";
        if (!query.includes("com.openai.codex")) {
          return {
            status: 0,
            stdout: "",
          };
        }
        return {
          status: 0,
          stdout: appInstalled ? "/Volumes/Tools/Codex.app\n" : "",
        };
      },
    };

    const editorsBeforeInstall = await listAvailableEditorsAsync("darwin", env, options);
    appInstalled = true;
    const editorsAfterInstall = await listAvailableEditorsAsync("darwin", env, options);

    expect(editorsBeforeInstall.map((editor) => editor.id)).toEqual(["file-manager"]);
    expect(editorsAfterInstall.map((editor) => editor.id)).toContain("codex");
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

  it("passes the codex app subcommand before the target path when the CLI shim is on PATH", () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "kickstart-codex-"));
    const shimPath = path.join(tempDirectory, "codex");

    try {
      writeFileSync(shimPath, "#!/bin/sh\nexit 0\n");
      chmodSync(shimPath, 0o755);

      expect(
        getEditorLaunchCommand(
          "project-path",
          "codex",
          "darwin",
          {
            HOME: "/Users/tester",
            PATH: `/usr/bin:/bin:${tempDirectory}`,
          },
        ),
      ).toEqual({
        args: ["app", "project-path"],
        command: "codex",
      });
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  });

  it("uses the bundled Codex executable when the app is installed but the CLI shim is unavailable", () => {
    expect(
      getEditorLaunchCommand(
        "project-path",
        "codex",
        "darwin",
        {
          HOME: "/Users/tester",
          PATH: "/usr/bin:/bin",
        },
        {
          homeDirectory: "/Users/tester",
          pathExists: (path) =>
            path === "/Applications/Codex.app" ||
            path === "/Applications/Codex.app/Contents/MacOS/Codex" ||
            path === "/usr/bin/open",
          readTextFile: (filePath) => {
            expect(filePath).toBe("/Applications/Codex.app/Contents/Info.plist");
            return `
              <?xml version="1.0" encoding="UTF-8"?>
              <plist version="1.0">
                <dict>
                  <key>CFBundleExecutable</key>
                  <string>Codex</string>
                </dict>
              </plist>
            `;
          },
        },
      ),
    ).toEqual({
      args: ["app", "project-path"],
      command: "/Applications/Codex.app/Contents/MacOS/Codex",
    });
  });

  it("throws for Codex on macOS when the app bundle is present but no launchable executable exists", () => {
    expect(() =>
      getEditorLaunchCommand(
        "project-path",
        "codex",
        "darwin",
        {
          HOME: "/Users/tester",
          PATH: "/usr/bin:/bin",
        },
        {
          homeDirectory: "/Users/tester",
          pathExists: (path) => path === "/Applications/Codex.app" || path === "/usr/bin/open",
          readTextFile: (filePath) => {
            expect(filePath).toBe("/Applications/Codex.app/Contents/Info.plist");
            return `
              <?xml version="1.0" encoding="UTF-8"?>
              <plist version="1.0">
                <dict>
                  <key>CFBundleExecutable</key>
                  <string>Codex</string>
                </dict>
              </plist>
            `;
          },
        },
      ),
    ).toThrow("Could not find executable launch target for editor: codex");
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

  it("launches Codex from a versioned Windows app package when the launcher shim is unavailable", () => {
    expect(
      getEditorLaunchCommand(
        "project-path",
        "codex",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
          PATH: "C:\\Windows\\System32",
          ProgramFiles: "C:\\Program Files",
        },
        {
          pathExists: (path) =>
            path === "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\app\\Codex.exe",
          readDirectory: (path) => {
            if (path === "C:\\Program Files\\WindowsApps") {
              return ["OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0"];
            }
            throw new Error(`ENOENT: ${path}`);
          },
          readTextFile: (filePath) => {
            expect(filePath).toBe(
              "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\AppxManifest.xml",
            );
            return `
              <Package>
                <Applications>
                  <Application Id="App" Executable="app\\Codex.exe" />
                </Applications>
              </Package>
            `;
          },
        },
      ),
    ).toEqual({
      args: ["project-path"],
      command: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\app\\Codex.exe",
    });
  });

  it("resolves async launch commands using cached macOS discovery", async () => {
    const launch = await getEditorLaunchCommandAsync(
      "project-path",
      "intellij",
      "darwin",
      { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      {
        cacheNamespace: "async-launch-test",
        homeDirectory: "/Users/tester",
        pathExists: (filePath) => filePath === "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app" || filePath === "/usr/bin/open",
        runCommandAsync: async (_command, args) => {
          const query = args[0] ?? "";
          if (!query.includes("com.jetbrains.intellij")) {
            return {
              status: 0,
              stdout: "",
            };
          }
          return {
            status: 0,
            stdout: "/Volumes/JetBrains/IntelliJ IDEA 2026.1.app\n",
          };
        },
      },
    );

    expect(launch).toEqual({
      args: ["-n", "-a", "IntelliJ IDEA 2026.1", "--args", "project-path"],
      command: "open",
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
