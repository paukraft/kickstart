import { spawn, spawnSync } from "node:child_process";
import { access, watch } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { loadDesktopEnv } from "./load-desktop-env.mjs";

loadDesktopEnv();

const rendererPort = Number(process.env.ELECTRON_RENDERER_PORT ?? 5173);
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const mainOutputPath = join(desktopDir, "dist-electron", "main.js");
const preloadOutputPath = join(desktopDir, "dist-electron", "preload.js");
const watchedOutputs = new Set(["main.js", "preload.js"]);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let shuttingDown = false;
let electronProcess = null;
let restartTimer = null;
let restartQueue = Promise.resolve();

function killChildTree(pid, signal) {
  if (process.platform === "win32" || typeof pid !== "number") {
    return;
  }
  spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function spawnScript(command) {
  return spawn("bun", ["run", command], {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });
}

const devProcesses = [
  spawnScript("dev:main"),
  spawnScript("dev:preload"),
  spawnScript("dev:renderer"),
];

for (const child of devProcesses) {
  child.once("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[desktop] child process exited unexpectedly with code ${code ?? "unknown"}`);
    void shutdown(code ?? 1);
  });
}

async function waitForFile(filePath) {
  for (;;) {
    try {
      await access(filePath, fsConstants.F_OK);
      return;
    } catch {
      await delay(150);
    }
  }
}

async function waitForRenderer() {
  for (;;) {
    try {
      const response = await fetch(rendererUrl, { method: "HEAD" });
      if (response.ok) {
        return;
      }
    } catch {
      // dev server still booting
    }
    await delay(150);
  }
}

function startElectron() {
  if (shuttingDown || electronProcess !== null) {
    return;
  }
  electronProcess = spawn(resolveElectronPath(), [join("dist-electron", "main.js")], {
    cwd: desktopDir,
    env: {
      ...childEnv,
      VITE_DEV_SERVER_URL: rendererUrl,
    },
    stdio: "inherit",
  });
  electronProcess.once("exit", () => {
    electronProcess = null;
  });
}

async function stopElectron() {
  if (!electronProcess) {
    return;
  }
  const child = electronProcess;
  electronProcess = null;
  await new Promise((resolve) => {
    let finished = false;
    const settle = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    child.once("exit", settle);
    child.kill("SIGTERM");
    killChildTree(child.pid, "TERM");
    setTimeout(() => {
      if (finished) return;
      child.kill("SIGKILL");
      killChildTree(child.pid, "KILL");
      settle();
    }, 1500).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopElectron();
        if (!shuttingDown) {
          startElectron();
        }
      });
  }, 120);
}

async function watchOutputs() {
  const watcher = watch(join(desktopDir, "dist-electron"));
  for await (const event of watcher) {
    if (typeof event.filename !== "string") {
      continue;
    }
    if (watchedOutputs.has(event.filename)) {
      scheduleRestart();
    }
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  await stopElectron();
  for (const child of devProcesses) {
    child.kill("SIGTERM");
    killChildTree(child.pid, "TERM");
  }
  await delay(250);
  for (const child of devProcesses) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      killChildTree(child.pid, "KILL");
    }
  }
  process.exit(exitCode);
}

await Promise.all([
  waitForFile(mainOutputPath),
  waitForFile(preloadOutputPath),
  waitForRenderer(),
]);

watchOutputs().catch((error) => {
  console.error("[desktop] file watcher failed", error);
  void shutdown(1);
});

startElectron();

process.once("SIGINT", () => {
  void shutdown(130);
});

process.once("SIGTERM", () => {
  void shutdown(143);
});
