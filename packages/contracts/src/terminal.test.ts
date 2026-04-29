import { describe, expect, it } from "vitest";

import { isTerminalSessionLoading } from "./terminal";

describe("isTerminalSessionLoading", () => {
  it("treats only non-idle operations as loading", () => {
    expect(isTerminalSessionLoading("starting")).toBe(true);
    expect(isTerminalSessionLoading("stopping")).toBe(true);
    expect(isTerminalSessionLoading("restarting")).toBe(true);
    expect(isTerminalSessionLoading("none")).toBe(false);
  });
});
