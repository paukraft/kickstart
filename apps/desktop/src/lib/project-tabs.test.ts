import { describe, expect, it, vi } from "vitest";

import { GENERAL_SPACE_ID, type ProjectTabRecord } from "@kickstart/contracts";

import { ensureProjectTab } from "./project-tabs";

function createCommandTab(projectId: string, tabId: string): ProjectTabRecord {
  return {
    commandId: tabId.replace("command:", ""),
    createdAt: "2026-03-22T00:00:00.000Z",
    id: tabId,
    kind: "command",
    projectId,
    shellCwd: null,
    sortOrder: 0,
    title: "Dev",
    updatedAt: "2026-03-22T00:00:00.000Z",
  };
}

describe("ensureProjectTab", () => {
  it("returns the existing tab without syncing", async () => {
    const tab = createCommandTab("project-1", "command:dev");
    const syncProjectTabs = vi.fn(async () => {});

    const result = await ensureProjectTab({
      getTab: () => tab,
      projectId: "project-1",
      syncProjectTabs,
      tabId: tab.id,
    });

    expect(result).toEqual(tab);
    expect(syncProjectTabs).not.toHaveBeenCalled();
  });

  it("syncs project tabs when a command tab is missing", async () => {
    const tab = createCommandTab("project-1", "command:dev");
    const getTab = vi
      .fn<() => ProjectTabRecord | null>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(tab);
    const syncProjectTabs = vi.fn(async () => {});

    const result = await ensureProjectTab({
      getTab,
      projectId: "project-1",
      syncProjectTabs,
      tabId: tab.id,
    });

    expect(result).toEqual(tab);
    expect(syncProjectTabs).toHaveBeenCalledOnce();
  });

  it("does not sync the general space", async () => {
    const syncProjectTabs = vi.fn(async () => {});

    const result = await ensureProjectTab({
      getTab: () => null,
      projectId: GENERAL_SPACE_ID,
      syncProjectTabs,
      tabId: "shell:general",
    });

    expect(result).toBeNull();
    expect(syncProjectTabs).not.toHaveBeenCalled();
  });
});
