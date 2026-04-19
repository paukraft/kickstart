import wordmark from "@/assets/wordmark.png";
import { RiAddLine, RiCodeSSlashLine } from "@remixicon/react";

import type {
  ProjectTabRecord,
  ProjectWithRuntime,
  ResolvedCommandConfig,
  TerminalSessionSnapshot,
} from "@kickstart/contracts";

import { TerminalView } from "@/components/app/terminal-view";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface MainContentProps {
  project: ProjectWithRuntime | null;
  workspaceId: string | null;
  workspaceName?: string;
  hasCommands: boolean;
  sharedConfigError?: string | null;
  sharedConfigExists: boolean;
  activeTab: ProjectTabRecord | null;
  activeSession?: TerminalSessionSnapshot | null;
  activeCommand: ResolvedCommandConfig | null;
  onAddProject: () => void;
  onAddLocalCommand: () => void;
  onCreateConfig: () => void;
  onCreateShellTab: () => void;
}

export function MainContent({
  project,
  workspaceId,
  workspaceName,
  hasCommands,
  sharedConfigError,
  sharedConfigExists,
  activeTab,
  activeSession,
  activeCommand: _activeCommand,
  onAddProject,
  onAddLocalCommand,
  onCreateConfig,
  onCreateShellTab,
}: MainContentProps) {
  const isGeneralSpace = !project && workspaceName === "General";

  if (activeTab) {
    return (
      <TerminalView
        projectId={workspaceId ?? project?.id ?? ""}
        session={activeSession}
        tab={activeTab}
      />
    );
  }

  if (!project && !workspaceName) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Your projects, one launch surface</EmptyTitle>
          <EmptyDescription>
            Add repos, pin dev commands, and keep every terminal tab durable
            across restarts.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onAddProject}>
            <RiAddLine />
            Add First Project
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!hasCommands) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RiCodeSSlashLine />
          </EmptyMedia>
          <EmptyTitle>
            {sharedConfigError ? "Shared config needs attention" : "Add your first command"}
          </EmptyTitle>
          <EmptyDescription>
            {sharedConfigError
              ? `kickstart.json exists, but Kickstart could not parse it: ${sharedConfigError}`
              : "Save a personal command just for yourself, or create `kickstart.json` for shared repo commands."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex gap-2">
          <Button size="sm" onClick={onAddLocalCommand}>
            <RiAddLine />
            Add Personal Command
          </Button>
          {!sharedConfigExists && !sharedConfigError ? (
            <Button size="sm" variant="outline" onClick={onCreateConfig}>
              <RiCodeSSlashLine />
              Create Shared Config
            </Button>
          ) : null}
        </EmptyContent>
      </Empty>
    );
  }

  const shortcuts: {
    label: string;
    keys: string;
    action: (() => void) | undefined;
    icon?: React.ReactNode;
  }[] = [
    { label: "Project command menu", keys: "Cmd+K", action: undefined },
    { label: "New shell tab", keys: "Cmd+T", action: onCreateShellTab },
    { label: "Add project", keys: "Cmd+O", action: onAddProject },
    { label: "Project settings", keys: "Cmd+,", action: undefined },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="flex flex-col items-center gap-8">
        <img
          src={wordmark}
          alt="Kickstart"
          className={isGeneralSpace ? "h-10 invert dark:invert-0" : "h-10"}
          draggable={false}
        />
        <div className="w-52 overflow-hidden rounded-lg border">
          {shortcuts.map((shortcut, index) => (
            <button
              key={shortcut.label}
              type="button"
              className={[
                "flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-xs text-muted-foreground transition-colors",
                shortcut.action
                  ? "cursor-pointer hover:bg-muted/50 hover:text-foreground"
                  : "cursor-default",
                index > 0 ? "border-t" : "",
              ].join(" ")}
              onClick={shortcut.action}
            >
              <span>{shortcut.label}</span>
              {shortcut.icon ?? (
                <kbd className="font-mono text-[11px] opacity-60">
                  {shortcut.keys}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
