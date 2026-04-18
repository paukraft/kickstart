import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { desktopDir } from "./electron-launcher.mjs";

export function loadDesktopEnv() {
  const originalKeys = new Set(Object.keys(process.env));
  const mergedEnv = {};

  for (const envFileName of [".env", ".env.local"]) {
    const envFilePath = join(desktopDir, envFileName);
    if (!existsSync(envFilePath)) {
      continue;
    }

    Object.assign(mergedEnv, parseEnv(readFileSync(envFilePath, "utf8")));
  }

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (originalKeys.has(key)) {
      continue;
    }
    process.env[key] = value;
  }
}
