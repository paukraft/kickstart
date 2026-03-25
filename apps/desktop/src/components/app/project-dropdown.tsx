import { RiDeleteBinLine, RiSettings4Line } from "@remixicon/react";

import type { ProjectWithRuntime } from "@kickstart/contracts";

import {
  HybridMenu,
  HybridMenuContent,
  HybridMenuItem,
  HybridMenuSeparator,
  HybridMenuTrigger,
} from "@/components/ui/hybrid-menu";

type ProjectDropdownMode = "dropdown-menu" | "context-menu";

interface ProjectDropdownProps {
  mode: ProjectDropdownMode;
  project: Pick<ProjectWithRuntime, "id" | "name">;
  children: React.ReactNode;
  triggerClassName?: string;
  contentAlign?: "start" | "center" | "end";
  contentSide?: "top" | "right" | "bottom" | "left";
  contentSideOffset?: number;
  onOpenSettings: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectProject?: (projectId: string) => void;
}

export function ProjectDropdown({
  mode,
  project,
  children,
  triggerClassName,
  contentAlign = "start",
  contentSide = "bottom",
  contentSideOffset = 4,
  onOpenSettings,
  onDeleteProject,
  onSelectProject,
}: ProjectDropdownProps) {
  return (
    <HybridMenu mode={mode}>
      <HybridMenuTrigger
        className={triggerClassName}
        onContextMenuCapture={() => onSelectProject?.(project.id)}
      >
        {children}
      </HybridMenuTrigger>
      <HybridMenuContent
        align={contentAlign}
        side={contentSide}
        sideOffset={contentSideOffset}
      >
        <HybridMenuItem onClick={() => onOpenSettings(project.id)}>
          <RiSettings4Line />
          Settings
        </HybridMenuItem>
        <HybridMenuSeparator />
        <HybridMenuItem
          variant="destructive"
          onClick={() => onDeleteProject(project.id)}
        >
          <RiDeleteBinLine />
          Delete project
        </HybridMenuItem>
      </HybridMenuContent>
    </HybridMenu>
  );
}
