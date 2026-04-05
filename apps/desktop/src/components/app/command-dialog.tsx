import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFlashlightLine,
  RiCursorLine,
  RiPlayLine,
  RiRepeatLine,
  RiGitBranchLine,
  RiTerminalBoxLine,
  RiUserLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { useForm } from "react-hook-form";

import type {
  CommandSource,
  EditableCommandConfig,
  ProjectConfigPayload,
  ResolvedCommandConfig,
  SoundId,
} from "@kickstart/contracts";
import {
  deriveCommandId,
  isActionCommand,
  normalizeCommandBehavior,
  parseEffectiveCommandId,
} from "@kickstart/contracts";

import { playSound, SOUND_OPTIONS } from "@/lib/sounds";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { envRecordToText, envTextToRecord } from "@/lib/command-utils";
import { cn } from "@/lib/utils";
type View = { type: "list" } | { type: "form"; commandId: string | null };

type DraftSeed = Pick<
  EditableCommandConfig,
  "command" | "cwd" | "env" | "name" | "soundId" | "startMode" | "type"
> & {
  source?: CommandSource;
};

interface CommandDraft {
  command: string;
  cwd: string;
  envText: string;
  name: string;
  soundId: SoundId | null;
  source: CommandSource;
  startMode: EditableCommandConfig["startMode"];
  type: EditableCommandConfig["type"];
}

interface NormalizedCommandDraft {
  command: string;
  cwd: string;
  envText: string;
  name: string;
  soundId: SoundId | null;
  source: CommandSource;
  startMode: EditableCommandConfig["startMode"];
  type: EditableCommandConfig["type"];
}

function createDraft(
  command?: DraftSeed | null,
  defaultSource: CommandSource = "shared",
): CommandDraft {
  return {
    command: command?.command ?? "",
    cwd: command?.cwd ?? ".",
    envText: envRecordToText(command?.env),
    name: command?.name ?? "",
    soundId: command?.soundId ?? null,
    source: command?.source ?? defaultSource,
    startMode: command?.startMode ?? "manual",
    type: command?.type ?? "service",
  };
}

function findEditableCommand(
  projectConfig: ProjectConfigPayload | null,
  commandId: string | null,
): DraftSeed | null {
  if (!projectConfig || !commandId) {
    return null;
  }

  const parsed = parseEffectiveCommandId(commandId);
  if (!parsed) {
    return null;
  }

  const sourceConfig = projectConfig[parsed.source].config;
  const command = sourceConfig?.commands.find((item) => item.id === parsed.sourceCommandId);
  if (!command) {
    return null;
  }

  return {
    ...command,
    source: parsed.source,
  };
}

function normalizeDraft(draft: CommandDraft): NormalizedCommandDraft {
  const command = draft.command.trim();
  const behavior = normalizeCommandBehavior({
    startMode: draft.startMode,
    type: draft.type,
  });

  return {
    command,
    cwd: draft.cwd.trim() || ".",
    envText: draft.envText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
    name: draft.name.trim(),
    soundId: behavior.type === "action" ? draft.soundId : null,
    source: draft.source,
    startMode: behavior.startMode,
    type: behavior.type,
  };
}

// ── Inline confirm delete ────────────────────────────────────

function ConfirmDeleteButton({
  onConfirm,
  variant = "icon",
}: {
  onConfirm: () => void;
  variant?: "icon" | "text";
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirming) {
      onConfirm();
      return;
    }
    setConfirming(true);
  };

  const handleMouseLeave = () => {
    if (!confirming) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setConfirming(false), 1500);
  };

  const handleMouseEnter = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  if (variant === "text") {
    return (
      <Button
        variant="ghost"
        className={cn(
          "transition-all duration-200 sm:mr-auto",
          confirming
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "text-destructive hover:bg-destructive/10 hover:text-destructive",
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {confirming ? "Confirm" : "Delete"}
      </Button>
    );
  }

  return (
    <Button
      size="icon-xs"
      variant={confirming ? "destructive" : "ghost"}
      className={cn(
        "shrink-0 overflow-hidden transition-all duration-200",
        confirming
          ? "w-16 opacity-100"
          : "w-6 opacity-0 group-hover:opacity-100",
      )}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <RiDeleteBinLine className="size-3.5 shrink-0" />
      <span
        className={cn(
          "transition-all duration-200",
          confirming ? "w-auto opacity-100" : "w-0 opacity-0",
        )}
      >
        Confirm
      </span>
    </Button>
  );
}

// ── List view ────────────────────────────────────────────────

function CommandListView({
  commands,
  onEdit,
  onDelete,
  onNew,
}: {
  commands: ResolvedCommandConfig[];
  onEdit: (commandId: ResolvedCommandConfig["id"]) => void;
  onDelete: (commandId: ResolvedCommandConfig["id"]) => void;
  onNew: () => void;
}) {
  return (
    <div className="-mx-4 -mb-4 overflow-hidden rounded-b-xl">
      {commands.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <RiTerminalBoxLine className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No commands yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        commands.map((command) => (
          <div
            key={command.id}
            aria-label={`Edit ${command.name}`}
            className="group flex w-full items-center gap-3 border-t px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onEdit(command.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEdit(command.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <RiTerminalBoxLine className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{command.name}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {command.type}
                </span>
                {command.source === "local" && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    personal
                  </span>
                )}
                {command.startMode === "auto" && (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    auto
                  </span>
                )}
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {command.command}
              </span>
            </div>
            <ConfirmDeleteButton onConfirm={() => onDelete(command.id)} />
          </div>
        ))
      )}
      <button
        className="flex w-full items-center justify-center gap-2 border-t px-4 py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onNew}
      >
        <RiAddLine className="size-4 shrink-0" />
        <span className="text-sm font-medium">Add command</span>
      </button>
    </div>
  );
}

// ── Form view ────────────────────────────────────────────────

function CommandFormView({
  form,
  error,
  hasChanges,
  isEditing,
  projectConfig,
  onReset,
  onSave,
  onDelete,
  onBack,
}: {
  form: ReturnType<typeof useForm<CommandDraft>>;
  error: string | null;
  hasChanges: boolean;
  isEditing: boolean;
  projectConfig: ProjectConfigPayload | null;
  onReset: (() => void) | null;
  onSave: () => void;
  onDelete: (() => void) | null;
  onBack: (() => void) | null;
}) {
  const draft = form.watch();
  const isAction = isActionCommand(draft);

  function ToggleGroup<T extends string>({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: T;
    options: {
      description: string;
      disabled?: boolean;
      icon: ComponentType<{ className?: string }>;
      label: string;
      value: T;
    }[];
    onChange: (value: T) => void;
  }) {
    return (
      <div>
        <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
        <div className="flex rounded-lg border border-border p-0.5">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-left transition-colors",
                  option.disabled && "cursor-not-allowed opacity-50",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onChange(option.value)}
              >
                <div className="flex items-center gap-1.5">
                  <option.icon className="size-3.5" />
                  <p className="text-sm font-medium">{option.label}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <Label htmlFor="cmd-name" className="mb-1.5 text-xs text-muted-foreground">
            Label (optional)
          </Label>
          <Input
            id="cmd-name"
            {...form.register("name")}
            placeholder="e.g. Dev Server"
          />
        </div>
        <div>
          <Label htmlFor="cmd-command" className="mb-1.5 text-xs text-muted-foreground">
            Command
          </Label>
          <Input
            id="cmd-command"
            {...form.register("command")}
            placeholder="e.g. bun dev"
          />
        </div>
        <ToggleGroup
          label="Type"
          value={draft.type}
          options={[
            { description: "Long-running process like a dev server", icon: RiRepeatLine, label: "Service", value: "service" },
            { description: "One-off task like install, deploy, or test", icon: RiFlashlightLine, label: "Action", value: "action" },
          ]}
          onChange={(value) => {
            form.setValue("type", value, { shouldDirty: true });
            if (value === "action") {
              form.setValue("startMode", "manual", { shouldDirty: true });
            }
          }}
        />
        {!isAction && (
          <ToggleGroup
            label="Start mode"
            value={draft.startMode}
            options={[
              { description: "Starts with the project-wide start button", icon: RiPlayLine, label: "Auto", value: "auto" },
              { description: "Only runs when you click start for this command specifically", icon: RiCursorLine, label: "Manual", value: "manual" },
            ]}
            onChange={(value) => {
              form.setValue("startMode", value, { shouldDirty: true });
            }}
          />
        )}
        {isAction && (
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">Completion sound</Label>
            <div className="flex rounded-lg border border-border p-0.5">
              {SOUND_OPTIONS.map((option) => {
                const active = option.id === (draft.soundId ?? null);
                return (
                  <button
                    key={option.id ?? "none"}
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1 transition-colors",
                      active
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      form.setValue("soundId", option.id, { shouldDirty: true });
                      if (option.id) playSound(option.id);
                    }}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <option.icon className="size-3.5" />
                      <p className="text-sm font-medium">{option.label}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            Advanced
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <Label htmlFor="cmd-cwd" className="mb-1.5 text-xs text-muted-foreground">
                Working directory
              </Label>
              <Input
                id="cmd-cwd"
                {...form.register("cwd")}
                placeholder="e.g. ./apps/web"
              />
            </div>
            <div>
              <Label htmlFor="cmd-env" className="mb-1.5 text-xs text-muted-foreground">
                Environment variables
              </Label>
              <Textarea
                id="cmd-env"
                rows={3}
                {...form.register("envText")}
                placeholder={"e.g. DB_STAGE=prod\nPORT=3000"}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                These only apply to this saved command, so you can override your usual shell env
                without changing it globally. For example, keep one command with{" "}
                <code className="font-mono text-[11px]">DB_STAGE=prod</code> for the prod DB and
                another with <code className="font-mono text-[11px]">DB_STAGE=dev</code> for your dev
                DB.
              </p>
            </div>
          </div>
        </details>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            {draft.source === "shared" ? "Saved to kickstart.json" : "Saved only on this machine"}
          </div>
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              disabled={Boolean(projectConfig?.shared.configError)}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition-colors flex items-center gap-1",
                Boolean(projectConfig?.shared.configError) && "cursor-not-allowed opacity-50",
                draft.source === "shared"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => form.setValue("source", "shared", { shouldDirty: true })}
            >
              <RiGitBranchLine className="size-3" />
              Shared
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2 py-0.5 font-medium transition-colors flex items-center gap-1",
                draft.source === "local"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => form.setValue("source", "local", { shouldDirty: true })}
            >
              <RiUserLine className="size-3" />
              Personal
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        {onDelete && (
          <ConfirmDeleteButton onConfirm={onDelete} variant="text" />
        )}
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        )}
        {onReset && (
          <Button variant="ghost" onClick={onReset}>
            Reset
          </Button>
        )}
        <Button disabled={!hasChanges} onClick={onSave}>
          {isEditing ? "Save changes" : "Create command"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Main dialog ──────────────────────────────────────────────

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCommandId: string | null;
  entryMode: "create" | "edit" | "list";
  preferredCreateSource: CommandSource;
  projectId: string;
  projectName: string;
  commands: ResolvedCommandConfig[];
  projectConfig: ProjectConfigPayload | null;
  onCommandsChanged: () => Promise<void>;
}

export function CommandDialog({
  open,
  onOpenChange,
  editingCommandId,
  entryMode,
  preferredCreateSource,
  projectId,
  projectName,
  commands,
  projectConfig,
  onCommandsChanged,
}: CommandDialogProps) {
  const [view, setView] = useState<View>({ type: "list" });
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CommandDraft>({
    defaultValues: createDraft(null, preferredCreateSource),
    mode: "onChange",
  });

  const commandById = useMemo(
    () => new Map<string, ResolvedCommandConfig>(commands.map((command) => [command.id, command])),
    [commands],
  );
  const currentCommand =
    view.type === "form" && view.commandId
      ? (commandById.get(view.commandId) ?? null)
      : null;
  const currentEditableCommand = useMemo(
    () => (view.type === "form" ? findEditableCommand(projectConfig, view.commandId) : null),
    [projectConfig, view],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (entryMode === "edit" && editingCommandId) {
      setView({ type: "form", commandId: editingCommandId });
    } else if (entryMode === "create") {
      setView({ type: "form", commandId: null });
    } else {
      setView({ type: "list" });
    }
    setError(null);
  }, [editingCommandId, entryMode, open]);

  useEffect(() => {
    form.reset(createDraft(currentEditableCommand ?? currentCommand, preferredCreateSource));
  }, [currentCommand, currentEditableCommand, form, preferredCreateSource, view]);

  function switchToNew() {
    setView({ type: "form", commandId: null });
    setError(null);
  }

  function switchToEdit(commandId: ResolvedCommandConfig["id"]) {
    setView({ type: "form", commandId });
    setError(null);
  }

  function switchToList() {
    setView({ type: "list" });
    setError(null);
  }

  async function handleSave(draft: CommandDraft) {
    try {
      const editingExisting = view.type === "form" && currentCommand;
      const normalizedDraft = normalizeDraft(draft);
      if (!normalizedDraft.command) throw new Error("Command is required.");

      const nextCommand: EditableCommandConfig = normalizeCommandBehavior({
        command: normalizedDraft.command,
        cwd: normalizedDraft.cwd,
        env: envTextToRecord(draft.envText),
        id: editingExisting
          ? currentCommand.sourceCommandId
          : deriveCommandId(normalizedDraft.command, normalizedDraft.cwd),
        ...(normalizedDraft.name ? { name: normalizedDraft.name } : {}),
        soundId: normalizedDraft.soundId,
        startMode: normalizedDraft.startMode,
        type: normalizedDraft.type,
      });
      if (editingExisting) {
        await window.desktop.updateCommand({
          command: nextCommand,
          existingCommandId: currentCommand.id,
          projectId,
          source: normalizedDraft.source,
        });
      } else {
        await window.desktop.createCommand({
          command: nextCommand,
          projectId,
          source: normalizedDraft.source,
        });
      }

      await onCommandsChanged();
      if (entryMode !== "list") {
        onOpenChange(false);
      } else {
        switchToList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save command.");
    }
  }

  async function handleDelete(commandId: ResolvedCommandConfig["id"]) {
    await window.desktop.deleteCommand({ commandId, projectId });
    await onCommandsChanged();
  }

  const isFormView = view.type === "form";
  const isEditing = isFormView && currentCommand !== null;
  const initialDraft = createDraft(currentEditableCommand ?? currentCommand, preferredCreateSource);
  const draft = form.watch();
  const hasChanges =
    isFormView &&
    JSON.stringify(normalizeDraft(draft)) !== JSON.stringify(normalizeDraft(initialDraft));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isFormView ? (isEditing ? "Edit command" : "New command") : "Commands"}
          </DialogTitle>
          <DialogDescription>
            {isFormView
              ? "Configure how this command runs."
              : `Manage commands for ${projectName}.`}
          </DialogDescription>
        </DialogHeader>

        {view.type === "list" ? (
          <CommandListView
            commands={commands}
            onEdit={switchToEdit}
            onDelete={(id) => void handleDelete(id)}
            onNew={switchToNew}
          />
        ) : (
          <CommandFormView
            form={form}
            error={error}
            hasChanges={hasChanges}
            isEditing={isEditing}
            projectConfig={projectConfig}
            onReset={hasChanges ? () => form.reset(initialDraft) : null}
            onSave={() => void form.handleSubmit(handleSave)()}
            onDelete={
              isEditing && currentCommand
                ? () => {
                    void handleDelete(currentCommand.id).then(() => {
                      if (entryMode !== "list") {
                        onOpenChange(false);
                      } else {
                        switchToList();
                      }
                    });
                  }
                : null
            }
            onBack={entryMode === "list" ? switchToList : null}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
