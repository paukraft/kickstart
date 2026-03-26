import { useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFlashlightLine,
  RiCursorLine,
  RiPlayLine,
  RiRepeatLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { useForm } from "react-hook-form";

import type { CommandConfig, EditableCommandConfig, SoundId } from "@kickstart/contracts";
import {
  deriveCommandId,
  isActionCommand,
  normalizeCommandBehavior,
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

interface CommandDraft {
  command: string;
  cwd: string;
  envText: string;
  name: string;
  soundId: SoundId | null;
  startMode: CommandConfig["startMode"];
  type: CommandConfig["type"];
}

interface NormalizedCommandDraft {
  command: string;
  cwd: string;
  envText: string;
  name: string;
  soundId: SoundId | null;
  startMode: CommandConfig["startMode"];
  type: CommandConfig["type"];
}


function createDraft(command?: EditableCommandConfig | null): CommandDraft {
  return {
    command: command?.command ?? "",
    cwd: command?.cwd ?? ".",
    envText: envRecordToText(command?.env),
    name: command?.name ?? "",
    soundId: command?.soundId ?? null,
    startMode: command?.startMode ?? "manual",
    type: command?.type ?? "service",
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
    startMode: behavior.startMode,
    type: behavior.type,
  };
}

// ── List view ────────────────────────────────────────────────

function CommandListView({
  commands,
  onEdit,
  onDelete,
  onNew,
}: {
  commands: CommandConfig[];
  onEdit: (commandId: string) => void;
  onDelete: (commandId: string) => void;
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
          <button
            key={command.id}
            className="group flex w-full items-center gap-3 border-t px-4 py-2.5 text-left transition-colors hover:bg-accent"
            onClick={() => onEdit(command.id)}
          >
            <RiTerminalBoxLine className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{command.name}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {command.type}
                </span>
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
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(command.id);
              }}
            >
              <RiDeleteBinLine />
            </Button>
          </button>
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
  onReset,
  onSave,
  onDelete,
  onBack,
}: {
  form: ReturnType<typeof useForm<CommandDraft>>;
  error: string | null;
  hasChanges: boolean;
  isEditing: boolean;
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
    options: { description: string; icon: ComponentType<{ className?: string }>; label: string; value: T }[];
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
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-left transition-colors",
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
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        {onDelete && (
          <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto" onClick={onDelete}>
            Delete
          </Button>
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
  editableCommands: EditableCommandConfig[];
  editingCommandId: string | null;
  entryMode: "create" | "edit" | "list";
  projectId: string;
  projectName: string;
  commands: CommandConfig[];
  onCommandsChanged: () => Promise<void>;
}

export function CommandDialog({
  open,
  onOpenChange,
  editableCommands,
  editingCommandId,
  entryMode,
  projectId,
  projectName,
  commands,
  onCommandsChanged,
}: CommandDialogProps) {
  const [view, setView] = useState<View>({ type: "list" });
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CommandDraft>({
    defaultValues: createDraft(),
    mode: "onChange",
  });

  const editableCommandById = useMemo(
    () => new Map(editableCommands.map((command) => [command.id, command])),
    [editableCommands],
  );
  const currentCommand =
    view.type === "form" && view.commandId
      ? (editableCommandById.get(view.commandId) ?? null)
      : null;

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
    form.reset(createDraft(currentCommand));
  }, [currentCommand, form, view]);

  function switchToNew() {
    setView({ type: "form", commandId: null });
    setError(null);
  }

  function switchToEdit(commandId: string) {
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
          ? currentCommand.id
          : deriveCommandId(normalizedDraft.command, normalizedDraft.cwd),
        ...(normalizedDraft.name ? { name: normalizedDraft.name } : {}),
        soundId: normalizedDraft.soundId,
        startMode: normalizedDraft.startMode,
        type: normalizedDraft.type,
      });
      if (editingExisting) {
        await window.desktop.updateCommand({ command: nextCommand, projectId });
      } else {
        await window.desktop.createCommand({ command: nextCommand, projectId });
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

  async function handleDelete(commandId: string) {
    await window.desktop.deleteCommand({ commandId, projectId });
    await onCommandsChanged();
  }

  const isFormView = view.type === "form";
  const isEditing = isFormView && currentCommand !== null;
  const initialDraft = createDraft(currentCommand);
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
