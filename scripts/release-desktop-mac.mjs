import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultEnv = { ...process.env };

function resolveGitHubToken() {
  const explicitToken = defaultEnv.GH_TOKEN || defaultEnv.GITHUB_TOKEN;
  if (explicitToken) {
    return explicitToken;
  }

  const result = spawnSync("gh", ["auth", "token"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error("[release-desktop-mac] GitHub CLI auth token lookup failed.");
    console.error("[release-desktop-mac] Run `gh auth login` or export GH_TOKEN first.");
    process.exit(result.status ?? 1);
  }

  const token = result.stdout.trim();
  if (!token) {
    console.error("[release-desktop-mac] GitHub CLI returned an empty auth token.");
    console.error("[release-desktop-mac] Run `gh auth login` or export GH_TOKEN first.");
    process.exit(1);
  }

  return token;
}

function runStep(label, command, args) {
  console.log(`[release-desktop-mac] ${label}`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: defaultEnv,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

defaultEnv.GH_TOKEN ||= resolveGitHubToken();

runStep("Installing dependencies", "bun", ["install"]);
runStep("Linting workspace", "bun", ["run", "lint"]);
runStep("Running test suite", "bun", ["run", "test"]);
runStep("Running typecheck", "bun", ["run", "typecheck"]);
runStep("Publishing macOS desktop artifacts", "node", [
  "scripts/build-desktop-artifact.mjs",
  "--platform",
  "darwin",
  "--publish",
  "always",
]);
