import { describe, expect, it } from "vitest";

import { getPrimaryPrivateNetworkAddress, resolveNetworkUrl } from "./network-url";

describe("network-url", () => {
  it("selects the first non-internal private IPv4 address", () => {
    expect(
      getPrimaryPrivateNetworkAddress({
        lo0: [
          {
            address: "127.0.0.1",
            cidr: "127.0.0.1/8",
            family: "IPv4",
            internal: true,
            mac: "00:00:00:00:00:00",
            netmask: "255.0.0.0",
          },
        ],
        en0: [
          {
            address: "203.0.113.10",
            cidr: "203.0.113.10/24",
            family: "IPv4",
            internal: false,
            mac: "00:00:00:00:00:00",
            netmask: "255.255.255.0",
          },
          {
            address: "192.168.1.44",
            cidr: "192.168.1.44/24",
            family: "IPv4",
            internal: false,
            mac: "00:00:00:00:00:00",
            netmask: "255.255.255.0",
          },
        ],
      }),
    ).toBe("192.168.1.44");
  });

  it("replaces the local host in an http URL", () => {
    expect(resolveNetworkUrl("http://localhost:5173/dashboard?x=1", "192.168.1.44")).toBe(
      "http://192.168.1.44:5173/dashboard?x=1",
    );
  });

  it("returns null for invalid or unsupported URLs", () => {
    expect(resolveNetworkUrl("not a url", "192.168.1.44")).toBeNull();
    expect(resolveNetworkUrl("file:///tmp/index.html", "192.168.1.44")).toBeNull();
    expect(resolveNetworkUrl("http://localhost:3000", null)).toBeNull();
  });

  it("does not rewrite named localhost routes that depend on host headers", () => {
    expect(resolveNetworkUrl("http://kickstart.localhost:1355", "192.168.1.44")).toBeNull();
  });
});
