import { GENERAL_SPACE_ID, type ProjectTabRecord } from "@kickstart/contracts";

interface EnsureProjectTabOptions {
  getTab: (projectId: string, tabId: string) => ProjectTabRecord | null;
  projectId: string;
  syncProjectTabs: (projectId: string) => Promise<void>;
  tabId: string;
}

export async function ensureProjectTab({
  getTab,
  projectId,
  syncProjectTabs,
  tabId,
}: EnsureProjectTabOptions): Promise<ProjectTabRecord | null> {
  const existingTab = getTab(projectId, tabId);
  if (existingTab || projectId === GENERAL_SPACE_ID) {
    return existingTab;
  }

  await syncProjectTabs(projectId);
  return getTab(projectId, tabId);
}
