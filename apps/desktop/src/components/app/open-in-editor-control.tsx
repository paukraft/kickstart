import {
  RiAndroidLine,
  RiArrowDownSLine,
  RiBracesLine,
  RiFolderOpenLine,
  RiShapesLine,
  RiWindyLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";

import type { EditorId, EditorOption } from "@/lib/editors";

import {
  CodexIcon,
  CursorIcon,
  VisualStudioCodeIcon,
  ZedIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LAST_EDITOR_STORAGE_KEY = "kickstart:last-editor";

function readStoredEditor() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_EDITOR_STORAGE_KEY) as EditorId | null;
}

const editorIcons: Record<EditorId, ComponentType<{ className?: string }>> = {
  "android-studio": RiAndroidLine,
  clion: RiBracesLine,
  cursor: CursorIcon,
  codex: CodexIcon,
  "file-manager": RiFolderOpenLine,
  goland: RiBracesLine,
  intellij: RiBracesLine,
  nova: RiShapesLine,
  phpstorm: RiBracesLine,
  pycharm: RiBracesLine,
  rider: RiBracesLine,
  rubymine: RiBracesLine,
  "sublime-text": RiShapesLine,
  vscode: VisualStudioCodeIcon,
  webstorm: RiBracesLine,
  windsurf: RiWindyLine,
  zed: ZedIcon,
};

interface OpenInEditorControlProps {
  beforeOpen?: () => Promise<void>;
  className?: string;
  primaryLabel?: string;
  projectPath: string;
  variant?: "default" | "outline";
}

export function OpenInEditorControl({
  beforeOpen,
  className,
  primaryLabel,
  projectPath,
  variant = "outline",
}: OpenInEditorControlProps) {
  const [availableEditors, setAvailableEditors] = useState<EditorOption[]>([]);
  const [preferredEditor, setPreferredEditor] = useState<EditorId | null>(() => readStoredEditor());
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.desktop.listAvailableEditors().then((options) => {
      if (!cancelled) setAvailableEditors(options);
    });
    return () => { cancelled = true; };
  }, []);

  const effectiveEditor = useMemo(() => {
    if (preferredEditor && availableEditors.some((editor) => editor.id === preferredEditor)) return preferredEditor;
    return availableEditors[0]?.id ?? null;
  }, [availableEditors, preferredEditor]);

  const primaryEditor = availableEditors.find((editor) => editor.id === effectiveEditor) ?? null;
  const PrimaryIcon = primaryEditor ? editorIcons[primaryEditor.id] : RiFolderOpenLine;

  function storePreferredEditor(editorId: EditorId) {
    window.localStorage.setItem(LAST_EDITOR_STORAGE_KEY, editorId);
    setPreferredEditor(editorId);
  }

  async function handleOpen(editorId: EditorId | null) {
    const nextEditor = editorId ?? effectiveEditor;
    if (!nextEditor || isOpening) return;

    storePreferredEditor(nextEditor);

    try {
      setIsOpening(true);
      if (beforeOpen) {
        await beforeOpen();
      }
      await window.desktop.openInEditor(projectPath, nextEditor);
    } finally {
      setIsOpening(false);
    }
  }

  if (availableEditors.length === 0) {
    return (
      <Button disabled variant={variant} size="sm">
        <RiFolderOpenLine />
        {primaryLabel ?? "Open"}
      </Button>
    );
  }

  return (
    <ButtonGroup className={className}>
      <Button
        className="flex-1"
        size="sm"
        variant={variant}
        onClick={() => void handleOpen(effectiveEditor)}
      >
        <PrimaryIcon className="mr-1 size-3.5" />
        {primaryLabel ?? `Open in ${primaryEditor?.label ?? "Editor"}`}
      </Button>
      {availableEditors.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon-sm" variant={variant} aria-label="Choose editor">
                <RiArrowDownSLine />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {availableEditors.map((editor) => {
              const Icon = editorIcons[editor.id];
              return (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => void handleOpen(editor.id)}
                >
                  <Icon className="size-4" />
                  {editor.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </ButtonGroup>
  );
}
