import { describe, expect, it } from "vitest";

import type { ProjectTabRecord, ResolvedCommandConfig } from "@kickstart/contracts";
import { createCommandTabId, createEffectiveCommandId, deriveCommandId } from "@kickstart/contracts";

import { envTextToRecord, getPreferredCommandTabId } from "./command-utils";

describe("deriveCommandId", () => {
  it("normalizes ids", () => {
    expect(deriveCommandId("bun dev", "apps/api")).toBe("apps-api-bun-dev");
  });
});

describe("envTextToRecord", () => {
  it("parses env text", () => {
    expect(envTextToRecord("PORT=3000\nNODE_ENV=development")).toEqual({
      NODE_ENV: "development",
      PORT: "3000",
    });
  });

  it("throws for malformed lines", () => {
    expect(() => envTextToRecord("not-valid")).toThrow();
  });
});

function createCommand(
  input: Partial<ResolvedCommandConfig> & Pick<ResolvedCommandConfig, "sourceCommandId">,
): ResolvedCommandConfig {
  const id = input.id ?? createEffectiveCommandId("shared", input.sourceCommandId);
  return {
    command: "bun dev",
    cwd: ".",
    id,
    name: input.name ?? id,
    source: input.source ?? "shared",
    sourceCommandId: input.sourceCommandId,
    startMode: input.startMode ?? "manual",
    type: input.type ?? "service",
  };
}

function createCommandTab(commandId: string, sortOrder: number): ProjectTabRecord {
  const effectiveCommandId = createEffectiveCommandId("shared", commandId);
  return {
    commandId: effectiveCommandId,
    createdAt: "2026-03-24T00:00:00.000Z",
    id: createCommandTabId(effectiveCommandId),
    kind: "command",
    projectId: "project-1",
    shellCwd: ".",
    sortOrder,
    title: commandId,
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("getPreferredCommandTabId", () => {
  it("prefers the first service command tab", () => {
    const commands = [
      createCommand({ sourceCommandId: "build", type: "action" }),
      createCommand({ sourceCommandId: "api", type: "service" }),
      createCommand({ sourceCommandId: "web", type: "service" }),
    ];
    const tabs = [
      createCommandTab("build", 0),
      createCommandTab("api", 1),
      createCommandTab("web", 2),
    ];

    expect(getPreferredCommandTabId(commands, tabs)).toBe(
      createCommandTabId(createEffectiveCommandId("shared", "api")),
    );
  });

  it("falls back to the first action command tab when no service exists", () => {
    const commands = [
      createCommand({ sourceCommandId: "build", type: "action" }),
      createCommand({ sourceCommandId: "lint", type: "action" }),
    ];
    const tabs = [createCommandTab("build", 0), createCommandTab("lint", 1)];

    expect(getPreferredCommandTabId(commands, tabs)).toBe(
      createCommandTabId(createEffectiveCommandId("shared", "build")),
    );
  });
});
