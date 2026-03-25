import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function runStep(label, command, args) {
  console.log(`[release-desktop-mac] ${label}`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep("Installing dependencies", "bun", ["install"]);
runStep("Linting workspace", "bun", ["run", "lint"]);
runStep("Running test suite", "bun", ["run", "test"]);
runStep("Running typecheck", "bun", ["run", "typecheck"]);
runStep("Building macOS desktop artifacts", "bun", ["run", "dist:desktop:mac"]);
