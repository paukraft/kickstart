import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDesktopEnv } from "../apps/desktop/scripts/load-desktop-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const desktopDir = join(repoRoot, "apps", "desktop");
const desktopPackageJson = JSON.parse(
  readFileSync(join(desktopDir, "package.json"), "utf8"),
);

loadDesktopEnv();

const HOST_PLATFORM = process.platform;
const DEFAULT_PLATFORM = HOST_PLATFORM;
const DEFAULT_ARCH = process.arch === "x64" ? "x64" : "arm64";
const DEFAULT_REPOSITORY = "paukraft/kickstart";

const PLATFORM_LABELS = {
  darwin: "mac",
  linux: "linux",
  win32: "win",
};

const DEFAULT_TARGETS = {
  darwin: "dmg",
  linux: "AppImage",
  win32: "nsis",
};

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);
const SUPPORTED_ARCHES = new Set(["arm64", "x64"]);

function fail(message) {
  console.error(`[desktop-artifact] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveMacBuildEnv() {
  const sdkPathResult = spawnSync("xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  });

  if (sdkPathResult.status !== 0) {
    fail("Failed to resolve the active macOS SDK path with xcrun.");
  }

  const sdkPath = sdkPathResult.stdout.trim();
  if (!sdkPath) {
    fail("xcrun returned an empty macOS SDK path.");
  }

  return {
    CPLUS_INCLUDE_PATH: `${sdkPath}/usr/include/c++/v1`,
    SDKROOT: sdkPath,
  };
}

function parseArgs(argv) {
  const options = {
    arch: DEFAULT_ARCH,
    outputDir: resolve(repoRoot, "release"),
    platform: DEFAULT_PLATFORM,
    publish: "never",
    signed: false,
    skipBuild: false,
    target: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--platform") {
      options.platform = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--arch") {
      options.arch = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      options.outputDir = resolve(repoRoot, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--target") {
      options.target = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--publish") {
      options.publish = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--signed") {
      options.signed = true;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    fail(`Unknown argument '${arg}'.`);
  }

  if (!SUPPORTED_PLATFORMS.has(options.platform)) {
    fail(`Unsupported platform '${options.platform}'. Use darwin, linux, or win32.`);
  }

  if (!SUPPORTED_ARCHES.has(options.arch)) {
    fail(`Unsupported arch '${options.arch}'. Use arm64 or x64.`);
  }

  if (!["never", "always"].includes(options.publish)) {
    fail(`Unsupported publish mode '${options.publish}'. Use never or always.`);
  }

  options.target ??= DEFAULT_TARGETS[options.platform];

  return options;
}

function resolveRepositoryConfig() {
  const rawRepository =
    process.env.KICKSTART_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_REPOSITORY;

  const [owner, repo] = rawRepository.split("/");
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    provider: "github",
    releaseType: "release",
    repo,
  };
}

function createBuildConfig(options) {
  const config = {
    appId: "com.kickstart.desktop",
    artifactName: "Kickstart-${version}-${arch}.${ext}",
    asar: true,
    directories: {
      buildResources: "resources",
      output: "dist",
    },
    productName: "Kickstart",
    publish: [],
  };

  const repository = resolveRepositoryConfig();
  if (repository) {
    config.publish = [repository];
  }

  if (options.platform === "darwin") {
    config.mac = {
      category: "public.app-category.developer-tools",
      icon: "icon.icns",
      identity: options.signed ? undefined : null,
      target: options.target === "dmg" ? ["dmg", "zip"] : [options.target],
    };
  }

  if (options.platform === "linux") {
    config.linux = {
      category: "Development",
      icon: "icon.png",
      target: [options.target],
    };
  }

  if (options.platform === "win32") {
    config.win = {
      icon: "icon.ico",
      target: [options.target],
    };
  }

  return config;
}

function stageDesktopApp(stageDir, options) {
  const stageAppDir = join(stageDir, "app");
  mkdirSync(stageAppDir, { recursive: true });

  const sourceDirs = [
    ["dist-electron", join(desktopDir, "dist-electron")],
    ["dist-renderer", join(desktopDir, "dist-renderer")],
    ["resources", join(desktopDir, "resources")],
  ];

  for (const [label, dirPath] of sourceDirs) {
    if (!existsSync(dirPath)) {
      fail(`Missing ${label} at ${dirPath}. Run the desktop build first.`);
    }
    cpSync(dirPath, join(stageAppDir, label), { recursive: true });
  }

  const stagePackageJson = {
    name: "kickstart-desktop",
    version: desktopPackageJson.version,
    private: true,
    description: desktopPackageJson.description,
    main: "dist-electron/main.js",
    productName: desktopPackageJson.productName ?? "Kickstart",
    author: "paukraft",
    kickstart: {
      telemetry: {
        enabled: process.env.KICKSTART_TELEMETRY_ENABLED?.trim().toLowerCase() !== "0" &&
          process.env.KICKSTART_TELEMETRY_ENABLED?.trim().toLowerCase() !== "false",
        posthogHost: process.env.KICKSTART_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com",
        posthogKey: process.env.KICKSTART_POSTHOG_KEY?.trim() || null,
      },
      updateMode: options.signed ? "auto" : "manual",
    },
    build: createBuildConfig(options),
    dependencies: {
      ...desktopPackageJson.dependencies,
    },
    devDependencies: {
      electron: desktopPackageJson.devDependencies.electron,
    },
  };

  writeFileSync(
    join(stageAppDir, "package.json"),
    `${JSON.stringify(stagePackageJson, null, 2)}\n`,
  );

  return stageAppDir;
}

function copyArtifacts(distDir, targetDir) {
  rmSync(targetDir, { force: true, recursive: true });
  mkdirSync(targetDir, { recursive: true });

  const copiedArtifacts = [];
  for (const entry of readdirSync(distDir)) {
    const sourcePath = join(distDir, entry);
    if (!statSync(sourcePath).isFile()) {
      continue;
    }

    const targetPath = join(targetDir, entry);
    cpSync(sourcePath, targetPath);
    copiedArtifacts.push(targetPath);
  }

  if (copiedArtifacts.length === 0) {
    fail(`Build completed but no distributable files were found in ${distDir}.`);
  }

  return copiedArtifacts;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const platformLabel = PLATFORM_LABELS[options.platform] ?? options.platform;
  const targetDir = join(options.outputDir, "desktop", platformLabel, options.arch);

  if (!options.skipBuild) {
    run("bun", ["run", "build:app"], { cwd: desktopDir });
  }

  const stageDir = mkdtempSync(join(tmpdir(), "kickstart-desktop-stage-"));

  try {
    const stageAppDir = stageDesktopApp(stageDir, options);
    const stageTempDir = join(stageDir, "tmp");
    const stageBunCacheDir = join(stageDir, "bun-cache");

    mkdirSync(stageTempDir, { recursive: true });
    mkdirSync(stageBunCacheDir, { recursive: true });

    const stageCommandEnv = {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: stageBunCacheDir,
      TMPDIR: stageTempDir,
    };

    run("bun", ["install", "--production"], { cwd: stageAppDir, env: stageCommandEnv });

    const buildEnv = { ...stageCommandEnv };
    for (const [key, value] of Object.entries(buildEnv)) {
      if (value === "") {
        delete buildEnv[key];
      }
    }

    if (!options.signed) {
      buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
      delete buildEnv.CSC_LINK;
      delete buildEnv.CSC_KEY_PASSWORD;
      delete buildEnv.APPLE_API_KEY;
      delete buildEnv.APPLE_API_KEY_ID;
      delete buildEnv.APPLE_API_ISSUER;
    }

    if (options.platform === "darwin") {
      Object.assign(buildEnv, resolveMacBuildEnv());
    }

    const cliFlag =
      options.platform === "darwin"
        ? "--mac"
        : options.platform === "linux"
          ? "--linux"
          : "--win";

    run(
      "bunx",
      [
        "electron-builder",
        cliFlag,
        `--${options.arch}`,
        "--publish",
        options.publish,
      ],
      { cwd: stageAppDir, env: buildEnv },
    );

    const distDir = join(stageAppDir, "dist");
    if (!existsSync(distDir)) {
      fail(`Build completed but dist directory was not found at ${distDir}.`);
    }

    const artifacts = copyArtifacts(distDir, targetDir);
    console.log(`[desktop-artifact] Copied ${artifacts.length} artifact(s) to ${targetDir}`);
    for (const artifactPath of artifacts) {
      const size = statSync(artifactPath).size;
      console.log(`[desktop-artifact] - ${artifactPath.slice(targetDir.length + 1)} (${size} bytes)`);
    }
  } finally {
    rmSync(stageDir, { force: true, recursive: true });
  }
}

main();
