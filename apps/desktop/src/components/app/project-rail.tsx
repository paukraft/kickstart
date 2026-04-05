import {
  RiAddLine,
  RiFolderLine,
  RiHome5Fill,
  RiHome5Line,
} from "@remixicon/react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import type {
  ProjectGroupRecord,
  ProjectRuntimeState,
  ProjectTabState,
  ProjectWithRuntime,
  ResolvedCommandConfig,
  TerminalSessionSnapshot,
} from "@kickstart/contracts";
import { createCommandTabId } from "@kickstart/contracts";

import { ProjectDropdown } from "@/components/app/project-dropdown";
import {
  AnimatedBars,
  RUNTIME_COLORS,
} from "@/components/app/runtime-indicators";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { SeededAvatar } from "@/components/ui/seeded-avatar";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";

function ActivePill({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute -left-2 top-1/2 h-5 w-[3px] rounded-r-full bg-foreground"
          initial={{ opacity: 0, y: "-50%", scaleY: 0.5 }}
          animate={{ opacity: 1, y: "-50%", scaleY: 1 }}
          exit={{ opacity: 0, y: "-50%", scaleY: 0.5 }}
          transition={{ duration: 0.15 }}
        />
      )}
    </AnimatePresence>
  );
}

export type RailItem =
  | { type: "project"; project: ProjectWithRuntime }
  | {
      type: "group";
      group: ProjectGroupRecord;
      projects: ProjectWithRuntime[];
    };

export interface ProjectRailProps {
  railItems: RailItem[];
  selectedProjectId: string | null;
  generalSpaceId: string;
  onSelect: (projectId: string) => void;
  onAdd: () => void;
  onDropProjectOnProject: (sourceId: string, targetId: string) => void;
  onDropProjectOnGroup: (
    projectId: string,
    groupId: string,
    targetProjectId?: string,
    position?: "before" | "after",
  ) => void;
  onDropOnRail: (projectId: string) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onReorderRail: (
    sourceItem: RailItem,
    targetItem: RailItem,
    position: "before" | "after",
  ) => void;
  onReorderInGroup: (
    groupId: string,
    sourceId: string,
    targetId: string,
    position: "before" | "after",
  ) => void;
  fetchProjectRuntime: (projectId: string) => Promise<RuntimeData>;
  onOpenProjectSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

export interface DragState {
  type: "project" | "group";
  id: string;
  groupId?: string | null;
}

type DropIntent =
  | { action: "merge"; targetId: string }
  | {
      action: "reorder-before";
      targetId: string;
      scope: "rail" | "group";
      groupId?: string;
    }
  | {
      action: "reorder-after";
      targetId: string;
      scope: "rail" | "group";
      groupId?: string;
    }
  | { action: "add-to-group"; groupId: string }
  | { action: "rail-background" }
  | { action: "rail-tail" }
  | null;

type RuntimeData = {
  tabs: ProjectTabState;
  sessions: TerminalSessionSnapshot[];
  commands: ResolvedCommandConfig[];
};

type PendingDrag = {
  source: DragState;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  handle: HTMLButtonElement;
};

const DRAG_START_DISTANCE = 4;
const RAIL_EDGE_REORDER_THRESHOLD = 0.3;
const RAIL_AUTO_SCROLL_EDGE = 36;

function getReorderPosition(intent: DropIntent): "before" | "after" | null {
  if (intent?.action === "reorder-before") return "before";
  if (intent?.action === "reorder-after") return "after";
  return null;
}

function getGroupRuntimeState(
  projects: ProjectWithRuntime[],
): ProjectRuntimeState {
  if (projects.length === 0) return "not-running";
  if (projects.some((project) => project.runtimeState === "starting")) {
    return "starting";
  }
  if (projects.some((project) => project.runtimeState === "stopping")) {
    return "stopping";
  }
  if (projects.every((project) => project.runtimeState === "running")) {
    return "running";
  }
  if (projects.some((project) => project.runtimeState !== "not-running")) {
    return "partially-running";
  }
  return "not-running";
}

function pointInRect(x: number, y: number, rect: DOMRect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getRailItemZone(
  y: number,
  rect: DOMRect,
): "top" | "center" | "bottom" {
  const ratio = (y - rect.top) / rect.height;
  if (ratio < RAIL_EDGE_REORDER_THRESHOLD) return "top";
  if (ratio > 1 - RAIL_EDGE_REORDER_THRESHOLD) return "bottom";
  return "center";
}

function getNearestVerticalPosition(
  y: number,
  rect: DOMRect,
): "before" | "after" {
  return y < rect.top + rect.height / 2 ? "before" : "after";
}

function distanceExceeded(
  startX: number,
  startY: number,
  nextX: number,
  nextY: number,
) {
  return Math.hypot(nextX - startX, nextY - startY) >= DRAG_START_DISTANCE;
}

function suppressNextClick() {
  let timeoutId = 0;

  const handleClick = (event: MouseEvent) => {
    window.clearTimeout(timeoutId);
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener("click", handleClick, true);
  };

  document.addEventListener("click", handleClick, true);
  timeoutId = window.setTimeout(() => {
    document.removeEventListener("click", handleClick, true);
  }, 0);
}

function maybeAutoScroll(container: HTMLElement, clientY: number) {
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) return;

  if (clientY < rect.top + RAIL_AUTO_SCROLL_EDGE) {
    const distance = clientY - rect.top;
    const velocity = 1 - distance / RAIL_AUTO_SCROLL_EDGE;
    container.scrollTop -= Math.ceil(velocity * 16);
    return;
  }

  if (clientY > rect.bottom - RAIL_AUTO_SCROLL_EDGE) {
    const distance = rect.bottom - clientY;
    const velocity = 1 - distance / RAIL_AUTO_SCROLL_EDGE;
    container.scrollTop += Math.ceil(velocity * 16);
  }
}

function ReorderLine({ position }: { position: "before" | "after" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-primary",
        position === "before" ? "-top-1" : "-bottom-1",
      )}
    />
  );
}

function RuntimeBadge({
  state,
  className,
  small,
}: {
  state: ProjectRuntimeState;
  className?: string;
  small?: boolean;
}) {
  if (state === "not-running") return null;
  const size = small ? 10 : 12;
  const color =
    state === "running" ? RUNTIME_COLORS.running : RUNTIME_COLORS.starting;
  const barWidth = small ? 1.5 : 2;
  const gap = small ? 0.5 : 1;

  return (
    <span
      className={cn(
        "absolute -top-0.5 right-0 flex items-center justify-center rounded-full bg-background ring-2 ring-background",
        className,
      )}
    >
      <AnimatedBars size={size} color={color} barWidth={barWidth} gap={gap} />
    </span>
  );
}

function ProjectIcon({
  project,
  className,
}: {
  project: Pick<ProjectWithRuntime, "id" | "name" | "path" | "iconUrl">;
  className?: string;
}) {
  if (project.iconUrl) {
    return (
      <img
        src={project.iconUrl}
        alt=""
        draggable={false}
        className={cn(
          "pointer-events-none select-none object-contain",
          className,
        )}
      />
    );
  }

  return (
    <SeededAvatar
      seed={project.path || project.id}
      displayValue={project.name}
      variant="character"
      rounded="none"
      className={cn(
        "pointer-events-none select-none !rounded-[inherit]",
        className,
      )}
    />
  );
}

function RuntimeHoverRow({
  isRunning,
  label,
}: {
  isRunning: boolean;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isRunning ? "bg-emerald-500" : "bg-muted-foreground/30",
        )}
      />
      <span className="truncate text-xs font-mono">{label}</span>
    </div>
  );
}

function RuntimeHoverRows({
  tabs,
  sessionMap,
  commandMap,
}: {
  tabs: import("@kickstart/contracts").ProjectTabRecord[];
  sessionMap: Map<string, TerminalSessionSnapshot> | null;
  commandMap: Map<string, ResolvedCommandConfig> | null;
}) {
  const commandRows: { id: string; isRunning: boolean; label: string }[] = [];
  const shellRows: { id: string; isRunning: boolean; label: string }[] = [];

  for (const tab of tabs) {
    const session = sessionMap?.get(tab.id);
    const command = commandMap?.get(tab.id);
    const isRunning = Boolean(session?.hasActiveProcess);

    if (tab.kind === "command") {
      if (!isRunning && command?.startMode !== "auto") continue;
      const label = isRunning
        ? (session?.lastCommand ?? command?.command ?? tab.title)
        : (command?.command ?? tab.title);
      commandRows.push({ id: tab.id, isRunning, label });
      continue;
    }

    if (isRunning) {
      shellRows.push({
        id: tab.id,
        isRunning,
        label: session?.lastCommand ?? "shell",
      });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {commandRows.map((row) => (
        <RuntimeHoverRow
          key={row.id}
          isRunning={row.isRunning}
          label={row.label}
        />
      ))}
      {commandRows.length > 0 && shellRows.length > 0 && (
        <div className="my-0.5 h-px bg-border" />
      )}
      {shellRows.map((row) => (
        <RuntimeHoverRow
          key={row.id}
          isRunning={row.isRunning}
          label={row.label}
        />
      ))}
    </div>
  );
}

function ProjectButton({
  project,
  isSelected,
  onSelect,
  onPointerDown,
  compact,
  dropIntent,
  isDragging,
  fetchProjectRuntime,
  onOpenProjectSettings,
  onDeleteProject,
}: {
  project: ProjectWithRuntime;
  isSelected: boolean;
  onSelect: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  compact?: boolean;
  dropIntent: DropIntent;
  isDragging?: boolean;
  fetchProjectRuntime?: (projectId: string) => Promise<RuntimeData>;
  onOpenProjectSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  const isMergeTarget =
    dropIntent?.action === "merge" && dropIntent.targetId === project.id;
  const isReorderBefore =
    dropIntent?.action === "reorder-before" &&
    dropIntent.targetId === project.id;
  const isReorderAfter =
    dropIntent?.action === "reorder-after" &&
    dropIntent.targetId === project.id;
  const hasRuntime =
    !compact && project.runtimeState !== "not-running" && fetchProjectRuntime;

  const [runtimeData, setRuntimeData] = useState<RuntimeData | null>(null);

  useEffect(() => {
    if (!hasRuntime) {
      setRuntimeData(null);
      return;
    }

    let cancelled = false;

    void fetchProjectRuntime(project.id).then((nextRuntimeData) => {
      if (!cancelled) {
        setRuntimeData(nextRuntimeData);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchProjectRuntime, hasRuntime, project.id]);

  const sessionMap = runtimeData
    ? new Map(runtimeData.sessions.map((session) => [session.tabId, session]))
    : null;
  const commandMap = runtimeData
    ? new Map(
        runtimeData.commands.map((command) => [
          createCommandTabId(command.id),
          command,
        ]),
      )
    : null;

  const buttonContent = (
    <div
      className={cn("relative", isDragging && "opacity-65")}
      data-project-btn
    >
      {isReorderBefore && <ReorderLine position="before" />}
      <button
        className={cn(
          "desktop-no-drag flex items-center justify-center rounded-lg transition-colors touch-none cursor-pointer",
          compact ? "size-8" : "size-10",
          isDragging && "cursor-grabbing",
          isSelected
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          isMergeTarget && "rounded-2xl ring-2 ring-primary",
        )}
        draggable={false}
        onPointerDown={onPointerDown}
        onClick={onSelect}
      >
        <ProjectIcon
          project={project}
          className={cn(compact ? "size-6" : "size-8", "rounded")}
        />
      </button>
      <RuntimeBadge state={project.runtimeState} small={compact} />
      {isReorderAfter && <ReorderLine position="after" />}
    </div>
  );

  const wrappedButtonContent = (
    <ProjectDropdown
      mode="context-menu"
      project={project}
      triggerClassName="contents"
      contentSide="right"
      contentSideOffset={8}
      onSelectProject={onSelect}
      onOpenSettings={onOpenProjectSettings}
      onDeleteProject={onDeleteProject}
    >
      {buttonContent}
    </ProjectDropdown>
  );

  if (!hasRuntime || !runtimeData) return wrappedButtonContent;

  return (
    <HoverCard>
      <HoverCardTrigger delay={0} closeDelay={0} render={<div />}>
        {wrappedButtonContent}
      </HoverCardTrigger>
      <HoverCardContent side="right" sideOffset={8} className="w-52 p-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">{project.name}</span>
          <RuntimeHoverRows
            tabs={runtimeData.tabs.tabs}
            sessionMap={sessionMap}
            commandMap={commandMap}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function RailProjectItem({
  project,
  selectedProjectId,
  onSelect,
  onPointerDown,
  dragState,
  dropIntent,
  fetchProjectRuntime,
  onOpenProjectSettings,
  onDeleteProject,
}: {
  project: ProjectWithRuntime;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragState: DragState | null;
  dropIntent: DropIntent;
  fetchProjectRuntime?: (projectId: string) => Promise<RuntimeData>;
  onOpenProjectSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  const isDragging =
    dragState?.type === "project" &&
    !dragState.groupId &&
    dragState.id === project.id;

  return (
    <div
      className="relative"
      data-rail-item="project"
      data-item-id={project.id}
    >
      <ActivePill visible={selectedProjectId === project.id} />
      <ProjectButton
        project={project}
        isSelected={selectedProjectId === project.id}
        onSelect={() => onSelect(project.id)}
        onPointerDown={onPointerDown}
        dropIntent={dropIntent}
        isDragging={isDragging}
        fetchProjectRuntime={fetchProjectRuntime}
        onOpenProjectSettings={onOpenProjectSettings}
        onDeleteProject={onDeleteProject}
      />
    </div>
  );
}

function GroupProjectItem({
  groupId,
  project,
  selectedProjectId,
  onSelect,
  onPointerDown,
  dragState,
  dropIntent,
  fetchProjectRuntime,
  onOpenProjectSettings,
  onDeleteProject,
}: {
  groupId: string;
  project: ProjectWithRuntime;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragState: DragState | null;
  dropIntent: DropIntent;
  fetchProjectRuntime?: (projectId: string) => Promise<RuntimeData>;
  onOpenProjectSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  const isDragging =
    dragState?.type === "project" &&
    dragState.groupId === groupId &&
    dragState.id === project.id;

  return (
    <div
      className="relative"
      data-group-id={groupId}
      data-group-project-id={project.id}
    >
      <ActivePill visible={selectedProjectId === project.id} />
      <ProjectButton
        project={project}
        isSelected={selectedProjectId === project.id}
        onSelect={() => onSelect(project.id)}
        onPointerDown={onPointerDown}
        compact
        dropIntent={dropIntent}
        isDragging={isDragging}
        fetchProjectRuntime={fetchProjectRuntime}
        onOpenProjectSettings={onOpenProjectSettings}
        onDeleteProject={onDeleteProject}
      />
    </div>
  );
}

function CollapsedGroup({
  groupId,
  projects,
  runtimeState,
  onClick,
  onPointerDown,
  dragState,
  dropIntent,
}: {
  groupId: string;
  projects: ProjectWithRuntime[];
  runtimeState: ProjectRuntimeState;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragState: DragState | null;
  dropIntent: DropIntent;
}) {
  const preview = projects.slice(0, 4);
  const isDragging = dragState?.type === "group" && dragState.id === groupId;
  const isDropTarget =
    dropIntent?.action === "add-to-group" && dropIntent.groupId === groupId;
  const isReorderBefore =
    dropIntent?.action === "reorder-before" &&
    dropIntent.scope === "rail" &&
    dropIntent.targetId === groupId;
  const isReorderAfter =
    dropIntent?.action === "reorder-after" &&
    dropIntent.scope === "rail" &&
    dropIntent.targetId === groupId;

  return (
    <div
      className={cn("relative", isDragging && "opacity-65")}
      data-rail-item="group"
      data-item-id={groupId}
      data-group-shell={groupId}
    >
      {isReorderBefore && <ReorderLine position="before" />}
      <RuntimeBadge state={runtimeState} />
      <button
        className={cn(
          "desktop-no-drag flex size-10 cursor-pointer items-center justify-center rounded-lg bg-muted/60 transition-all touch-none hover:bg-accent",
          isDragging && "cursor-grabbing",
          isDropTarget && "scale-110 ring-2 ring-primary",
        )}
        onClick={onClick}
        onPointerDown={onPointerDown}
        data-group-toggle
        title={`${projects.length} projects`}
      >
        <div className="grid size-9 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-[4px]">
          {preview.map((project) => (
            <ProjectIcon
              key={project.id}
              project={project}
              className="size-full rounded-sm"
            />
          ))}
          {Array.from({ length: 4 - preview.length }, (_, index) => (
            <div key={`empty-${index}`} className="rounded-sm bg-muted/40" />
          ))}
        </div>
      </button>
      {isReorderAfter && <ReorderLine position="after" />}
    </div>
  );
}

function ExpandedGroup({
  group,
  projects,
  selectedProjectId,
  onSelect,
  onToggleCollapsed,
  onGroupPointerDown,
  onProjectPointerDown,
  dragState,
  dropIntent,
  fetchProjectRuntime,
  onOpenProjectSettings,
  onDeleteProject,
}: {
  group: ProjectGroupRecord;
  projects: ProjectWithRuntime[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onToggleCollapsed: () => void;
  onGroupPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onProjectPointerDown: (
    projectId: string,
  ) => (event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragState: DragState | null;
  dropIntent: DropIntent;
  fetchProjectRuntime?: (projectId: string) => Promise<RuntimeData>;
  onOpenProjectSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  const isDragging = dragState?.type === "group" && dragState.id === group.id;
  const isDropTarget =
    dropIntent?.action === "add-to-group" && dropIntent.groupId === group.id;
  const isReorderBefore =
    dropIntent?.action === "reorder-before" &&
    dropIntent.scope === "rail" &&
    dropIntent.targetId === group.id;
  const isReorderAfter =
    dropIntent?.action === "reorder-after" &&
    dropIntent.scope === "rail" &&
    dropIntent.targetId === group.id;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center",
        isDragging && "opacity-65",
      )}
      data-rail-item="group"
      data-item-id={group.id}
    >
      {isReorderBefore && <ReorderLine position="before" />}
      <div
        className={cn(
          "relative flex flex-col items-center gap-1 rounded-2xl bg-muted/40 p-1 transition-all",
          isDropTarget && "ring-2 ring-primary",
        )}
        data-group-shell={group.id}
      >
        <button
          className={cn(
            "desktop-no-drag relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors touch-none hover:bg-accent hover:text-accent-foreground",
            isDragging && "cursor-grabbing",
          )}
          onClick={onToggleCollapsed}
          onPointerDown={onGroupPointerDown}
          data-group-toggle
          title="Collapse group"
        >
          <RiFolderLine className="size-4" />
        </button>
        {projects.map((project) => (
          <GroupProjectItem
            key={project.id}
            groupId={group.id}
            project={project}
            selectedProjectId={selectedProjectId}
            onSelect={onSelect}
            onPointerDown={onProjectPointerDown(project.id)}
            dragState={dragState}
            dropIntent={dropIntent}
            fetchProjectRuntime={fetchProjectRuntime}
            onOpenProjectSettings={onOpenProjectSettings}
            onDeleteProject={onDeleteProject}
          />
        ))}
      </div>
      {isReorderAfter && <ReorderLine position="after" />}
    </div>
  );
}

export function ProjectRail({
  railItems,
  selectedProjectId,
  generalSpaceId,
  onSelect,
  onAdd,
  onDropProjectOnProject,
  onDropProjectOnGroup,
  onDropOnRail,
  onToggleGroupCollapsed,
  onReorderRail,
  onReorderInGroup,
  fetchProjectRuntime,
  onOpenProjectSettings,
  onDeleteProject,
}: ProjectRailProps) {
  const railScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent>(null);
  const lastRailItem = railItems.at(-1) ?? null;

  function clearDragState() {
    pendingDragRef.current = null;
    setActivePointerId(null);
    setDragState(null);
    setDropIntent(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }

  function findRailItem(itemId: string): RailItem | undefined {
    return railItems.find((item) =>
      item.type === "project"
        ? item.project.id === itemId
        : item.group.id === itemId,
    );
  }

  function findSourceItem(source: DragState | null): RailItem | undefined {
    if (!source || (source.type === "project" && source.groupId)) {
      return undefined;
    }
    return findRailItem(source.id);
  }

  function startPointerDrag(
    source: DragState,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pendingDragRef.current = {
      source,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      handle: event.currentTarget,
    };
    setActivePointerId(event.pointerId);
  }

  function computeDropIntent(
    source: DragState,
    clientX: number,
    clientY: number,
  ): DropIntent {
    const rail = railScrollRef.current;
    if (!rail) return null;

    const railRect = rail.getBoundingClientRect();
    if (!pointInRect(clientX, clientY, railRect)) return null;

    if (source.type === "project") {
      const groupProjectNodes = Array.from(
        rail.querySelectorAll<HTMLElement>("[data-group-project-id]"),
      );

      for (const node of groupProjectNodes) {
        const groupId = node.dataset.groupId;
        const projectId = node.dataset.groupProjectId;
        if (!groupId || !projectId) continue;

        const rect = node.getBoundingClientRect();
        if (!pointInRect(clientX, clientY, rect)) continue;
        if (source.id === projectId) return null;

        const position = getNearestVerticalPosition(clientY, rect);
        return {
          action: position === "before" ? "reorder-before" : "reorder-after",
          targetId: projectId,
          scope: "group",
          groupId,
        };
      }

      const groupShellNodes = Array.from(
        rail.querySelectorAll<HTMLElement>("[data-group-shell]"),
      );

      for (const shell of groupShellNodes) {
        const groupId = shell.dataset.groupShell;
        if (!groupId) continue;

        const rect = shell.getBoundingClientRect();
        if (!pointInRect(clientX, clientY, rect)) continue;

        const projectNodes = Array.from(
          shell.querySelectorAll<HTMLElement>("[data-group-project-id]"),
        );

        if (projectNodes.length > 0) {
          const firstProject = projectNodes[0];
          const lastProject = projectNodes.at(-1);
          const firstProjectId = firstProject?.dataset.groupProjectId;
          const lastProjectId = lastProject?.dataset.groupProjectId;
          const firstRect = firstProject?.getBoundingClientRect();
          const lastRect = lastProject?.getBoundingClientRect();

          if (
            firstProjectId &&
            firstRect &&
            clientY < firstRect.top &&
            !(source.groupId === groupId && source.id === firstProjectId)
          ) {
            return {
              action: "reorder-before",
              targetId: firstProjectId,
              scope: "group",
              groupId,
            };
          }

          if (
            lastProjectId &&
            lastRect &&
            clientY > lastRect.bottom &&
            !(source.groupId === groupId && source.id === lastProjectId)
          ) {
            return {
              action: "reorder-after",
              targetId: lastProjectId,
              scope: "group",
              groupId,
            };
          }
        }

        if (source.groupId !== groupId) {
          return { action: "add-to-group", groupId };
        }

        return null;
      }
    }

    const topLevelNodes = Array.from(
      rail.querySelectorAll<HTMLElement>("[data-rail-item]"),
    );

    for (const node of topLevelNodes) {
      const itemType = node.dataset.railItem;
      const itemId = node.dataset.itemId;
      if (!itemType || !itemId) continue;

      const rect = node.getBoundingClientRect();
      if (!pointInRect(clientX, clientY, rect)) continue;

      if (itemType === "project") {
        if (source.type === "project" && source.id === itemId) return null;

        const zone = getRailItemZone(clientY, rect);
        if (source.type === "project" && !source.groupId && zone === "center") {
          return { action: "merge", targetId: itemId };
        }

        const position =
          zone === "top"
            ? "before"
            : zone === "bottom"
              ? "after"
              : getNearestVerticalPosition(clientY, rect);
        return {
          action: position === "before" ? "reorder-before" : "reorder-after",
          targetId: itemId,
          scope: "rail",
        };
      }

      if (itemType === "group") {
        if (source.type === "project") {
          if (source.groupId === itemId) return null;
          return { action: "add-to-group", groupId: itemId };
        }

        if (source.id === itemId) return null;
        return {
          action:
            getNearestVerticalPosition(clientY, rect) === "before"
              ? "reorder-before"
              : "reorder-after",
          targetId: itemId,
          scope: "rail",
        };
      }
    }

    const lastNode = topLevelNodes.at(-1);
    if (lastNode) {
      const rect = lastNode.getBoundingClientRect();
      if (clientY > rect.bottom) {
        return { action: "rail-tail" };
      }
    }

    if (source.type === "project" && source.groupId) {
      return { action: "rail-background" };
    }

    return null;
  }

  const applyDropIntent = useEffectEvent(
    (source: DragState, intent: DropIntent) => {
      if (!intent) return;

      const reorderPosition = getReorderPosition(intent);

      if (intent.action === "merge" && source.type === "project") {
        onDropProjectOnProject(source.id, intent.targetId);
        return;
      }

      if (intent.action === "add-to-group" && source.type === "project") {
        onDropProjectOnGroup(source.id, intent.groupId);
        return;
      }

      if (
        reorderPosition &&
        (intent.action === "reorder-before" ||
          intent.action === "reorder-after")
      ) {
        if (
          intent.scope === "group" &&
          source.type === "project" &&
          intent.groupId
        ) {
          if (source.groupId === intent.groupId) {
            onReorderInGroup(
              intent.groupId,
              source.id,
              intent.targetId,
              reorderPosition,
            );
          } else {
            onDropProjectOnGroup(
              source.id,
              intent.groupId,
              intent.targetId,
              reorderPosition,
            );
          }
          return;
        }

        if (intent.scope === "rail") {
          const targetItem = findRailItem(intent.targetId);
          if (!targetItem) return;

          if (source.type === "project" && source.groupId) {
            onDropOnRail(source.id);
            return;
          }

          const sourceItem = findSourceItem(source);
          if (sourceItem) {
            onReorderRail(sourceItem, targetItem, reorderPosition);
          }
          return;
        }
      }

      if (intent.action === "rail-background") {
        if (source.type === "project" && source.groupId) {
          onDropOnRail(source.id);
        }
        return;
      }

      if (intent.action === "rail-tail") {
        if (source.type === "project" && source.groupId) {
          onDropOnRail(source.id);
          return;
        }

        if (!lastRailItem) return;
        const sourceItem = findSourceItem(source);
        if (sourceItem) {
          onReorderRail(sourceItem, lastRailItem, "after");
        }
      }
    },
  );

  useEffect(() => {
    if (activePointerId === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const pendingDrag = pendingDragRef.current;
      if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) return;

      if (!pendingDrag.dragging) {
        if (
          !distanceExceeded(
            pendingDrag.startX,
            pendingDrag.startY,
            event.clientX,
            event.clientY,
          )
        ) {
          return;
        }

        pendingDrag.dragging = true;
        setDragState(pendingDrag.source);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      event.preventDefault();
      const rail = railScrollRef.current;
      if (rail) {
        maybeAutoScroll(rail, event.clientY);
      }
      setDropIntent(
        computeDropIntent(pendingDrag.source, event.clientX, event.clientY),
      );
    };

    const finishPointerDrag = (event: PointerEvent) => {
      const pendingDrag = pendingDragRef.current;
      if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) return;

      if (pendingDrag.dragging) {
        event.preventDefault();
        suppressNextClick();
        applyDropIntent(
          pendingDrag.source,
          computeDropIntent(pendingDrag.source, event.clientX, event.clientY),
        );
      }

      if (pendingDrag.handle.hasPointerCapture(event.pointerId)) {
        pendingDrag.handle.releasePointerCapture(event.pointerId);
      }
      clearDragState();
    };

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
    });
    window.addEventListener("pointerup", finishPointerDrag, { capture: true });
    window.addEventListener("pointercancel", finishPointerDrag, {
      capture: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", finishPointerDrag, true);
      window.removeEventListener("pointercancel", finishPointerDrag, true);
    };
  }, [activePointerId]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center overflow-x-clip overflow-y-hidden border-r bg-muted/30 px-2 py-3">
      <div className="relative">
        <ActivePill visible={selectedProjectId === generalSpaceId} />
        <button
          className={cn(
            "desktop-no-drag group/general flex size-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b transition-all",
            selectedProjectId === generalSpaceId
              ? "from-foreground/15 to-foreground/[0.07] text-foreground"
              : "from-transparent to-transparent text-muted-foreground hover:from-foreground/10 hover:to-foreground/[0.04] hover:text-foreground",
          )}
          onClick={() => onSelect(generalSpaceId)}
          title="General"
        >
          {selectedProjectId === generalSpaceId ? (
            <RiHome5Fill className="size-[18px]" aria-hidden="true" />
          ) : (
            <RiHome5Line
              className="size-[18px] transition-transform group-hover/general:scale-110"
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      <div className="my-2 h-px w-6 bg-border" />

      <div
        ref={railScrollRef}
        className="scrollbar-hidden relative flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto pl-2 -ml-2"
      >
        {railItems.map((item) => {
          if (item.type === "project") {
            return (
              <RailProjectItem
                key={item.project.id}
                project={item.project}
                selectedProjectId={selectedProjectId}
                onSelect={onSelect}
                onPointerDown={(event) =>
                  startPointerDrag(
                    { type: "project", id: item.project.id, groupId: null },
                    event,
                  )
                }
                dragState={dragState}
                dropIntent={dropIntent}
                fetchProjectRuntime={fetchProjectRuntime}
                onOpenProjectSettings={onOpenProjectSettings}
                onDeleteProject={onDeleteProject}
              />
            );
          }

          const { group, projects } = item;
          const runtimeState = getGroupRuntimeState(projects);

          if (group.isCollapsed) {
            return (
              <CollapsedGroup
                key={group.id}
                groupId={group.id}
                projects={projects}
                runtimeState={runtimeState}
                onClick={() => {
                  clearDragState();
                  onToggleGroupCollapsed(group.id);
                }}
                onPointerDown={(event) =>
                  startPointerDrag({ type: "group", id: group.id }, event)
                }
                dragState={dragState}
                dropIntent={dropIntent}
              />
            );
          }

          return (
            <ExpandedGroup
              key={group.id}
              group={group}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelect={onSelect}
              onToggleCollapsed={() => {
                clearDragState();
                onToggleGroupCollapsed(group.id);
              }}
              onGroupPointerDown={(event) =>
                startPointerDrag({ type: "group", id: group.id }, event)
              }
              onProjectPointerDown={(projectId) => (event) =>
                startPointerDrag(
                  { type: "project", id: projectId, groupId: group.id },
                  event,
                )
              }
              dragState={dragState}
              dropIntent={dropIntent}
              fetchProjectRuntime={fetchProjectRuntime}
              onOpenProjectSettings={onOpenProjectSettings}
              onDeleteProject={onDeleteProject}
            />
          );
        })}
        {dragState && <div className="min-h-12 w-full flex-1 self-stretch" />}
      </div>

      <Button
        className="desktop-no-drag mt-3"
        onClick={onAdd}
        size="icon-sm"
        variant="ghost"
      >
        <RiAddLine />
      </Button>
    </aside>
  );
}
