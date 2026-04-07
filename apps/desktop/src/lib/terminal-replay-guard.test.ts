import { describe, expect, it } from "vitest";

import { createTerminalReplayGuard } from "./terminal-replay-guard";

describe("createTerminalReplayGuard", () => {
  it("blocks terminal input forwarding until the replayed write finishes", () => {
    let onWriteComplete: () => void = () => {
      throw new Error("Replay write callback was not captured.");
    };
    const terminal = {
      write(data: string, callback?: () => void) {
        expect(data).toBe("\u001bc\u001b[cprompt");
        onWriteComplete = callback ?? onWriteComplete;
      },
    };

    const guard = createTerminalReplayGuard();
    guard.replay(terminal, "\u001bc\u001b[cprompt");

    expect(guard.isReplaying()).toBe(true);

    onWriteComplete();

    expect(guard.isReplaying()).toBe(false);
  });
});
