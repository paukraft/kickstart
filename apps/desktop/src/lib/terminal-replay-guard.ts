type TerminalWriteTarget = {
  write: (data: string, callback?: () => void) => void;
};

export interface TerminalReplayGuard {
  isReplaying: () => boolean;
  replay: (terminal: TerminalWriteTarget, data: string) => void;
}

export function createTerminalReplayGuard(): TerminalReplayGuard {
  let pendingReplayCount = 0;

  return {
    isReplaying() {
      return pendingReplayCount > 0;
    },
    replay(terminal, data) {
      pendingReplayCount += 1;
      terminal.write(data, () => {
        pendingReplayCount = Math.max(0, pendingReplayCount - 1);
      });
    },
  };
}
