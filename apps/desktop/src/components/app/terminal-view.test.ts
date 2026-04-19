import { describe, expect, it } from "vitest";

import {
  normalizeTerminalReplayHistory,
  shouldForceReplaySettledTerminalSnapshot,
  shouldReplaceRenderedTerminalHistory,
  shouldReplaySnapshotForTerminalEvent,
  shouldTruncateTerminalHistory,
} from "./terminal-view";

describe("shouldReplaySnapshotForTerminalEvent", () => {
  it("replays full snapshots for lifecycle updates that carry history", () => {
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        projectId: "project-1",
        snapshot: {
          activeProcessCount: 0,
          cols: 120,
          cwd: "/tmp/project",
          exitCode: null,
          hasActiveProcess: false,
          history: "",
          kind: "shell",
          lastCommand: null,
          managedRunActive: false,
          pid: 123,
          projectId: "project-1",
          rows: 36,
          status: "idle",
          tabId: "tab-1",
          updatedAt: "",
        },
        tabId: "tab-1",
        type: "started",
      }),
    ).toBe(true);
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        projectId: "project-1",
        snapshot: {
          activeProcessCount: 0,
          cols: 120,
          cwd: "/tmp/project",
          exitCode: null,
          hasActiveProcess: false,
          history: "",
          kind: "shell",
          lastCommand: null,
          managedRunActive: false,
          pid: 123,
          projectId: "project-1",
          rows: 36,
          status: "idle",
          tabId: "tab-1",
          updatedAt: "",
        },
        tabId: "tab-1",
        type: "updated",
      }),
    ).toBe(true);
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        projectId: "project-1",
        snapshot: {
          activeProcessCount: 0,
          cols: 120,
          cwd: "/tmp/project",
          exitCode: null,
          hasActiveProcess: false,
          history: "",
          kind: "shell",
          lastCommand: null,
          managedRunActive: false,
          pid: 123,
          projectId: "project-1",
          rows: 36,
          status: "idle",
          tabId: "tab-1",
          updatedAt: "",
        },
        tabId: "tab-1",
        type: "cleared",
      }),
    ).toBe(true);
  });

  it("does not replay snapshots for streaming or message-only events", () => {
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        data: "",
        projectId: "project-1",
        tabId: "tab-1",
        type: "output",
      }),
    ).toBe(false);
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        message: "boom",
        projectId: "project-1",
        tabId: "tab-1",
        type: "error",
      }),
    ).toBe(false);
    expect(
      shouldReplaySnapshotForTerminalEvent({
        createdAt: "",
        exitCode: 0,
        projectId: "project-1",
        tabId: "tab-1",
        type: "stopped",
      }),
    ).toBe(false);
  });
});

describe("shouldReplaceRenderedTerminalHistory", () => {
  it("does not replace identical history", () => {
    expect(
      shouldReplaceRenderedTerminalHistory({
        currentHistory: "hello\n",
        nextHistory: "hello\n",
      }),
    ).toBe(false);
  });

  it("keeps the fuller replay when open returns a stale prefix", () => {
    expect(
      shouldReplaceRenderedTerminalHistory({
        allowTruncate: false,
        currentHistory: "hello\nworld\n",
        nextHistory: "hello\n",
      }),
    ).toBe(false);
  });

  it("allows authoritative truncation for cleared or updated snapshots", () => {
    expect(
      shouldReplaceRenderedTerminalHistory({
        currentHistory: "hello\nworld\n",
        nextHistory: "",
      }),
    ).toBe(true);
  });
});

describe("normalizeTerminalReplayHistory", () => {
  it("removes transient zsh prompt placeholders before replay", () => {
    const rawHistory =
      '^Cerror: script "dev" exited with code 130\r\n' +
      "\u001b]0;zsh\u0007" +
      "\u001b[1m\u001b[7m%\u001b[27m\u001b[1m\u001b[0m          \r \r" +
      "\u001b]697;StartPrompt\u0007" +
      "paukraft@MacBook-Pro-von-Pau paukraft % " +
      "\u001b]697;EndPrompt\u0007";

    expect(normalizeTerminalReplayHistory(rawHistory)).toBe(
      '^Cerror: script "dev" exited with code 130\r\n' +
        "\u001b]0;zsh\u0007" +
        "\u001b]697;StartPrompt\u0007" +
        "paukraft@MacBook-Pro-von-Pau paukraft % " +
        "\u001b]697;EndPrompt\u0007",
    );
  });

  it("keeps normal prompt text intact", () => {
    const history = "paukraft@MacBook-Pro-von-Pau paukraft % ";
    expect(normalizeTerminalReplayHistory(history)).toBe(history);
  });
});

describe("shouldForceReplaySettledTerminalSnapshot", () => {
  it("forces a replay when a booting terminal settles", () => {
    expect(
      shouldForceReplaySettledTerminalSnapshot({
        nextStatus: "idle",
        previousStatus: "booting",
      }),
    ).toBe(true);
  });

  it("does not force a replay for steady-state updates", () => {
    expect(
      shouldForceReplaySettledTerminalSnapshot({
        nextStatus: "running",
        previousStatus: "running",
      }),
    ).toBe(false);
  });
});

describe("shouldTruncateTerminalHistory", () => {
  it("only truncates on explicit clear events", () => {
    expect(shouldTruncateTerminalHistory("started")).toBe(false);
    expect(shouldTruncateTerminalHistory("updated")).toBe(false);
    expect(shouldTruncateTerminalHistory("cleared")).toBe(true);
  });
});
