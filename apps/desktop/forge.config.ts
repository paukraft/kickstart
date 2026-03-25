import path from "node:path";
import { cp, lstat, readdir, readlink, rename, rm } from "node:fs/promises";

import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

async function dereferenceNodeModulesSymlinks(rootPath: string, sourceRootPath: string) {
  const nodeModulesPath = path.join(rootPath, "node_modules");
  const pending = [nodeModulesPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const entryStats = await lstat(entryPath);

      if (entryStats.isSymbolicLink()) {
        const relativeEntryPath = path.relative(rootPath, entryPath);
        const sourceEntryPath = path.join(sourceRootPath, relativeEntryPath);
        const symlinkTarget = await readlink(sourceEntryPath);
        const resolvedTargetPath = path.resolve(path.dirname(sourceEntryPath), symlinkTarget);
        const replacementPath = `${entryPath}.__resolved__`;

        await rm(replacementPath, { force: true, recursive: true });
        await cp(resolvedTargetPath, replacementPath, {
          dereference: true,
          recursive: true,
        });
        await rm(entryPath, { force: true, recursive: true });
        await rename(replacementPath, entryPath);

        const resolvedStats = await lstat(entryPath);
        if (resolvedStats.isDirectory()) {
          pending.push(entryPath);
        }
        continue;
      }

      if (entryStats.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
}

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await dereferenceNodeModulesSymlinks(buildPath, __dirname);
    },
  },
  packagerConfig: {
    asar: true,
    executableName: "Kickstart",
    icon: path.resolve(__dirname, "resources", "icon"),
    name: "Kickstart",
    appBundleId: "com.kickstart.desktop",
    prune: false,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: path.resolve(__dirname, "resources", "icon.ico"),
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        prerelease: false,
        repository: {
          name: "kickstart",
          owner: "paukraft",
        },
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    new FusesPlugin({
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.RunAsNode]: false,
      version: FuseVersion.V1,
    }),
  ],
};

export default config;
