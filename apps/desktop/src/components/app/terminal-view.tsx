import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";

import { isTerminalSessionStartPending } from "@kickstart/contracts";
import type {
  ProjectTabRecord,
  TerminalEvent,
  TerminalSessionSnapshot,
} from "@kickstart/contracts";

import { getPrefersDarkMode, useDarkMode } from "@/lib/media-preferences";
import { createTerminalReplayGuard } from "@/lib/terminal-replay-guard";

const darkTheme: ITheme = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#a1a1aa",
  selectionBackground: "#27272a",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d4d4d8",
  brightBlack: "#71717a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93bbfd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

const lightTheme: ITheme = {
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#71717a",
  selectionBackground: "#e4e4e7",
  black: "#09090b",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e4e4e7",
  brightBlack: "#a1a1aa",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
};

function systemMessage(text: string) {
  return `\r\n\x1b[38;5;246m${text}\x1b[0m\r\n`;
}

function shellEscapePath(path: string) {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

type SnapshotTerminalEvent = Extract<TerminalEvent, { snapshot: TerminalSessionSnapshot }>;

const ANSI_ESCAPE_SEQUENCE_PATTERN = String.raw`\x1b`;
const TRANSIENT_ZSH_PROMPT_PLACEHOLDER_PATTERN = new RegExp(
  String.raw`${ANSI_ESCAPE_SEQUENCE_PATTERN}\[1m${ANSI_ESCAPE_SEQUENCE_PATTERN}\[7m%${ANSI_ESCAPE_SEQUENCE_PATTERN}\[27m${ANSI_ESCAPE_SEQUENCE_PATTERN}\[1m${ANSI_ESCAPE_SEQUENCE_PATTERN}\[0m[^\S\r\n]*\r[^\S\r\n]*\r`,
  "g",
);

export function normalizeTerminalReplayHistory(history: string) {
  return history.replaceAll(TRANSIENT_ZSH_PROMPT_PLACEHOLDER_PATTERN, "");
}

export function shouldReplaceRenderedTerminalHistory(args: {
  allowTruncate?: boolean;
  currentHistory: string | null;
  nextHistory: string;
}) {
  if (args.currentHistory === args.nextHistory) {
    return false;
  }
  if (
    args.allowTruncate === false &&
    args.currentHistory !== null &&
    args.currentHistory.startsWith(args.nextHistory)
  ) {
    return false;
  }
  return true;
}

export function shouldReplaySnapshotForTerminalEvent(
  event: TerminalEvent,
): event is SnapshotTerminalEvent {
  return event.type === "started" || event.type === "updated" || event.type === "cleared";
}

export function shouldTruncateTerminalHistory(type: SnapshotTerminalEvent["type"]) {
  return type === "cleared";
}

export function shouldForceReplaySettledTerminalSnapshot(args: {
  nextStatus: TerminalSessionSnapshot["status"];
  previousStatus: TerminalSessionSnapshot["status"] | null;
}) {
  return (
    args.previousStatus !== null &&
    isTerminalSessionStartPending(args.previousStatus) &&
    !isTerminalSessionStartPending(args.nextStatus)
  );
}

function parseUriList(uriList: string) {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((line) => {
      try {
        const url = new URL(line);
        if (url.protocol !== "file:") {
          return [];
        }
        return [decodeURIComponent(url.pathname)];
      } catch {
        return [];
      }
    });
}

function getDroppedPaths(dataTransfer: DataTransfer) {
  const filePaths = Array.from(dataTransfer.files)
    .map((file) => window.desktop.getPathForFile(file).trim())
    .filter((path) => path.length > 0);
  const itemPaths = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .map((file) => window.desktop.getPathForFile(file).trim())
    .filter((path) => path.length > 0);
  const uriPaths = parseUriList(dataTransfer.getData("text/uri-list"));
  return Array.from(new Set([...filePaths, ...itemPaths, ...uriPaths]));
}

export function TerminalView({
  projectId,
  session,
  tab,
}: {
  projectId: string;
  session?: TerminalSessionSnapshot | null;
  tab: ProjectTabRecord;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedHistoryRef = useRef<string | null>(null);
  const latestSessionHistoryRef = useRef<string | null>(null);
  const latestSessionStatusRef = useRef<TerminalSessionSnapshot["status"] | null>(session?.status ?? null);
  const dragDepthRef = useRef(0);
  const isDark = useDarkMode();
  const [exitHint, setExitHint] = useState<string | null>(null);
  const sessionHistory = session?.history ?? null;
  latestSessionHistoryRef.current = sessionHistory;
  latestSessionStatusRef.current = session?.status ?? null;

  // Update xterm theme when OS preference changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = isDark ? darkTheme : lightTheme;
  }, [isDark]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initialTheme = getPrefersDarkMode() ? darkTheme : lightTheme;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      theme: initialTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    const replayGuard = createTerminalReplayGuard();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedHistoryRef.current = null;

    function renderSnapshot(history: string, options?: { allowTruncate?: boolean; forceReplay?: boolean }) {
      const nextRenderedHistory = normalizeTerminalReplayHistory(history);
      if (
        !options?.forceReplay &&
        !shouldReplaceRenderedTerminalHistory({
          allowTruncate: options?.allowTruncate,
          currentHistory:
            renderedHistoryRef.current === null
              ? null
              : normalizeTerminalReplayHistory(renderedHistoryRef.current),
          nextHistory: nextRenderedHistory,
        })
      ) {
        return;
      }
      replayGuard.replay(terminal, `\u001bc${nextRenderedHistory}`);
      renderedHistoryRef.current = history;
    }
    if (latestSessionHistoryRef.current !== null) {
      renderSnapshot(latestSessionHistoryRef.current, { allowTruncate: false });
    }

    const writeDisposable = terminal.onData((data) => {
      if (replayGuard.isReplaying()) {
        return;
      }
      setExitHint(null);
      void window.desktop.terminalWrite({ data, projectId, tabId: tab.id });
    });

    const resizeObserver = new ResizeObserver(() => {
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) return;
      activeFitAddon.fit();
      void window.desktop.terminalResize({
        cols: activeTerminal.cols,
        projectId,
        rows: activeTerminal.rows,
        tabId: tab.id,
      });
    });
    resizeObserver.observe(host);

    function writeToTerminal(data: string) {
      if (!data) {
        return;
      }
      setExitHint(null);
      void window.desktop.terminalWrite({ data, projectId, tabId: tab.id });
    }

    function pasteIntoTerminal(data: string) {
      if (!data) {
        return;
      }
      setExitHint(null);
      const activeTerminal = terminalRef.current;
      if (activeTerminal) {
        activeTerminal.focus();
        activeTerminal.paste(data);
        return;
      }
      writeToTerminal(data);
    }

    function handleDragEnter(event: DragEvent) {
      if (!event.dataTransfer) {
        return;
      }
      dragDepthRef.current += 1;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }

    function handleDragOver(event: DragEvent) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }

    function handleDragLeave(event: DragEvent) {
      if (!event.dataTransfer) {
        return;
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    }

    function handleDrop(event: DragEvent) {
      const dataTransfer = event.dataTransfer;
      dragDepthRef.current = 0;
      if (!dataTransfer) {
        return;
      }
      event.preventDefault();

      const droppedPaths = getDroppedPaths(dataTransfer);
      if (droppedPaths.length > 0) {
        pasteIntoTerminal(`${droppedPaths.map(shellEscapePath).join(" ")} `);
        return;
      }

      const text = dataTransfer.getData("text/plain");
      if (text) {
        pasteIntoTerminal(text);
      }
    }

    host.addEventListener("dragenter", handleDragEnter);
    host.addEventListener("dragover", handleDragOver);
    host.addEventListener("dragleave", handleDragLeave);
    host.addEventListener("drop", handleDrop);

    const handleEvent = (event: TerminalEvent) => {
      if (event.projectId !== projectId || event.tabId !== tab.id) return;
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      if (event.type === "output") {
        setExitHint(null);
        activeTerminal.write(event.data);
        renderedHistoryRef.current = `${renderedHistoryRef.current ?? ""}${event.data}`;
        return;
      }
      if (shouldReplaySnapshotForTerminalEvent(event)) {
        setExitHint(null);
        const forceReplay =
          event.type === "updated" &&
          shouldForceReplaySettledTerminalSnapshot({
            nextStatus: event.snapshot.status,
            previousStatus: latestSessionStatusRef.current,
          });
        renderSnapshot(event.snapshot.history, {
          allowTruncate: shouldTruncateTerminalHistory(event.type),
          forceReplay,
        });
        latestSessionStatusRef.current = event.snapshot.status;
        return;
      }
      if (event.type === "error") {
        activeTerminal.write(systemMessage(event.message));
        return;
      }
      if (event.type === "stopped") {
        setExitHint(
          tab.kind === "shell"
            ? "Shell exited. Press any key to reopen."
            : "Process exited. Use Run to start it again.",
        );
        activeTerminal.write(systemMessage(`Process exited${event.exitCode == null ? "" : ` (${event.exitCode})`}`));
      }
    };

    const unsubscribeEvents = window.desktop.watchTerminalEvents(handleEvent);

    void window.desktop
      .openTerminal({
        cols: terminal.cols,
        projectId,
        rows: terminal.rows,
        tabId: tab.id,
      })
      .then((snapshot) => {
        if (!snapshot) {
          terminal.write(systemMessage("Terminal tab is no longer available."));
          return;
        }
        renderSnapshot(snapshot.history, { allowTruncate: false });
        latestSessionStatusRef.current = snapshot.status;
        terminal.focus();
      })
      .catch((error) => {
        terminal.write(systemMessage(error instanceof Error ? error.message : "Unable to open terminal"));
      });

    return () => {
      unsubscribeEvents();
      resizeObserver.disconnect();
      writeDisposable.dispose();
      host.removeEventListener("dragenter", handleDragEnter);
      host.removeEventListener("dragover", handleDragOver);
      host.removeEventListener("dragleave", handleDragLeave);
      host.removeEventListener("drop", handleDrop);
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, [projectId, tab.id, tab.kind]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 p-3">
        <div className="relative h-full w-full">
          <div
            ref={hostRef}
            className="terminal-host h-full w-full overflow-hidden"
            style={{ backgroundColor: isDark ? darkTheme.background : lightTheme.background }}
          />
          {exitHint ? (
            <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {exitHint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
