import { describe, expect, it } from "vitest";

import { reorderByIds } from "./reorder";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("reorderByIds", () => {
  it("moves an item before the target by default", () => {
    expect(reorderByIds(items, "d", "b").map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item before a later target", () => {
    expect(reorderByIds(items, "a", "c", "before").map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("moves an item after the target", () => {
    expect(reorderByIds(items, "a", "c", "after").map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item after an earlier target", () => {
    expect(reorderByIds(items, "d", "b", "after").map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
  });
});
