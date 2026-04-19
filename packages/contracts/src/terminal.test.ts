import { describe, expect, it } from "vitest";

import { isTerminalSessionLoading } from "./terminal";

describe("isTerminalSessionLoading", () => {
  it("treats only starting and stopping as loading", () => {
    expect(isTerminalSessionLoading("starting")).toBe(true);
    expect(isTerminalSessionLoading("stopping")).toBe(true);
    expect(isTerminalSessionLoading("booting")).toBe(false);
    expect(isTerminalSessionLoading("running")).toBe(false);
    expect(isTerminalSessionLoading("idle")).toBe(false);
  });
});
