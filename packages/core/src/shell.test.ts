import { describe, expect, it } from "vitest";

import { resolveDefaultShell, resolveProjectCwd } from "./shell";

describe("resolveDefaultShell", () => {
  it("uses powershell on windows", () => {
    expect(resolveDefaultShell("win32", {})).toEqual({
      args: ["-NoLogo"],
      command: "powershell.exe",
    });
  });

  it("uses login shell on unix", () => {
    expect(resolveDefaultShell("darwin", { SHELL: "/bin/zsh" })).toEqual({
      args: ["-l"],
      command: "/bin/zsh",
    });
  });
});

describe("resolveProjectCwd", () => {
  it("resolves cwd inside project root", () => {
    expect(resolveProjectCwd("/tmp/demo", "apps/web")).toBe("/tmp/demo/apps/web");
  });

  it("rejects escaping the project root", () => {
    expect(() => resolveProjectCwd("/tmp/demo", "../etc")).toThrow();
  });
});
