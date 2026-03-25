import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("[desktop] skipping native rebuild outside macOS");
  process.exit(0);
}

const result = spawnSync("bun", ["run", "rebuild:native:mac"], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
