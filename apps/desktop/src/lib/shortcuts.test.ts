import { describe, expect, it } from "vitest";

import {
  formatShortcutAccelerator,
  formatShortcutGroupAccelerators,
  getShortcutDefinitionsForDialog,
} from "./shortcuts";

describe("getShortcutDefinitionsForDialog", () => {
  it("groups numbered tab shortcuts into a single dialog row", () => {
    expect(getShortcutDefinitionsForDialog()).toEqual([
      {
        rows: [
          {
            accelerators: ["CommandOrControl+T"],
            id: "new-shell-tab",
            label: "New shell tab",
          },
          {
            accelerators: ["CommandOrControl+W"],
            id: "close-tab",
            label: "Close active shell tab",
          },
          {
            accelerators: ["CommandOrControl+Shift+["],
            id: "select-previous-tab",
            label: "Select previous tab",
          },
          {
            accelerators: ["CommandOrControl+Shift+]"],
            id: "select-next-tab",
            label: "Select next tab",
          },
          {
            accelerators: [
              "CommandOrControl+1",
              "CommandOrControl+2",
              "CommandOrControl+3",
              "CommandOrControl+4",
              "CommandOrControl+5",
              "CommandOrControl+6",
              "CommandOrControl+7",
              "CommandOrControl+8",
              "CommandOrControl+9",
            ],
            id: "select-tab-by-number",
            label: "Jump to tab",
          },
        ],
        title: "Tabs",
      },
      {
        rows: [
          {
            accelerators: ["CommandOrControl+K"],
            id: "toggle-project-command-menu",
            label: "Open project command menu",
          },
          {
            accelerators: ["CommandOrControl+O"],
            id: "open-project",
            label: "Open project folder",
          },
          {
            accelerators: ["CommandOrControl+,"],
            id: "open-project-settings",
            label: "Open project settings",
          },
        ],
        title: "Projects",
      },
    ]);
  });
});

describe("formatShortcutGroupAccelerators", () => {
  it("compresses numeric shortcut ranges", () => {
    expect(
      formatShortcutGroupAccelerators(
        ["CommandOrControl+1", "CommandOrControl+2", "CommandOrControl+3"],
        "darwin",
      ),
    ).toBe("Cmd+1-3");
  });

  it("falls back to a comma-separated list when tokens do not form a numeric range", () => {
    expect(
      formatShortcutGroupAccelerators(
        ["CommandOrControl+Shift+[", "CommandOrControl+Shift+]"],
        "darwin",
      ),
    ).toBe(
      [
        formatShortcutAccelerator("CommandOrControl+Shift+[", "darwin"),
        formatShortcutAccelerator("CommandOrControl+Shift+]", "darwin"),
      ].join(", "),
    );
  });
});
