import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal, type ITheme } from "@xterm/xterm";

import type { ProjectTabRecord, TerminalEvent, TerminalSessionSnapshot } from "@kickstart/contracts";

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

const resetReplayOnlyTerminalModes =
  "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?25h\x1b[0m";
const enterAlternateScreenPattern = new RegExp(String.raw`\u001b\[\?(?:47|1047|1049)h`, "g");
const leaveAlternateScreenPattern = new RegExp(String.raw`\u001b\[\?(?:47|1047|1049)l`, "g");

function endsInAlternateScreen(history: string) {
  let lastEnter = -1;
  let lastLeave = -1;
  for (const match of history.matchAll(enterAlternateScreenPattern)) {
    lastEnter = match.index;
  }
  for (const match of history.matchAll(leaveAlternateScreenPattern)) {
    lastLeave = match.index;
  }
  return lastEnter > lastLeave;
}

export function terminalReplayData(history: string) {
  const leaveAlternateScreen = endsInAlternateScreen(history)
    ? "\x1b[?47l\x1b[?1047l\x1b[?1049l"
    : "";
  return `\x1bc${history}${leaveAlternateScreen}${resetReplayOnlyTerminalModes}`;
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
  tab,
}: {
  projectId: string;
  session?: TerminalSessionSnapshot | null;
  tab: ProjectTabRecord;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const renderedHistoryRef = useRef<string | null>(null);
  const renderedOutputRevisionRef = useRef(0);
  const dragDepthRef = useRef(0);
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const isDark = useDarkMode();
  const [exitHint, setExitHint] = useState<string | null>(null);

  // Update xterm theme when OS preference changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = isDark ? darkTheme : lightTheme;
  }, [isDark]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostElement = host;
    const initialTheme = getPrefersDarkMode() ? darkTheme : lightTheme;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: initialTheme,
    });
    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.open(hostElement);
    const replayGuard = createTerminalReplayGuard();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;
    renderedHistoryRef.current = null;
    renderedOutputRevisionRef.current = 0;
    lastReportedSizeRef.current = null;
    const terminalDebugHandle = {
      rowsText: () => hostElement.querySelector(".xterm-rows")?.textContent ?? "",
      scrollToBottom: () => terminal.scrollToBottom(),
      scrollToTop: () => terminal.scrollToTop(),
      serialize: () => serializeAddon.serialize(),
    };
    window.__kickstartTerminalDebug = terminalDebugHandle;

    let fitFrame: number | null = null;
    let serializeTimer: number | null = null;
    const fitTimeouts = new Set<number>();

    function persistSerializedSnapshot() {
      if (serializeTimer !== null) {
        clearTimeout(serializeTimer);
        serializeTimer = null;
      }
      const activeSerializeAddon = serializeAddonRef.current;
      if (!activeSerializeAddon) {
        return;
      }
      const snapshot = activeSerializeAddon.serialize();
      renderedHistoryRef.current = snapshot;
      void window.desktop.terminalSerialize({
        outputRevision: renderedOutputRevisionRef.current,
        projectId,
        snapshot,
        tabId: tab.id,
      });
    }

    function schedulePersistSerializedSnapshot() {
      if (serializeTimer !== null) {
        clearTimeout(serializeTimer);
      }
      serializeTimer = window.setTimeout(() => {
        serializeTimer = null;
        persistSerializedSnapshot();
      }, 120);
    }

    function fitAndResize() {
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) {
        return;
      }

      if (hostElement.clientWidth === 0 || hostElement.clientHeight === 0) {
        return;
      }

      activeFitAddon.fit();
      const nextSize = { cols: activeTerminal.cols, rows: activeTerminal.rows };
      const lastSize = lastReportedSizeRef.current;
      if (lastSize?.cols === nextSize.cols && lastSize?.rows === nextSize.rows) {
        return;
      }

      lastReportedSizeRef.current = nextSize;
      void window.desktop.terminalResize({
        cols: nextSize.cols,
        projectId,
        rows: nextSize.rows,
        tabId: tab.id,
      });
    }

    function scheduleFitAndResize() {
      if (fitFrame !== null) {
        cancelAnimationFrame(fitFrame);
      }
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        fitAndResize();
      });
    }

    function scheduleDelayedFitAndResize(delayMs: number) {
      const timeoutId = window.setTimeout(() => {
        fitTimeouts.delete(timeoutId);
        scheduleFitAndResize();
      }, delayMs);
      fitTimeouts.add(timeoutId);
    }

    scheduleFitAndResize();
    scheduleDelayedFitAndResize(0);
    scheduleDelayedFitAndResize(50);
    scheduleDelayedFitAndResize(150);
    scheduleDelayedFitAndResize(300);
    const fontsReady = document.fonts?.ready;
    if (fontsReady) {
      void fontsReady.then(() => {
        scheduleFitAndResize();
        scheduleDelayedFitAndResize(100);
      });
    }

    function renderSnapshot(
      history: string,
      outputRevision: number,
      options?: { allowTruncate?: boolean; forceReplay?: boolean },
    ) {
      if (
        !options?.forceReplay &&
        !shouldReplaceRenderedTerminalHistory({
          allowTruncate: options?.allowTruncate,
          currentHistory: renderedHistoryRef.current,
          nextHistory: history,
        })
      ) {
        return;
      }
      replayGuard.replay(terminal, terminalReplayData(history));
      renderedHistoryRef.current = history;
      renderedOutputRevisionRef.current = outputRevision;
      scheduleFitAndResize();
    }

    const writeDisposable = terminal.onData((data) => {
      if (replayGuard.isReplaying()) {
        return;
      }
      setExitHint(null);
      void window.desktop.terminalWrite({ data, projectId, tabId: tab.id });
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleFitAndResize();
    });
    resizeObserver.observe(hostElement);

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

    hostElement.addEventListener("dragenter", handleDragEnter);
    hostElement.addEventListener("dragover", handleDragOver);
    hostElement.addEventListener("dragleave", handleDragLeave);
    hostElement.addEventListener("drop", handleDrop);

    const handleEvent = (event: TerminalEvent) => {
      if (event.projectId !== projectId || event.tabId !== tab.id) return;
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      if (event.type === "output") {
        setExitHint(null);
        activeTerminal.write(event.data, () => {
          renderedHistoryRef.current = serializeAddon.serialize();
          renderedOutputRevisionRef.current = event.outputRevision;
          schedulePersistSerializedSnapshot();
        });
        return;
      }
      if (event.type === "started" || event.type === "cleared") {
        setExitHint(null);
        renderSnapshot(event.snapshot.history, event.snapshot.outputRevision, {
          allowTruncate: event.type === "cleared",
        });
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
        renderSnapshot(snapshot.history, snapshot.outputRevision, {
          allowTruncate: false,
          forceReplay: true,
        });
        const restoreReplayTimeoutId = window.setTimeout(() => {
          fitTimeouts.delete(restoreReplayTimeoutId);
          renderSnapshot(snapshot.history, snapshot.outputRevision, {
            allowTruncate: false,
            forceReplay: true,
          });
        }, 250);
        fitTimeouts.add(restoreReplayTimeoutId);
        terminal.focus();
      })
      .catch((error) => {
        terminal.write(systemMessage(error instanceof Error ? error.message : "Unable to open terminal"));
      });

    return () => {
      if (fitFrame !== null) {
        cancelAnimationFrame(fitFrame);
      }
      persistSerializedSnapshot();
      for (const timeoutId of fitTimeouts) {
        clearTimeout(timeoutId);
      }
      fitTimeouts.clear();
      unsubscribeEvents();
      resizeObserver.disconnect();
      writeDisposable.dispose();
      hostElement.removeEventListener("dragenter", handleDragEnter);
      hostElement.removeEventListener("dragover", handleDragOver);
      hostElement.removeEventListener("dragleave", handleDragLeave);
      hostElement.removeEventListener("drop", handleDrop);
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
      if (window.__kickstartTerminalDebug === terminalDebugHandle) {
        delete window.__kickstartTerminalDebug;
      }
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
