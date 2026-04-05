import { describe, expect, it } from "vitest";
import { createEffectiveCommandId, type CommandConfig } from "@kickstart/contracts";

import {
  createCommandInConfig,
  createEmptyKickstartConfig,
  deleteCommandFromConfig,
  hydrateEditableKickstartConfig,
  normalizeKickstartConfig,
  reorderResolvedCommands,
  resolveMergedKickstartConfig,
  resolveSourceCommandOrder,
  reorderCommandsInConfig,
  stringifyKickstartConfig,
  upsertCommandInConfig,
} from "./config";

describe("normalizeKickstartConfig", () => {
  it("hydrates editable commands without inventing a stored name", () => {
    const config = hydrateEditableKickstartConfig({
      commands: [{ command: "bun dev", cwd: "apps/web" }],
    });

    expect(config.commands[0]).toMatchObject({
      command: "bun dev",
      cwd: "apps/web",
      id: "apps-web-bun-dev",
      startMode: "manual",
      type: "service",
    });
    expect(config.commands[0].name).toBeUndefined();
  });

  it("hydrates ids for legacy commands that do not store one yet", () => {
    const config = normalizeKickstartConfig({
      commands: [
        { command: "bun dev", cwd: "apps/web", name: "Web" },
        { command: "bun test", cwd: "apps/web", name: "Test" },
      ],
    });

    expect(config.commands.map((command) => command.id)).toEqual([
      "apps-web-bun-dev",
      "apps-web-bun-test",
    ]);
  });

  it("derives a runtime name when the persisted config omits it", () => {
    const config = normalizeKickstartConfig({
      commands: [{ command: "bun dev", cwd: "apps/web" }],
    });

    expect(config.commands[0]).toMatchObject({
      id: "apps-web-bun-dev",
      name: "bun dev",
    });
  });

  it("preserves a stored id across later edits", () => {
    const config = normalizeKickstartConfig({
      commands: [{ command: "bun dev --hot", cwd: "apps/web", id: "web-dev", name: "Web" }],
    });

    expect(config.commands[0]).toMatchObject({
      id: "web-dev",
      name: "Web",
    });
  });
});

describe("config mutations", () => {
  it("upserts, reorders, and deletes commands", () => {
    let config = createEmptyKickstartConfig();
    config = upsertCommandInConfig(config, {
      command: "bun dev",
      cwd: ".",
      id: "bun-dev",
      name: "Web",
      startMode: "auto",
      type: "service",
    });
    config = upsertCommandInConfig(config, {
      command: "bun test --watch",
      cwd: ".",
      id: "bun-test-watch",
      name: "Tests",
      soundId: "happy",
      startMode: "manual",
      type: "action",
    });
    config = reorderCommandsInConfig(config, ["bun-test-watch", "bun-dev"]);
    config = deleteCommandFromConfig(config, "bun-dev");

    expect(config.commands.map((command) => command.id)).toEqual(["bun-test-watch"]);
    expect(stringifyKickstartConfig(config)).toContain("\"id\": \"bun-test-watch\"");
    expect(stringifyKickstartConfig(config)).not.toContain("\"cwd\"");
    expect(stringifyKickstartConfig(config)).toContain("\"soundId\": \"happy\"");
    expect(stringifyKickstartConfig(config)).toContain("\"type\": \"action\"");
    expect(stringifyKickstartConfig(config)).not.toContain("\"startMode\": \"manual\"");
  });

  it("creates a second command even when every saved setting matches", () => {
    let config = createEmptyKickstartConfig();
    const duplicateCommand: CommandConfig = {
      command: "bun dev",
      cwd: ".",
      env: {
        NODE_ENV: "development",
      },
      id: "command-bun-dev",
      name: "Web",
      startMode: "auto",
      type: "service",
    };

    config = createCommandInConfig(config, duplicateCommand);
    config = createCommandInConfig(config, duplicateCommand);

    expect(config.commands).toHaveLength(2);
    expect(config.commands.map((command) => command.id)).toEqual([
      "command-bun-dev",
      "command-bun-dev-2",
    ]);
    expect(config.commands.map(({ id: _id, ...command }) => command)).toEqual([
      {
        command: "bun dev",
        cwd: ".",
        env: {
          NODE_ENV: "development",
        },
        name: "Web",
        startMode: "auto",
        type: "service",
      },
      {
        command: "bun dev",
        cwd: ".",
        env: {
          NODE_ENV: "development",
        },
        name: "Web",
        startMode: "auto",
        type: "service",
      },
    ]);
  });

  it("normalizes action commands to manual start mode", () => {
    const config = normalizeKickstartConfig({
      commands: [
        {
          command: "bun test",
          cwd: ".",
          startMode: "auto",
          type: "action",
        },
      ],
    });

    expect(config.commands[0]).toMatchObject({
      startMode: "manual",
      type: "action",
    });
  });

  it("omits empty action sounds from persisted config", () => {
    const config = normalizeKickstartConfig({
      commands: [
        {
          command: "bun test",
          cwd: ".",
          id: "test",
          soundId: null,
          type: "action",
        },
      ],
    });

    expect(stringifyKickstartConfig(config)).not.toContain("\"soundId\"");
  });
});

describe("resolveMergedKickstartConfig", () => {
  it("merges shared and local commands without id collisions", () => {
    const config = resolveMergedKickstartConfig({
      local: {
        commands: [{ command: "pnpm dev", cwd: ".", id: "dev", startMode: "manual", type: "service" }],
      },
      shared: {
        commands: [{ command: "pnpm dev", cwd: ".", id: "dev", startMode: "manual", type: "service" }],
      },
    });

    expect(config.commands.map((command) => command.id)).toEqual([
      "shared:dev",
      "local:dev",
    ]);
  });

  it("keeps shared commands before local commands", () => {
    const config = resolveMergedKickstartConfig({
      local: {
        commands: [{ command: "pnpm lint", cwd: ".", id: "lint", startMode: "manual", type: "action" }],
      },
      shared: {
        commands: [{ command: "pnpm dev", cwd: ".", id: "dev", startMode: "manual", type: "service" }],
      },
    });

    expect(config.commands.map((command) => command.id)).toEqual([
      "shared:dev",
      "local:lint",
    ]);
  });

  it("derives source-local order from any transient reordered sequence", () => {
    const resolved = resolveMergedKickstartConfig({
      local: {
        commands: [
          { command: "pnpm lint", cwd: ".", id: "lint", startMode: "manual", type: "action" },
          { command: "pnpm test", cwd: ".", id: "test", startMode: "manual", type: "action" },
        ],
      },
      shared: {
        commands: [{ command: "pnpm dev", cwd: ".", id: "dev", startMode: "manual", type: "service" }],
      },
    });

    const ordered = reorderResolvedCommands(resolved.commands, [
      createEffectiveCommandId("local", "test"),
      createEffectiveCommandId("shared", "dev"),
      createEffectiveCommandId("local", "lint"),
    ]);

    expect(resolveSourceCommandOrder(ordered, "shared")).toEqual(["dev"]);
    expect(resolveSourceCommandOrder(ordered, "local")).toEqual(["test", "lint"]);
  });
});

describe("reorderResolvedCommands", () => {
  it("applies an explicit effective-id order and appends anything missing", () => {
    expect(
      reorderResolvedCommands(
        [
          {
            command: "pnpm dev",
            cwd: ".",
            id: createEffectiveCommandId("shared", "a"),
            name: "A",
            source: "shared",
            sourceCommandId: "a",
            startMode: "manual",
            type: "service",
          },
          {
            command: "pnpm test",
            cwd: ".",
            id: createEffectiveCommandId("local", "b"),
            name: "B",
            source: "local",
            sourceCommandId: "b",
            startMode: "manual",
            type: "action",
          },
        ],
        [createEffectiveCommandId("local", "b")],
      ),
    ).toEqual([
      expect.objectContaining({ id: createEffectiveCommandId("local", "b") }),
      expect.objectContaining({ id: createEffectiveCommandId("shared", "a") }),
    ]);
  });
});
