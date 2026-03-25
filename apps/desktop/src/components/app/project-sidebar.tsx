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
} from "@remixicon/react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { AnimatedBars, RUNTIME_COLORS, RUNTIME_RGB } from "@/components/app/runtime-indicators";
import type {
  CommandConfig,
  ProjectTabRecord,
  ProjectWithRuntime,
  TerminalSessionSnapshot,
} from "@kickstart/contracts";
import { isActionCommand, isServiceCommand } from "@kickstart/contracts";

import { OpenInEditorControl } from "@/components/app/open-in-editor-control";
import { Button } from "@/components/ui/button";

function ActionItem({
  command,
  tab,
  session,
  active,
  index,
  onSelect,
  onRun,
  onRestart,
  onStop,
  onEdit,
}: {
  command: CommandConfig;
  tab: ProjectTabRecord | undefined;
  session: TerminalSessionSnapshot | undefined;
  active: boolean;
  index: number;
  onSelect: () => void;
  onRun: () => void;
  onRestart: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const tabId = tab?.id ?? command.id;
  const { isDragging, ref } = useSortable({
    group: "action",
    id: tabId,
    index,
  });
  const isBusy = session?.status === "starting" || session?.status === "stopping";
  const isRunning = Boolean(session?.hasActiveProcess);

  return (
    <div
      ref={ref as (element: HTMLDivElement | null) => void}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors cursor-grab active:cursor-grabbing overflow-hidden",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        isDragging && "opacity-65",
      )}
    >
      <AnimatePresence>
        {isBusy && (
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
        {isRunning && !isBusy && (
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
        {isBusy ? (
          <RiLoader4Line className="size-3.5 animate-spin" />
        ) : isRunning ? (
          <AnimatedBars size={12} color={RUNTIME_COLORS.running} barWidth={1.5} gap={0.5} />
        ) : (
          <RiFlashlightLine className="size-3.5" />
        )}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm">{command.name}</span>
      <div className="desktop-no-drag flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {tab && (
          <>
            {isRunning ? (
              <>
                <Button
                  disabled={isBusy}
                  size="icon-xs"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isBusy) return;
                    onRestart();
                  }}
                >
                  <RiRefreshLine />
                </Button>
                <Button
                  disabled={isBusy}
                  size="icon-xs"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isBusy) return;
                    onStop();
                  }}
                >
                  <RiStopLine />
                </Button>
              </>
            ) : (
              <Button
                disabled={isBusy}
                size="icon-xs"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isBusy) return;
                  onRun();
                }}
              >
                {isBusy ? (
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
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <RiSettings4Line />
        </Button>
      </div>
    </div>
  );
}
import { commandByTabId } from "@/lib/command-utils";
import { cn } from "@/lib/utils";

interface TabItemProps {
  active: boolean;
  isLoading?: boolean;
  isRunning?: boolean;
  kind: "command" | "shell";
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  onClick: () => void;
  onMouseDown?: (event: React.MouseEvent<HTMLElement>) => void;
  itemRef?: (element: HTMLDivElement | null) => void;
  isDragging?: boolean;
}

function TabItem({
  active,
  isLoading = false,
  isRunning = false,
  kind,
  title,
  subtitle,
  actions,
  onClick,
  onMouseDown,
  itemRef,
  isDragging = false,
}: TabItemProps) {
  const Icon = isLoading
    ? RiLoader4Line
    : kind === "command"
      ? RiCodeLine
      : RiTerminalLine;

  return (
    <div
      ref={itemRef}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all overflow-hidden",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        "cursor-grab active:cursor-grabbing",
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
        className="flex min-w-0 flex-1 items-center gap-2.5"
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
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium leading-tight">{title}</p>
          </div>
          <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="desktop-no-drag hidden shrink-0 gap-0.5 group-hover:flex">
        {actions}
      </div>
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
  commands: CommandConfig[];
  commandTabs: ProjectTabRecord[];
  shellTabs: ProjectTabRecord[];
  activeTabId: string | null;
  terminalSessions: Record<string, TerminalSessionSnapshot>;
  showCommands?: boolean;
  onSelectTab: (tabId: string) => void;
  onRunTab: (tab: ProjectTabRecord) => void;
  onRestartTab: (tab: ProjectTabRecord) => void;
  onStopTab: (tab: ProjectTabRecord) => void;
  onEditCommand: (command: CommandConfig) => void;
  onAddCommand: () => void;
  onCreateShellTab: () => void;
  onDeleteShellTab: (tabId: string) => void;
  onReorderCommands: (sourceId: string, targetId: string) => void;
  onReorderShellTabs: (sourceId: string, targetId: string) => void;
}

function SortableTabItem({
  activeTabId,
  commands,
  onDeleteShellTab,
  onEditCommand,
  onRunTab,
  onRestartTab,
  onSelectTab,
  onStopTab,
  tab,
  terminalSessions,
}: {
  activeTabId: string | null;
  commands: CommandConfig[];
  onDeleteShellTab: (tabId: string) => void;
  onEditCommand: (command: CommandConfig) => void;
  onRunTab: (tab: ProjectTabRecord) => void;
  onRestartTab: (tab: ProjectTabRecord) => void;
  onSelectTab: (tabId: string) => void;
  onStopTab: (tab: ProjectTabRecord) => void;
  tab: ProjectTabRecord;
  terminalSessions: Record<string, TerminalSessionSnapshot>;
}) {
  const { isDragging, ref } = useSortable({
    group: tab.kind,
    id: tab.id,
    index: tab.sortOrder,
  });

  const command = tab.kind === "command" ? commandByTabId(commands, tab.id) : null;
  const session = terminalSessions[tab.id];
  const isLoading = session?.status === "starting" || session?.status === "stopping";
  const isRunning = Boolean(session?.hasActiveProcess);
  const subtitle = session?.lastCommand
    ? `Last: ${session.lastCommand}`
    : tab.kind === "command"
      ? `${command?.type === "action" ? "Action" : "Service"} · ${command?.startMode === "auto" ? "Auto" : "Manual"} · ${command?.command ?? "—"}`
      : "Shell";

  return (
    <TabItem
      active={activeTabId === tab.id}
      isDragging={isDragging}
      isLoading={isLoading}
      isRunning={isRunning}
      kind={tab.kind}
      itemRef={ref as (element: HTMLDivElement | null) => void}
      onClick={() => onSelectTab(tab.id)}
      onMouseDown={
        tab.kind === "shell"
          ? (event) => {
              if (isLoading) return;
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onDeleteShellTab(tab.id);
            }
          : undefined
      }
      subtitle={subtitle}
      title={tab.title}
      actions={
        tab.kind === "command" ? (
          <>
            {isRunning ? (
              <>
                <Button
                  disabled={isLoading}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (isLoading) return;
                    onRestartTab(tab);
                  }}
                >
                  <RiRefreshLine />
                </Button>
                <Button
                  disabled={isLoading}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (isLoading) return;
                    onStopTab(tab);
                  }}
                >
                  <RiStopLine />
                </Button>
              </>
            ) : (
              <Button
                disabled={isLoading}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  if (isLoading) return;
                  onRunTab(tab);
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
                disabled={isLoading}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() => onEditCommand(command)}
              >
                <RiSettings4Line />
              </Button>
            )}
          </>
        ) : (
          <Button
            disabled={isLoading}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => {
              if (isLoading) return;
              onDeleteShellTab(tab.id);
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
  onReorderCommands,
  onReorderShellTabs,
}: ProjectSidebarProps) {
  const [actionsOpenByProject, setActionsOpenByProject] = useState<
    Record<string, boolean>
  >({});
  const actionsStateKey = project?.id ?? "general";
  const actionsOpen = actionsOpenByProject[actionsStateKey] ?? false;
  const actionCommands = commands.filter(isActionCommand);
  const visibleCommandTabs = commandTabs.filter((tab) => {
    const command = commandByTabId(commands, tab.id);
    if (!command) return false;
    return isServiceCommand(command);
  });
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
                  <DragDropProvider onDragEnd={createDragEndHandler(onReorderCommands)}>
                    <div className="space-y-0.5">
                      <AnimatePresence initial={false}>
                        {actionCommands.map((command, index) => {
                          const tabId = `command:${command.id}`;
                          const tab = commandTabs.find((item) => item.id === tabId);
                          const session = terminalSessions[tabId];
                          const isActiveAction = activeActionCommand?.id === command.id;
                          const isVisible = showActions || isActiveAction;

                          if (!isVisible) return null;

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
                                command={command}
                                tab={tab}
                                session={session}
                                active={activeTabId === tab?.id}
                                index={index}
                                onSelect={() => tab && onSelectTab(tab.id)}
                                onRun={() => tab && onRunTab(tab)}
                                onRestart={() => tab && onRestartTab(tab)}
                                onStop={() => tab && onStopTab(tab)}
                                onEdit={() => onEditCommand(command)}
                              />
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </DragDropProvider>
                </motion.div>
              ) : null}
              {visibleCommandTabs.length > 0 ? (
                <DragDropProvider onDragEnd={createDragEndHandler(onReorderCommands)}>
                  <div className="space-y-0.5">
                    {visibleCommandTabs.map((tab, index) => (
                      <SortableTabItem
                        key={tab.id}
                        activeTabId={activeTabId}
                        commands={commands}
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
