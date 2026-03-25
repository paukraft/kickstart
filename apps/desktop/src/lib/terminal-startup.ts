interface TerminalStartupGateOptions {
  maxWaitMs?: number;
  quietWindowMs?: number;
}

export interface TerminalStartupGate {
  dispose: () => void;
  isReady: () => boolean;
  signalActivity: () => void;
  waitUntilReady: () => Promise<void>;
}

const DEFAULT_MAX_WAIT_MS = 1500;
const DEFAULT_QUIET_WINDOW_MS = 120;

export function createTerminalStartupGate(
  options: TerminalStartupGateOptions = {},
): TerminalStartupGate {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;

  let ready = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function clearTimers() {
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  }

  function markReady() {
    if (ready) {
      return;
    }
    ready = true;
    clearTimers();
    resolveReady?.();
    resolveReady = null;
  }

  maxTimer = setTimeout(markReady, maxWaitMs);

  return {
    dispose() {
      markReady();
    },
    isReady() {
      return ready;
    },
    signalActivity() {
      if (ready) {
        return;
      }
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      quietTimer = setTimeout(markReady, quietWindowMs);
    },
    waitUntilReady() {
      return ready ? Promise.resolve() : readyPromise;
    },
  };
}

export function shouldAllowManagedRun(args: {
  hasActiveProcess: boolean;
  lastCommand: string | null;
  managedRunActive: boolean;
  startupBypassActive: boolean;
}) {
  if (!args.hasActiveProcess) {
    return true;
  }

  return args.startupBypassActive && !args.managedRunActive && args.lastCommand === null;
}
