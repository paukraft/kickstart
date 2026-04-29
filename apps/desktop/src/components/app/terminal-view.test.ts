import { describe, expect, it } from "vitest";
import {
  shouldReplaceRenderedTerminalHistory,
  terminalReplayData,
} from "./terminal-view";

describe("terminalReplayData", () => {
  it("preserves raw history while resetting replayed mouse reporting modes", () => {
    const history = "before normal prompt";

    expect(terminalReplayData(history)).toBe(
      "\x1bcbefore normal prompt\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?25h\x1b[0m",
    );
  });

  it("leaves fullscreen mode only when replayed history is still in fullscreen mode", () => {
    const history = "before\x1b[?1049h\x1b[?1003hfullscreen tui";

    expect(terminalReplayData(history)).toBe(
      "\x1bcbefore\x1b[?1049h\x1b[?1003hfullscreen tui\x1b[?47l\x1b[?1047l\x1b[?1049l\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?25h\x1b[0m",
    );
  });

  it("does not leave fullscreen mode again when replayed history already left fullscreen mode", () => {
    const history = "before\x1b[?1049htui\x1b[?1049lafter";

    expect(terminalReplayData(history)).toBe(
      "\x1bcbefore\x1b[?1049htui\x1b[?1049lafter\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?25h\x1b[0m",
    );
  });
});

describe("shouldReplaceRenderedTerminalHistory", () => {
  it("does not replace a longer rendered history with a shorter non-clear snapshot", () => {
    expect(
      shouldReplaceRenderedTerminalHistory({
        allowTruncate: false,
        currentHistory: "old prompt\r\nnew prompt % ",
        nextHistory: "",
      }),
    ).toBe(false);
  });

  it("allows explicit clear events to truncate rendered history", () => {
    expect(
      shouldReplaceRenderedTerminalHistory({
        allowTruncate: true,
        currentHistory: "old prompt\r\nnew prompt % ",
        nextHistory: "",
      }),
    ).toBe(true);
  });
});
