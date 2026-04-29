import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path, { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { _electron as electron } from "playwright";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { loadDesktopEnv } from "./load-desktop-env.mjs";

loadDesktopEnv();

const keepArtifacts = process.argv.includes("--keep");
const rootDir = mkdtempSync(join(os.tmpdir(), "kickstart-terminal-debug-"));
const userDataDir = join(rootDir, "user-data");
const projectDir = join(rootDir, "project");
const nestedDir = join(projectDir, "debug-cwd");
const marker = `KICKSTART_HISTORY_${Date.now()}`;

mkdirSync(nestedDir, { recursive: true });
writeFileSync(join(projectDir, "package.json"), `${JSON.stringify({ name: "kickstart-debug-project" }, null, 2)}\n`);
writeFileSync(join(nestedDir, "marker.txt"), `${marker}\n`);
const expectedNestedDir = realpathSync(nestedDir);

function runStep(label, command, args) {
  console.log(`[debug-terminal] ${label}`);
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function countOccurrences(value, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    index = value.indexOf(needle, index);
    if (index === -1) {
      return count;
    }
    count += 1;
    index += needle.length;
  }
}

function buildDesktop() {
  runStep("building main process", "bun", ["run", "build:main"]);
  runStep("building preload", "bun", ["run", "build:preload"]);
  runStep("building renderer", "bun", ["run", "build:renderer"]);
}

async function launchApp() {
  const app = await electron.launch({
    executablePath: resolveElectronPath(),
    args: [join(desktopDir, "dist-electron", "main.js"), `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      KICKSTART_DEBUG_AUTOMATION: "1",
      KICKSTART_DISABLE_AUTO_UPDATE: "1",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(globalThis.window?.desktop?.debugGetSnapshot));
  return { app, page };
}

async function closeApp(app) {
  const childProcess = app.process();
  const waitForChildExit = async (timeoutMs) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return "exited";
    }
    return Promise.race([
      new Promise((resolve) => {
        childProcess.once("exit", () => resolve("exited"));
      }),
      delay(timeoutMs).then(() => "timed-out"),
    ]);
  };
  const closePromise = app.close().catch(() => undefined);
  const closeResult = await Promise.race([
    closePromise.then(() => "closed"),
    delay(5_000).then(() => "timed-out"),
  ]);
  if (closeResult === "timed-out" && childProcess.exitCode === null && childProcess.signalCode === null) {
    childProcess.kill("SIGTERM");
    await waitForChildExit(1_000);
  }
  if (childProcess.exitCode === null && childProcess.signalCode === null) {
    childProcess.kill("SIGKILL");
    await waitForChildExit(1_000);
  }
  await delay(250);
}

async function waitForDebugProject(page, projectId, predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await page.evaluate((id) => window.desktop.debugGetProject(id), projectId);
    if (await predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`);
}

async function focusTerminal(page) {
  await page.waitForSelector(".terminal-host .xterm-helper-textarea", { timeout: 10_000 });
  await page.locator(".terminal-host").click();
}

async function typeCommand(page, command) {
  await focusTerminal(page);
  await page.keyboard.type(command, { delay: 2 });
  await page.keyboard.press("Enter");
}

async function terminalText(page) {
  return page.locator(".terminal-host .xterm-rows").evaluate((node) => node.textContent ?? "");
}

async function terminalSerializedText(page) {
  return page.evaluate(() => window.__kickstartTerminalDebug?.serialize() ?? "");
}

async function waitForRendererTerminalHistory(page, value, label) {
  await page.waitForFunction(
    (expected) => (window.__kickstartTerminalDebug?.serialize() ?? "").includes(expected),
    value,
    { timeout: 10_000 },
  ).catch(async (error) => {
    const visibleText = await terminalText(page).catch(() => "");
    const serializedText = await terminalSerializedText(page).catch(() => "");
    throw new Error(
      `${label} timed out. Visible rows: ${JSON.stringify(visibleText.slice(-500))}. Serialized tail: ${JSON.stringify(serializedText.slice(-1000))}`,
      { cause: error },
    );
  });
}

async function run() {
  buildDesktop();

  let launched = await launchApp();
  try {
    const created = await launched.page.evaluate(
      (input) => window.desktop.debugCreateProject(input),
      {
        path: projectDir,
        select: true,
        shellTab: true,
      },
    );
    const projectId = created.project.id;

    await launched.page.reload({ waitUntil: "domcontentloaded" });
    await launched.page.waitForFunction(() => Boolean(globalThis.window?.desktop?.debugGetProject));
    await waitForDebugProject(
      launched.page,
      projectId,
      (snapshot) => Boolean(snapshot.activeTabId && snapshot.tabs.some((tab) => tab.id === snapshot.activeTabId)),
      "active shell tab",
    );

    await focusTerminal(launched.page);
    await typeCommand(launched.page, "cd debug-cwd");
    await waitForDebugProject(
      launched.page,
      projectId,
      (snapshot) => snapshot.tabs.some((tab) => tab.kind === "shell" && tab.shellCwd === expectedNestedDir),
      "cwd persistence",
    );

    await typeCommand(launched.page, `printf '${marker}\\n'`);
    await waitForDebugProject(
      launched.page,
      projectId,
      (snapshot) => snapshot.sessions.some((session) => session.history.includes(marker)),
      "main-process terminal history",
    );
    await waitForRendererTerminalHistory(launched.page, marker, "renderer terminal history");

    await delay(500);
    await closeApp(launched.app);

    launched = await launchApp();
    await launched.page.waitForFunction(
      async (id) => {
        const snapshot = await window.desktop.debugGetProject(id);
        return snapshot.activeTabId && snapshot.sessions.some((session) => session.history.includes("KICKSTART_HISTORY_"));
      },
      projectId,
    );
    await focusTerminal(launched.page);
    await waitForDebugProject(
      launched.page,
      projectId,
      (snapshot) =>
        snapshot.sessions.some((session) => session.history.includes(marker)) &&
        snapshot.tabs.some((tab) => tab.kind === "shell" && tab.shellCwd === expectedNestedDir),
      "restored debug snapshot",
    );
    await waitForRendererTerminalHistory(launched.page, marker, "restored renderer terminal history");

    const restoredText = await terminalSerializedText(launched.page);
    if (!restoredText.includes(marker)) {
      throw new Error(`Restored terminal buffer did not contain ${marker}`);
    }

    const beforeArrowSnapshot = await launched.page.evaluate((id) => window.desktop.debugGetProject(id), projectId);
    const beforeArrowHistory =
      beforeArrowSnapshot.sessions.find((session) => session.tabId === beforeArrowSnapshot.activeTabId)?.history ?? "";
    const beforeArrowCount = countOccurrences(beforeArrowHistory, marker);
    await focusTerminal(launched.page);
    await launched.page.keyboard.press("ArrowUp");
    await launched.page.keyboard.press("Enter");
    await waitForDebugProject(
      launched.page,
      projectId,
      (snapshot) => {
        const activeHistory =
          snapshot.sessions.find((session) => session.tabId === snapshot.activeTabId)?.history ?? "";
        return countOccurrences(activeHistory, marker) > beforeArrowCount;
      },
      "restored shell arrow history",
    );

    await closeApp(launched.app);
  } catch (error) {
    await closeApp(launched.app).catch(() => undefined);
    throw error;
  }
  console.log("[debug-terminal] ok");
  console.log(`[debug-terminal] marker: ${marker}`);
  console.log(`[debug-terminal] userData: ${userDataDir}`);
}

run()
  .catch((error) => {
    console.error("[debug-terminal] failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!keepArtifacts) {
      rmSync(rootDir, { force: true, recursive: true });
    } else {
      console.log(`[debug-terminal] kept artifacts: ${rootDir}`);
    }
  });
