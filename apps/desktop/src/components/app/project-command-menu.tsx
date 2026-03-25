import { RiHome5Line } from "@remixicon/react";

import {
  GENERAL_SPACE_ID,
  type ProjectWithRuntime,
} from "@kickstart/contracts";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AnimatedBars, RUNTIME_COLORS } from "@/components/app/runtime-indicators";
import { SeededAvatar } from "@/components/ui/seeded-avatar";
import { cn } from "@/lib/utils";

interface ProjectCommandMenuProps {
  open: boolean;
  projects: ProjectWithRuntime[];
  selectedProjectId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelectProject: (projectId: string) => void;
}

function getProjectSearchKeywords(project: ProjectWithRuntime) {
  const segments = project.path
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = segments.at(-1);

  return [project.name, lastSegment]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function ProjectIcon({ project }: { project: ProjectWithRuntime }) {
  if (project.iconUrl) {
    return (
      <img
        src={project.iconUrl}
        alt=""
        className="size-5 rounded-md object-cover"
      />
    );
  }

  return (
    <SeededAvatar
      seed={project.path}
      displayValue={project.name}
      rounded="md"
      size="sm"
      className="size-5"
    />
  );
}

function RuntimePill({ project }: { project: ProjectWithRuntime }) {
  if (project.runtimeState === "not-running") {
    return null;
  }

  const isFullyRunning = project.runtimeState === "running";
  const color = isFullyRunning ? RUNTIME_COLORS.running : RUNTIME_COLORS.starting;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        isFullyRunning
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <AnimatedBars size={10} color={color} barWidth={1.5} gap={0.5} />
      {isFullyRunning ? "Running" : "Partially Running"}
    </span>
  );
}

export function ProjectCommandMenu({
  open,
  projects,
  selectedProjectId,
  onOpenChange,
  onSelectProject,
}: ProjectCommandMenuProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Project command menu"
      description="Search projects and jump directly to one."
      className="sm:max-w-xl"
    >
      <Command shouldFilter loop>
        <CommandInput placeholder="Search projects..." />
        <CommandList>
          <CommandEmpty>No projects found.</CommandEmpty>
          <CommandGroup heading="Projects">
            <CommandItem
              value="General"
              keywords={["general", "workspace", "home"]}
              data-checked={selectedProjectId === GENERAL_SPACE_ID || undefined}
              onSelect={() => {
                onSelectProject(GENERAL_SPACE_ID);
                onOpenChange(false);
              }}
            >
              <span className="flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <RiHome5Line className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">General</div>
                <div className="truncate text-xs text-muted-foreground">
                  Shared shell workspace
                </div>
              </div>
            </CommandItem>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.name}
                keywords={getProjectSearchKeywords(project)}
                data-checked={selectedProjectId === project.id || undefined}
                onSelect={() => {
                  onSelectProject(project.id);
                  onOpenChange(false);
                }}
              >
                <ProjectIcon project={project} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{project.name}</span>
                    <RuntimePill project={project} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {project.path}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
