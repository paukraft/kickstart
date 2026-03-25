import type { ShortcutActionId } from "@kickstart/contracts";

export type ShortcutMenuSection = "app" | "file" | "navigate" | "help";
export type ShortcutDialogSection = "Tabs" | "Projects";

interface ShortcutDialogGroup {
  id: string;
  label: string;
}

export interface ShortcutDefinition {
  id: ShortcutActionId;
  accelerator?: string;
  dialogGroup?: ShortcutDialogGroup;
  dialogSection?: ShortcutDialogSection;
  label: string;
  menuLabel: string;
  menuSection: ShortcutMenuSection;
}

export interface ShortcutDialogRow {
  accelerators: string[];
  id: string;
  label: string;
}

export interface ShortcutDialogDefinition {
  rows: ShortcutDialogRow[];
  title: ShortcutDialogSection;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    accelerator: "CommandOrControl+T",
    dialogSection: "Tabs",
    id: "new-shell-tab",
    label: "New shell tab",
    menuLabel: "New Shell Tab",
    menuSection: "file",
  },
  {
    accelerator: "CommandOrControl+W",
    dialogSection: "Tabs",
    id: "close-tab",
    label: "Close active shell tab",
    menuLabel: "Close Tab",
    menuSection: "file",
  },
  {
    accelerator: "CommandOrControl+Shift+[",
    dialogSection: "Tabs",
    id: "select-previous-tab",
    label: "Select previous tab",
    menuLabel: "Previous Tab",
    menuSection: "navigate",
  },
  {
    accelerator: "CommandOrControl+Shift+]",
    dialogSection: "Tabs",
    id: "select-next-tab",
    label: "Select next tab",
    menuLabel: "Next Tab",
    menuSection: "navigate",
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    accelerator: `CommandOrControl+${index + 1}`,
    dialogGroup: {
      id: "select-tab-by-number",
      label: "Jump to tab",
    },
    dialogSection: "Tabs" as const,
    id: `select-tab-${index + 1}` as ShortcutActionId,
    label: `Jump to tab ${index + 1}`,
    menuLabel: `Tab ${index + 1}`,
    menuSection: "navigate" as const,
  })),
  {
    accelerator: "CommandOrControl+K",
    dialogSection: "Projects",
    id: "toggle-project-command-menu",
    label: "Open project command menu",
    menuLabel: "Command Menu",
    menuSection: "navigate",
  },
  {
    accelerator: "CommandOrControl+O",
    dialogSection: "Projects",
    id: "open-project",
    label: "Open project folder",
    menuLabel: "Open Project...",
    menuSection: "file",
  },
  {
    accelerator: "CommandOrControl+,",
    dialogSection: "Projects",
    id: "open-project-settings",
    label: "Open project settings",
    menuLabel: "Settings...",
    menuSection: "app",
  },
  {
    id: "show-keyboard-shortcuts",
    menuLabel: "Keyboard Shortcuts",
    label: "Show keyboard shortcuts",
    menuSection: "help",
  },
];

export function getShortcutDefinitionsForMenu(section: ShortcutMenuSection) {
  return SHORTCUT_DEFINITIONS.filter((shortcut) => shortcut.menuSection === section);
}

export function getShortcutDefinitionsForDialog() {
  const sections = new Map<ShortcutDialogSection, ShortcutDialogRow[]>();

  for (const shortcut of SHORTCUT_DEFINITIONS) {
    if (!shortcut.accelerator || !shortcut.dialogSection) {
      continue;
    }
    const rows = sections.get(shortcut.dialogSection) ?? [];
    const groupId = shortcut.dialogGroup?.id;
    const row =
      groupId !== undefined ? rows.find((candidate) => candidate.id === groupId) : undefined;
    if (row) {
      row.accelerators.push(shortcut.accelerator);
      continue;
    }
    rows.push({
      accelerators: [shortcut.accelerator],
      id: groupId ?? shortcut.id,
      label: shortcut.dialogGroup?.label ?? shortcut.label,
    });
    sections.set(shortcut.dialogSection, rows);
  }

  return [...sections.entries()].map(([title, rows]) => ({ rows, title }));
}

export function getShortcutTabIndex(actionId: ShortcutActionId) {
  const match = /^select-tab-(\d+)$/.exec(actionId);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] ?? "", 10) - 1;
}

export function formatShortcutAccelerator(
  accelerator: string,
  platform: NodeJS.Platform | "web" = "web",
) {
  return accelerator
    .split("+")
    .map((token) => formatShortcutToken(token, platform))
    .join("+");
}

export function formatShortcutGroupAccelerators(
  accelerators: string[],
  platform: NodeJS.Platform | "web" = "web",
) {
  if (accelerators.length === 0) {
    return "";
  }

  const tokenGroups = accelerators.map((accelerator) =>
    accelerator.split("+").map((token) => formatShortcutToken(token, platform)),
  );
  const tokenCount = tokenGroups[0]?.length ?? 0;

  if (!tokenGroups.every((tokens) => tokens.length === tokenCount)) {
    return accelerators.map((accelerator) => formatShortcutAccelerator(accelerator, platform)).join(", ");
  }

  const varyingPositions: number[] = [];
  for (let index = 0; index < tokenCount; index += 1) {
    const firstToken = tokenGroups[0]?.[index];
    if (!tokenGroups.every((tokens) => tokens[index] === firstToken)) {
      varyingPositions.push(index);
    }
  }

  if (varyingPositions.length !== 1) {
    return accelerators.map((accelerator) => formatShortcutAccelerator(accelerator, platform)).join(", ");
  }

  const varyingPosition = varyingPositions[0]!;
  const values = tokenGroups.map((tokens) => tokens[varyingPosition]!);

  if (!values.every((value) => /^\d+$/.test(value))) {
    return accelerators.map((accelerator) => formatShortcutAccelerator(accelerator, platform)).join(", ");
  }

  const numbers = [...new Set(values.map((value) => Number.parseInt(value, 10)))].sort((a, b) => a - b);
  const displayValues = formatNumericShortcutSequence(numbers);
  const combinedTokens = [...tokenGroups[0]!];
  combinedTokens[varyingPosition] = displayValues;
  return combinedTokens.join("+");
}

function formatShortcutToken(token: string, platform: NodeJS.Platform | "web") {
  const isMac =
    platform === "darwin" ||
    (platform === "web" &&
      typeof navigator !== "undefined" &&
      navigator.platform.toLowerCase().includes("mac"));

  if (token === "CommandOrControl" || token === "CmdOrCtrl") {
    return isMac ? "Cmd" : "Ctrl";
  }
  if (token === "Command") {
    return "Cmd";
  }
  if (token === "Control") {
    return "Ctrl";
  }
  if (token === "Alt") {
    return isMac ? "Option" : "Alt";
  }
  return token;
}

function formatNumericShortcutSequence(values: number[]) {
  if (values.length === 0) {
    return "";
  }

  const ranges: string[] = [];
  let rangeStart = values[0]!;
  let previous = values[0]!;

  for (const value of values.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
    rangeStart = value;
    previous = value;
  }

  ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
  return ranges.join(", ");
}
