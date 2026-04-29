import { describe, expect, it } from "vitest";

import type { TerminalPortUsage } from "@kickstart/contracts";

import {
  getPortBadges,
  inferBindingBadge,
  inferServiceBadge,
  primaryOpenUrl,
} from "./port-usage-pills";

function createUsage(
  address: string,
  portlessRoutes: TerminalPortUsage["portlessRoutes"] = [],
  overrides: Partial<TerminalPortUsage> = {},
): TerminalPortUsage {
  return {
    address,
    cwd: "/repo",
    id: "usage",
    lastCommand: null,
    pid: 123,
    port: 5173,
    portlessRoutes,
    processName: "node",
    projectId: "project",
    protocol: "tcp",
    tabId: "tab",
    tabKind: "command",
    tabTitle: "Dev",
    terminalPid: 100,
    updatedAt: "2026-04-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("primaryOpenUrl", () => {
  it("uses portless routes before listener addresses", () => {
    expect(
      primaryOpenUrl(
        createUsage("*", [
          {
            hostname: "app.localhost",
            pid: null,
            port: 5173,
            url: "https://app.localhost",
          },
        ]),
      ),
    ).toBe("https://app.localhost");
  });

  it("normalizes wildcard listener addresses to localhost", () => {
    expect(primaryOpenUrl(createUsage("*"))).toBe("http://localhost:5173");
    expect(primaryOpenUrl(createUsage("0.0.0.0"))).toBe("http://localhost:5173");
    expect(primaryOpenUrl(createUsage("::"))).toBe("http://localhost:5173");
    expect(primaryOpenUrl(createUsage("[::]"))).toBe("http://localhost:5173");
  });

  it("uses specific listener addresses as the URL host", () => {
    expect(primaryOpenUrl(createUsage("192.168.1.44"))).toBe(
      "http://192.168.1.44:5173",
    );
    expect(primaryOpenUrl(createUsage("localhost"))).toBe("http://localhost:5173");
    expect(primaryOpenUrl(createUsage("[::1]"))).toBe("http://[::1]:5173");
    expect(primaryOpenUrl(createUsage("::1"))).toBe("http://[::1]:5173");
  });
});

describe("port badges", () => {
  it("infers service badges from command, process, preview, and known ports", () => {
    expect(inferServiceBadge(createUsage("*", [], { lastCommand: "bun vite --host" }))).toBe("Vite");
    expect(inferServiceBadge(createUsage("*", [], { lastCommand: "next dev" }))).toBe("Next.js");
    expect(inferServiceBadge(createUsage("*", [], { lastCommand: "sveltekit dev" }))).toBe("SvelteKit");
    expect(inferServiceBadge(createUsage("*", [], { processName: "node" }))).toBe("Node");
    expect(inferServiceBadge(createUsage("*", [], { port: 5432 }))).toBe("Postgres");
    expect(
      inferServiceBadge(createUsage("*"), {
        description: "Preview",
        frameworkId: null,
        siteName: null,
        title: "Dashboard",
        url: "http://localhost:5173",
      }),
    ).toBe("Web app");
    expect(
      inferServiceBadge(createUsage("*"), {
        description: "Preview",
        frameworkId: "next",
        siteName: null,
        title: "Dashboard",
        url: "http://localhost:3000",
      }),
    ).toBe("Next.js");
  });

  it("infers binding badges from listener addresses", () => {
    expect(inferBindingBadge("*")).toBe("Network visible");
    expect(inferBindingBadge("0.0.0.0")).toBe("Network visible");
    expect(inferBindingBadge("localhost")).toBe("Local only");
    expect(inferBindingBadge("127.0.0.1")).toBe("Local only");
    expect(inferBindingBadge("192.168.1.10")).toBe("Specific host");
  });

  it("shows network visibility for Portless routes when the original listener is network visible", () => {
    expect(
      getPortBadges(
        createUsage("*", [
          {
            hostname: "kickstart.localhost",
            pid: null,
            port: 4286,
            url: "http://kickstart.localhost:1355",
          },
        ]),
      ),
    ).toContain("Network visible");
  });
});
