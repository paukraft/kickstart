import { describe, expect, it, vi } from "vitest";

import { createTerminalStartupGate, shouldAllowManagedRun } from "./terminal-startup";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createTerminalStartupGate", () => {
  it("becomes ready after a quiet period following shell output", async () => {
    const gate = createTerminalStartupGate({ maxWaitMs: 100, quietWindowMs: 10 });
    const readySpy = vi.fn();
    void gate.waitUntilReady().then(readySpy);

    gate.signalActivity();
    await wait(5);
    expect(gate.isReady()).toBe(false);

    await wait(15);
    expect(gate.isReady()).toBe(true);
    expect(readySpy).toHaveBeenCalledOnce();
  });

  it("falls back to the max wait when the shell stays silent", async () => {
    const gate = createTerminalStartupGate({ maxWaitMs: 20, quietWindowMs: 100 });

    await wait(5);
    expect(gate.isReady()).toBe(false);

    await wait(25);
    expect(gate.isReady()).toBe(true);
  });
});

describe("shouldAllowManagedRun", () => {
  it("allows normal runs when there is no active process", () => {
    expect(
      shouldAllowManagedRun({
        hasActiveProcess: false,
        lastCommand: null,
        managedRunActive: false,
        startupBypassActive: false,
      }),
    ).toBe(true);
  });

  it("allows one startup-time bypass for shell helper processes", () => {
    expect(
      shouldAllowManagedRun({
        hasActiveProcess: true,
        lastCommand: null,
        managedRunActive: false,
        startupBypassActive: true,
      }),
    ).toBe(true);
  });

  it("blocks when the session already has real command activity", () => {
    expect(
      shouldAllowManagedRun({
        hasActiveProcess: true,
        lastCommand: "pnpm dev",
        managedRunActive: false,
        startupBypassActive: true,
      }),
    ).toBe(false);
  });
});
