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
          path === "/Applications/Visual Studio Code.app" ||
          path === "/Applications/Zed.app" ||
          path === "/usr/bin/open",
      },
    );

    expect(editors.map((editor) => editor.id)).toEqual(["cursor", "vscode", "zed", "file-manager"]);
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
});
