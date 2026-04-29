import os from "node:os";

export function getPrimaryPrivateNetworkAddress(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
) {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIPv4Address(entry.address)
      ) {
        return entry.address;
      }
    }
  }
  return null;
}

export function resolveNetworkUrl(
  localUrl: string,
  address = getPrimaryPrivateNetworkAddress(),
) {
  if (!address) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(localUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (!isReplaceableLocalHostname(parsed.hostname)) {
    return null;
  }

  parsed.hostname = address;
  return parsed.toString();
}

function isReplaceableLocalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "::"
  );
}

function isPrivateIPv4Address(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
