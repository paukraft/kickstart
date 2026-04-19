import {
  RiAddLine,
  RiCodeLine,
  RiDeleteBinLine,
  RiFlashlightLine,
  RiLoader4Line,
  RiPlayLine,
  RiRefreshLine,
  RiSettings4Line,
  RiStopLine,
  RiTerminalLine,
  RiUserLine,
} from "@remixicon/react";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { AnimatedBars, RUNTIME_COLORS, RUNTIME_RGB } from "@/components/app/runtime-indicators";
import {
  createCommandTabId,
  isActionCommand,
  isServiceCommand,
  isTerminalSessionLoading,
  isTerminalSessionTransitioning,
  type CommandSource,
  type ProjectTabRecord,
  type ProjectWithRuntime,
  type ResolvedCommandConfig,
  type TerminalSessionSnapshot,
} from "@kickstart/contracts";

import { OpenInEditorControl } from "@/components/app/open-in-editor-control";
import { Button } from "@/components/ui/button";
import { commandByTabId } from "@/lib/command-utils";
import { cn } from "@/lib/utils";

function triggerInlineControl(
  event: React.MouseEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.stopPropagation();
  action();
}

function handleRowActivationKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  action: () => void,
) {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  action();
}

function ActionItem({
  command,
  tab,
  session,
  active,
  dragGroup,
  index,
  onSelect,
  onRun,
  onRestart,
  onStop,
  onEdit,
}: {
  command: ResolvedCommandConfig;
  tab: ProjectTabRecord | undefined;
  session: TerminalSessionSnapshot | undefined;
  active: boolean;
  dragGroup: string;
  index: number;
  onSelect: () => void;
  onRun: () => void;
  onRestart: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const tabId = tab?.id ?? createCommandTabId(command.id);
  const { isDragging, ref } = useSortable({
    group: dragGroup,
    id: tabId,
    index,
  });
  const isTransitioning = session ? isTerminalSessionTransitioning(session.status) : false;
  const isLoading = session ? isTerminalSessionLoading(session.status) : false;
  const isRunning = Boolean(session?.hasActiveProcess);

  return (
    <div
      ref={ref as (element: HTMLDivElement | null) => void}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => handleRowActivationKey(event, onSelect)}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors overflow-hidden cursor-pointer",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        isDragging && "opacity-65 cursor-grabbing",
      )}
    >
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="loading"
            className="pointer-events-none absolute inset-0 rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="absolute inset-0 rounded-lg"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(${RUNTIME_RGB.starting}, 0.18) 50%, transparent 100%)`,
                backgroundSize: "200% 100%",
              }}
              animate={{ backgroundPosition: ["-100% 0%", "200% 0%"] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>
        )}
        {isRunning && !isLoading && (
          <motion.div
            key="running"
            className="pointer-events-none absolute inset-0 rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              className="absolute inset-0 rounded-lg"
              animate={{
                background: [
                  `radial-gradient(ellipse 80% 80% at 20% 100%, rgba(${RUNTIME_RGB.running}, 0.18) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 70% at 70% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.12) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 80% at 50% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.15) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 70% at 30% 100%, rgba(${RUNTIME_RGB.running}, 0.15) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 80% at 80% 100%, rgba(${RUNTIME_RGB.running}, 0.12) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 70% at 40% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.18) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 80% at 20% 100%, rgba(${RUNTIME_RGB.running}, 0.18) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 70% at 70% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.12) 0%, transparent 60%)`,
                ],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex size-5 shrink-0 items-center justify-center">
        {isLoading ? (
          <RiLoader4Line className="size-3.5 animate-spin" />
        ) : isRunning ? (
          <AnimatedBars size={12} color={RUNTIME_COLORS.running} barWidth={1.5} gap={0.5} />
        ) : (
          <RiFlashlightLine className="size-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 flex-1 truncate text-sm font-medium leading-tight">{command.name}</span>
          {command.source === "local" && (
            <span className="shrink-0 text-amber-500/60 dark:text-amber-400/50" title="Personal command (not shared with team)">
              <RiUserLine className="size-3" />
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          "desktop-no-drag flex shrink-0 items-center gap-0.5 transition-opacity",
          "opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100",
          "group-hover:pointer-events-auto group-focus-within:pointer-events-auto",
        )}
      >
        {tab && (
          <>
            {isRunning ? (
              <>
                <Button
                  disabled={isTransitioning}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={(e) => {
                    triggerInlineControl(e, () => {
                      if (isTransitioning) return;
                      onRestart();
                    });
                  }}
                >
                  <RiRefreshLine />
                </Button>
                <Button
                  disabled={isTransitioning}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={(e) => {
                    triggerInlineControl(e, () => {
                      if (isTransitioning) return;
                      onStop();
                    });
                  }}
                >
                  <RiStopLine />
                </Button>
              </>
            ) : (
              <Button
                disabled={isTransitioning}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={(e) => {
                  triggerInlineControl(e, () => {
                    if (isTransitioning) return;
                    onRun();
                  });
                }}
              >
                {isLoading ? (
                  <RiLoader4Line className="animate-spin" />
                ) : (
                  <RiPlayLine />
                )}
              </Button>
            )}
          </>
        )}
        <Button
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={(e) => {
            triggerInlineControl(e, onEdit);
          }}
        >
          <RiSettings4Line />
        </Button>
      </div>
    </div>
  );
}

const COMMAND_SOURCE_SECTIONS = [
  { source: "shared" },
  { source: "local" },
] as const satisfies ReadonlyArray<{ source: CommandSource }>;

interface TabItemProps {
  active: boolean;
  isEditing?: boolean;
  editDraft?: string;
  isBooting?: boolean;
  isLoading?: boolean;
  isPersonal?: boolean;
  isRunning?: boolean;
  kind: "command" | "shell";
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  onClick: () => void;
  onDoubleClick?: () => void;
  onEditChange?: (value: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
  onMouseDown?: (event: React.MouseEvent<HTMLElement>) => void;
  itemRef?: (element: HTMLDivElement | null) => void;
  isDragging?: boolean;
}

function TabItem({
  active,
  isEditing = false,
  editDraft,
  isBooting = false,
  isLoading = false,
  isPersonal = false,
  isRunning = false,
  kind,
  title,
  subtitle,
  actions,
  onClick,
  onDoubleClick,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onMouseDown,
  itemRef,
  isDragging = false,
}: TabItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = isLoading
    ? RiLoader4Line
    : kind === "command"
      ? RiCodeLine
      : RiTerminalLine;

  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  return (
    <div
      ref={itemRef}
      onClick={() => {
        if (isEditing) return;
        onClick();
      }}
      onDoubleClick={() => {
        if (isEditing) return;
        onDoubleClick?.();
      }}
      onKeyDown={(event) => {
        if (!isEditing) handleRowActivationKey(event, onClick);
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all overflow-hidden cursor-pointer",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        isDragging && "cursor-grabbing",
        isDragging && "opacity-65",
      )}
    >
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="loading"
            className="pointer-events-none absolute inset-0 rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              className="absolute inset-0 rounded-lg"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(${RUNTIME_RGB.starting}, 0.12) 50%, transparent 100%)`,
                backgroundSize: "200% 100%",
              }}
              animate={{ backgroundPosition: ["-100% 0%", "200% 0%"] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <div
              className="absolute inset-0 rounded-lg"
              style={{
                background: `radial-gradient(ellipse 90% 40% at 50% 100%, rgba(${RUNTIME_RGB.starting}, 0.06) 0%, transparent 60%)`,
              }}
            />
          </motion.div>
        )}
        {isBooting && !isLoading && (
          <motion.svg
            key="booting"
            className="pointer-events-none absolute inset-0 h-full w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            aria-hidden
          >
            <rect className="booting-rect" pathLength={1} />
          </motion.svg>
        )}
        {isRunning && !isLoading && (
          <motion.div
            key="running"
            className="pointer-events-none absolute inset-0 rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              background: `
                radial-gradient(ellipse 80% 50% at 20% 100%, rgba(${RUNTIME_RGB.running}, 0.12) 0%, transparent 70%),
                radial-gradient(ellipse 60% 40% at 70% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.08) 0%, transparent 60%),
                radial-gradient(ellipse 90% 35% at 50% 100%, rgba(${RUNTIME_RGB.running}, 0.06) 0%, transparent 50%)
              `,
            }}
          >
            <motion.div
              className="absolute inset-0 rounded-lg"
              animate={{
                background: [
                  `radial-gradient(ellipse 80% 50% at 20% 100%, rgba(${RUNTIME_RGB.running}, 0.12) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 40% at 70% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.08) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 50% at 50% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.10) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 40% at 30% 100%, rgba(${RUNTIME_RGB.running}, 0.10) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 50% at 80% 100%, rgba(${RUNTIME_RGB.running}, 0.08) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 40% at 40% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.12) 0%, transparent 60%)`,
                  `radial-gradient(ellipse 80% 50% at 20% 100%, rgba(${RUNTIME_RGB.running}, 0.12) 0%, transparent 70%),
                   radial-gradient(ellipse 60% 40% at 70% 100%, rgba(${RUNTIME_RGB.runningLight}, 0.08) 0%, transparent 60%)`,
                ],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity",
          isBooting && "opacity-60",
        )}
        onMouseDown={onMouseDown}
      >
        <div className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          active ? "bg-foreground/[0.07]" : "bg-transparent group-hover:bg-foreground/[0.05]",
        )}>
          {isRunning && !isLoading ? (
            <AnimatedBars size={14} color={RUNTIME_COLORS.running} barWidth={2} gap={1} />
          ) : (
            <Icon
              className={cn(
                "size-3.5",
                isLoading && "animate-spin",
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1 text-sm font-medium leading-tight">
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="w-full rounded bg-transparent outline-none ring-1 ring-border px-1 -mx-1"
                  value={editDraft ?? ""}
                  onChange={(e) => onEditChange?.(e.target.value)}
                  onBlur={() => onEditCommit?.()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onEditCommit?.();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onEditCancel?.();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="block w-full min-w-0 truncate"
                  onClick={
                    active && onDoubleClick
                      ? (e) => {
                          e.stopPropagation();
                          onDoubleClick();
                        }
                      : undefined
                  }
                >
                  {title}
                </span>
              )}
            </div>
            {isPersonal && (
              <span className="shrink-0 text-amber-500/60 dark:text-amber-400/50" title="Personal command (not shared with team)">
                <RiUserLine className="size-3" />
              </span>
            )}
          </div>
          {!isEditing && (
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {!isEditing && (
        <div
          className={cn(
            "desktop-no-drag flex shrink-0 items-center gap-0.5 transition-opacity",
            "opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100",
            "group-hover:pointer-events-auto group-focus-within:pointer-events-auto",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  label,
  buttonLabel,
  onButtonClick,
}: {
  label: string;
  buttonLabel: string;
  onButtonClick: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <Button className="desktop-no-drag" onClick={onButtonClick} size="xs" variant="ghost">
        <RiAddLine />
        {buttonLabel}
      </Button>
    </div>
  );
}

export interface ProjectSidebarProps {
  project: ProjectWithRuntime | null;
  commands: ResolvedCommandConfig[];
  commandTabs: ProjectTabRecord[];
  shellTabs: ProjectTabRecord[];
  activeTabId: string | null;
  terminalSessions: Record<string, TerminalSessionSnapshot>;
  showCommands?: boolean;
  onSelectTab: (tabId: string) => void;
  onRunTab: (tab: ProjectTabRecord) => void;
  onRestartTab: (tab: ProjectTabRecord) => void;
  onStopTab: (tab: ProjectTabRecord) => void;
  onEditCommand: (command: ResolvedCommandConfig) => void;
  onAddCommand: () => void;
  onCreateShellTab: () => void;
  onDeleteShellTab: (tabId: string) => void;
  onRenameShellTab: (tabId: string, title: string) => void;
  onReorderCommands: (
    source: CommandSource,
    type: ResolvedCommandConfig["type"],
    sourceId: string,
    targetId: string,
  ) => void;
  onReorderShellTabs: (sourceId: string, targetId: string) => void;
}

function SortableTabItem({
  activeTabId,
  commands,
  dragGroup,
  onBeginShellRename,
  onCancelShellRename,
  onCommitShellRename,
  onDeleteShellTab,
  onEditCommand,
  onRunTab,
  onRestartTab,
  onSelectTab,
  onShellRenameDraftChange,
  onStopTab,
  renamingShellTabId,
  shellRenameDraft,
  tab,
  terminalSessions,
}: {
  activeTabId: string | null;
  commands: ResolvedCommandConfig[];
  dragGroup: string;
  onBeginShellRename?: (tab: ProjectTabRecord) => void;
  onCancelShellRename?: () => void;
  onCommitShellRename?: (tab: ProjectTabRecord) => void;
  onDeleteShellTab: (tabId: string) => void;
  onEditCommand: (command: ResolvedCommandConfig) => void;
  onRunTab: (tab: ProjectTabRecord) => void;
  onRestartTab: (tab: ProjectTabRecord) => void;
  onSelectTab: (tabId: string) => void;
  onShellRenameDraftChange?: (title: string) => void;
  onStopTab: (tab: ProjectTabRecord) => void;
  renamingShellTabId?: string | null;
  shellRenameDraft?: string;
  tab: ProjectTabRecord;
  terminalSessions: Record<string, TerminalSessionSnapshot>;
}) {
  const sensors = useMemo(
    () =>
      tab.kind === "shell"
        ? [
            PointerSensor.configure({
              activationConstraints: [
                new PointerActivationConstraints.Distance({ value: 5 }),
              ],
            }),
          ]
        : undefined,
    [tab.kind],
  );
  const { isDragging, ref } = useSortable({
    group: dragGroup,
    id: tab.id,
    index: tab.sortOrder,
    sensors,
  });

  const command = tab.kind === "command" ? commandByTabId(commands, tab.id) : null;
  const session = terminalSessions[tab.id];
  const isTransitioning = session ? isTerminalSessionTransitioning(session.status) : false;
  const isLoading = session ? isTerminalSessionLoading(session.status) : false;
  const isBooting = session?.status === "booting";
  const isRunning = Boolean(session?.hasActiveProcess);
  const isEditing = tab.kind === "shell" && renamingShellTabId === tab.id;
  const subtitle = isBooting
    ? "Booting…"
    : session?.lastCommand
      ? `Last: ${session.lastCommand}`
      : tab.kind === "command"
        ? `${command?.source === "local" ? "Personal" : "Shared"} · ${command?.type === "action" ? "Action" : "Service"} · ${command?.startMode === "auto" ? "Auto" : "Manual"}`
        : "Shell";

  return (
    <TabItem
      active={activeTabId === tab.id}
      isDragging={isDragging}
      isEditing={isEditing}
      editDraft={shellRenameDraft}
      isBooting={isBooting}
      isLoading={isLoading}
      isPersonal={command?.source === "local"}
      isRunning={isRunning}
      kind={tab.kind}
      title={tab.title}
      subtitle={subtitle}
      itemRef={ref as (element: HTMLDivElement | null) => void}
      onClick={() => onSelectTab(tab.id)}
      onDoubleClick={
        tab.kind === "shell" && !isTransitioning
          ? () => onBeginShellRename?.(tab)
          : undefined
      }
      onEditChange={onShellRenameDraftChange}
      onEditCommit={() => onCommitShellRename?.(tab)}
      onEditCancel={onCancelShellRename}
      onMouseDown={
        tab.kind === "shell"
          ? (event) => {
              if (isTransitioning) return;
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onDeleteShellTab(tab.id);
            }
          : undefined
      }
      actions={
        tab.kind === "command" ? (
          <>
            {isRunning ? (
              <>
                <Button
                  disabled={isTransitioning}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={(event) => {
                    triggerInlineControl(event, () => {
                      if (isTransitioning) return;
                      onRestartTab(tab);
                    });
                  }}
                >
                  <RiRefreshLine />
                </Button>
                <Button
                  disabled={isTransitioning}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={(event) => {
                    triggerInlineControl(event, () => {
                      if (isTransitioning) return;
                      onStopTab(tab);
                    });
                  }}
                >
                  <RiStopLine />
                </Button>
              </>
            ) : (
              <Button
                disabled={isTransitioning}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={(event) => {
                  triggerInlineControl(event, () => {
                    if (isTransitioning) return;
                    onRunTab(tab);
                  });
                }}
              >
                {isLoading ? (
                  <RiLoader4Line className="animate-spin" />
                ) : (
                  <RiPlayLine />
                )}
              </Button>
            )}
            {command && (
              <Button
                disabled={isTransitioning}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={(event) => {
                  triggerInlineControl(event, () => onEditCommand(command));
                }}
              >
                <RiSettings4Line />
              </Button>
            )}
          </>
        ) : (
          <Button
            disabled={isTransitioning}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={(event) => {
              triggerInlineControl(event, () => {
                if (isTransitioning) return;
                onDeleteShellTab(tab.id);
              });
            }}
          >
            <RiDeleteBinLine />
          </Button>
        )
      }
    />
  );
}

export function ProjectSidebar({
  project,
  commands,
  commandTabs,
  shellTabs,
  activeTabId,
  terminalSessions,
  showCommands = true,
  onSelectTab,
  onRunTab,
  onRestartTab,
  onStopTab,
  onEditCommand,
  onAddCommand,
  onCreateShellTab,
  onDeleteShellTab,
  onRenameShellTab,
  onReorderCommands,
  onReorderShellTabs,
}: ProjectSidebarProps) {
  const [actionsOpenByProject, setActionsOpenByProject] = useState<
    Record<string, boolean>
  >({});
  const [renamingShellTabId, setRenamingShellTabId] = useState<string | null>(null);
  const [shellRenameDraft, setShellRenameDraft] = useState("");
  const actionsStateKey = project?.id ?? "general";
  const actionsOpen = actionsOpenByProject[actionsStateKey] ?? false;
  const actionCommands = commands.filter(isActionCommand);
  const serviceTabs = commandTabs.filter((tab) => {
    const command = commandByTabId(commands, tab.id);
    if (!command) return false;
    return isServiceCommand(command);
  });
  const actionCommandsBySource = {
    local: actionCommands.filter((command) => command.source === "local"),
    shared: actionCommands.filter((command) => command.source === "shared"),
  } satisfies Record<CommandSource, ResolvedCommandConfig[]>;
  const serviceTabsBySource = {
    local: serviceTabs.filter(
      (tab) => commandByTabId(commands, tab.id)?.source === "local",
    ),
    shared: serviceTabs.filter(
      (tab) => commandByTabId(commands, tab.id)?.source === "shared",
    ),
  } satisfies Record<CommandSource, ProjectTabRecord[]>;
  const showActions = actionCommands.length > 0 && actionsOpen;
  const activeActionTab =
    activeTabId == null
      ? null
      : commandTabs.find((tab) => {
          if (tab.id !== activeTabId) return false;
          const command = commandByTabId(commands, tab.id);
          return command != null && isActionCommand(command);
        }) ?? null;
  const activeActionCommand = activeActionTab
    ? commandByTabId(commands, activeActionTab.id)
    : null;
  const hasActions = actionCommands.length > 0;

  function beginShellRename(tab: ProjectTabRecord) {
    setRenamingShellTabId(tab.id);
    setShellRenameDraft(tab.title);
  }

  function cancelShellRename() {
    setRenamingShellTabId(null);
    setShellRenameDraft("");
  }

  function commitShellRename(tab: ProjectTabRecord) {
    const nextTitle = shellRenameDraft.trim();
    if (!nextTitle || nextTitle === tab.title) {
      cancelShellRename();
      return;
    }
    onRenameShellTab(tab.id, nextTitle);
    cancelShellRename();
  }

  function createDragEndHandler(onReorder: (sourceId: string, targetId: string) => void) {
    return (
      event: {
        canceled: boolean;
        operation: {
          source: { id: string | number } | null;
          target: { id: string | number } | null;
        };
      },
    ) => {
      if (event.canceled) return;
      const sourceId = event.operation.source?.id;
      const targetId = event.operation.target?.id;
      if (
        (typeof sourceId !== "string" && typeof sourceId !== "number") ||
        (typeof targetId !== "string" && typeof targetId !== "number")
      ) {
        return;
      }
      const nextSourceId = String(sourceId);
      const nextTargetId = String(targetId);
      if (nextSourceId === nextTargetId) return;
      onReorder(nextSourceId, nextTargetId);
    };
  }

  function renderSourceActions(source: CommandSource) {
    const sourceActions = actionCommandsBySource[source];
    if (sourceActions.length === 0) {
      return null;
    }

    return (
      <DragDropProvider
        key={`actions-${source}`}
        onDragEnd={createDragEndHandler((sourceId, targetId) =>
          onReorderCommands(source, "action", sourceId, targetId),
        )}
      >
        <div className="space-y-0.5">
          <AnimatePresence initial={false}>
            {sourceActions.map((command, index) => {
              const tabId = createCommandTabId(command.id);
              const tab = commandTabs.find((item) => item.id === tabId);
              const session = terminalSessions[tabId];
              const isActiveAction = activeActionCommand?.id === command.id;
              const isVisible = showActions || isActiveAction;

              if (!isVisible) {
                return null;
              }

              return (
                <motion.div
                  key={command.id}
                  layout
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <ActionItem
                    active={activeTabId === tab?.id}
                    command={command}
                    dragGroup={`action-${source}`}
                    index={index}
                    onEdit={() => onEditCommand(command)}
                    onRestart={() => tab && onRestartTab(tab)}
                    onRun={() => tab && onRunTab(tab)}
                    onSelect={() => tab && onSelectTab(tab.id)}
                    onStop={() => tab && onStopTab(tab)}
                    session={session}
                    tab={tab}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </DragDropProvider>
    );
  }

  function renderSourceServices(source: CommandSource) {
    const sourceTabs = serviceTabsBySource[source];
    if (sourceTabs.length === 0) {
      return null;
    }

    return (
      <DragDropProvider
        key={`services-${source}`}
        onDragEnd={createDragEndHandler((sourceId, targetId) =>
          onReorderCommands(source, "service", sourceId, targetId),
        )}
      >
        <div className="space-y-0.5">
          {sourceTabs.map((tab, index) => (
            <SortableTabItem
              key={tab.id}
              activeTabId={activeTabId}
              commands={commands}
              dragGroup={`command-${source}`}
              onDeleteShellTab={onDeleteShellTab}
              onEditCommand={onEditCommand}
              onRunTab={onRunTab}
              onRestartTab={onRestartTab}
              onSelectTab={onSelectTab}
              onStopTab={onStopTab}
              tab={{ ...tab, sortOrder: index }}
              terminalSessions={terminalSessions}
            />
          ))}
        </div>
      </DragDropProvider>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-4">
          {showCommands ? (
            <div>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Commands</p>
                <div className="flex items-center gap-0.5">
                  {actionCommands.length > 0 && (
                    <Button
                      className="desktop-no-drag"
                      onClick={() =>
                        setActionsOpenByProject((current) => ({
                          ...current,
                          [actionsStateKey]: !actionsOpen,
                        }))
                      }
                      size="xs"
                      variant={showActions ? "secondary" : "ghost"}
                    >
                      <RiFlashlightLine />
                      Actions
                    </Button>
                  )}
                  <Button className="desktop-no-drag" onClick={onAddCommand} size="xs" variant="ghost">
                    <RiAddLine />
                    Add
                  </Button>
                </div>
              </div>
              {hasActions ? (
                <motion.div
                  layout
                  initial={false}
                  animate={{
                    height: showActions || activeActionCommand != null ? "auto" : 0,
                    opacity: showActions || activeActionCommand != null ? 1 : 0,
                    marginBottom: showActions || activeActionCommand != null ? 8 : 0,
                  }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0.5">{COMMAND_SOURCE_SECTIONS.map((section) => renderSourceActions(section.source))}</div>
                </motion.div>
              ) : null}
              {serviceTabs.length > 0 ? (
                <div className="space-y-0.5">{COMMAND_SOURCE_SECTIONS.map((section) => renderSourceServices(section.source))}</div>
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {commands.length === 0
                    ? "Add a command to get started"
                    : "No services configured"}
                </p>
              )}
            </div>
          ) : null}

          {/* Shell tabs */}
          <div>
            <SectionHeader label="Shells" buttonLabel="New" onButtonClick={onCreateShellTab} />
            <DragDropProvider onDragEnd={createDragEndHandler(onReorderShellTabs)}>
              <div className="space-y-0.5">
                {shellTabs.map((tab, index) => (
                  <SortableTabItem
                    key={tab.id}
                    activeTabId={activeTabId}
                    commands={commands}
                    dragGroup="shell"
                    onBeginShellRename={beginShellRename}
                    onCancelShellRename={cancelShellRename}
                    onCommitShellRename={commitShellRename}
                    onDeleteShellTab={onDeleteShellTab}
                    onEditCommand={onEditCommand}
                    onShellRenameDraftChange={setShellRenameDraft}
                    onRunTab={onRunTab}
                    onRestartTab={onRestartTab}
                    renamingShellTabId={renamingShellTabId}
                    onSelectTab={onSelectTab}
                    onStopTab={onStopTab}
                    shellRenameDraft={shellRenameDraft}
                    tab={{ ...tab, sortOrder: index }}
                    terminalSessions={terminalSessions}
                  />
                ))}
              </div>
            </DragDropProvider>
          </div>
        </div>
      </div>

      {project ? (
        <div className="desktop-no-drag mt-3 shrink-0">
          <OpenInEditorControl projectPath={project.path} className="w-full" />
        </div>
      ) : null}
    </div>
  );
}
