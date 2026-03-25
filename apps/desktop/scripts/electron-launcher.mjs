import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_VERSION = 3;
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const desktopDir = resolve(__dirname, "..");

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  const resourcesDir = join(appBundlePath, "Contents", "Resources");

  setPlistString(infoPlistPath, "CFBundleDisplayName", "Kickstart");
  setPlistString(infoPlistPath, "CFBundleExecutable", "Kickstart");
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");
  setPlistString(infoPlistPath, "CFBundleIdentifier", "com.kickstart.desktop.dev");
  setPlistString(infoPlistPath, "CFBundleName", "Kickstart");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, "Kickstart Dev.app");
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Kickstart");
  const iconPath = join(desktopDir, "resources", "icon.icns");
  const metadataPath = join(runtimeDir, "metadata.json");

  if (!existsSync(iconPath)) {
    return electronBinaryPath;
  }

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    iconMtimeMs: statSync(iconPath).mtimeMs,
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { force: true, recursive: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  if (existsSync(join(targetAppBundlePath, "Contents", "MacOS", "Electron"))) {
    const sourceBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
    rmSync(targetBinaryPath, { force: true });
    copyFileSync(sourceBinaryPath, targetBinaryPath);
    chmodSync(targetBinaryPath, statSync(sourceBinaryPath).mode);
  }
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

export function resolveElectronPath() {
  const electronBinaryPath = require("electron");

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}
