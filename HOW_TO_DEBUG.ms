# How To Debug Kickstart Desktop

This file explains how to launch Kickstart in an isolated debug profile, control the app from an automation script, and read internal app state while debugging.

## Profiles

Kickstart has separate state directories so installed and dev builds do not overwrite each other.

- Installed app: `~/Library/Application Support/Kickstart`
- Dev app: `~/Library/Application Support/Kickstart Dev`
- Automation run: pass `--user-data-dir=/tmp/some-debug-profile`

Force the profile when needed:

```sh
KICKSTART_DESKTOP_PROFILE=dev bun run dev
KICKSTART_DESKTOP_PROFILE=stable bun run dev
```

For automated debugging, prefer a temporary `--user-data-dir`. That gives every run its own database, terminal history, shell history, and shell integration files.

## Enable Debug IPC

Debug IPC is disabled by default. Enable it only for local debugging:

```sh
KICKSTART_DEBUG_AUTOMATION=1
KICKSTART_DISABLE_AUTO_UPDATE=1
```

When enabled, the renderer exposes extra methods under `window.desktop.*`.

## Launch From Playwright

Use Playwright Electron when you need to click, type, reload, quit, relaunch, and inspect state.

```js
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

import { desktopDir, resolveElectronPath } from "./apps/desktop/scripts/electron-launcher.mjs";

const userDataDir = mkdtempSync(path.join(os.tmpdir(), "kickstart-debug-"));

const app = await electron.launch({
  executablePath: resolveElectronPath(),
  args: [
    path.join(desktopDir, "dist-electron", "main.js"),
    `--user-data-dir=${userDataDir}`,
  ],
  cwd: desktopDir,
  env: {
    ...process.env,
    KICKSTART_DEBUG_AUTOMATION: "1",
    KICKSTART_DISABLE_AUTO_UPDATE: "1",
  },
});

const page = await app.firstWindow();
await page.waitForFunction(() => Boolean(window.desktop?.debugGetSnapshot));
```

Build first if you launch `dist-electron/main.js` directly:

```sh
cd apps/desktop
bun run build:main
bun run build:preload
bun run build:renderer
```

## Read Internal State

Read global app state:

```js
const snapshot = await page.evaluate(() => window.desktop.debugGetSnapshot());
console.log(snapshot.userDataPath);
console.log(snapshot.selectedProjectId);
console.table(snapshot.projects.map((project) => ({
  id: project.id,
  name: project.name,
  runtimeState: project.runtimeState,
})));
```

Create/select a project and inspect its tabs/sessions:

```js
const created = await page.evaluate(
  (input) => window.desktop.debugCreateProject(input),
  {
    path: "/tmp/my-debug-project",
    select: true,
    shellTab: true,
  },
);

const projectId = created.project.id;
const projectState = await page.evaluate(
  (id) => window.desktop.debugGetProject(id),
  projectId,
);

console.log(projectState.activeTabId);
console.table(projectState.tabs);
console.table(projectState.sessions.map((session) => ({
  tabId: session.tabId,
  cwd: session.cwd,
  status: session.status,
  operation: session.operation,
  hasActiveProcess: session.hasActiveProcess,
  activeProcessCount: session.activeProcessCount,
  lastCommand: session.lastCommand,
  pid: session.pid,
})));
```

For terminal bugs, the most useful session fields are:

- `history`: main-process persisted terminal transcript
- `cwd`: PTY launch cwd
- `lastCommand`: last command seen through input tracking or shell integration
- `status`: `booting`, `idle`, `running`, or `stopped`
- `operation`: lifecycle transition such as `starting` or `stopping`
- `hasActiveProcess` and `activeProcessCount`: running child-process state

## Inspect Renderer Terminal State

The active terminal view exposes a renderer-only probe:

```js
const serialized = await page.evaluate(
  () => window.__kickstartTerminalDebug?.serialize() ?? "",
);

const visibleRows = await page.evaluate(
  () => window.__kickstartTerminalDebug?.rowsText() ?? "",
);

await page.evaluate(() => window.__kickstartTerminalDebug?.scrollToTop());
await page.evaluate(() => window.__kickstartTerminalDebug?.scrollToBottom());
```

Use `serialize()` to inspect xterm's real buffer. Use `rowsText()` only for what is currently mounted in the visible viewport.

## Control The UI

Click regular UI:

```js
await page.getByRole("button", { name: /new shell/i }).click();
await page.getByRole("button", { name: /run/i }).click();
await page.getByText("My Project").click();
```

Control the terminal:

```js
await page.waitForSelector(".terminal-host .xterm-helper-textarea");
await page.locator(".terminal-host").click();
await page.keyboard.type("pwd");
await page.keyboard.press("Enter");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Enter");
```

Wait for internal state instead of sleeping:

```js
async function waitForProject(page, projectId, predicate, label) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((id) => window.desktop.debugGetProject(id), projectId);
    if (await predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last, null, 2)}`);
}

await waitForProject(
  page,
  projectId,
  (state) => state.sessions.some((session) => session.history.includes("expected text")),
  "terminal output",
);
```

## Relaunch With The Same State

To test persistence, close the app and launch again with the same `userDataDir`.

```js
await app.close();

const relaunched = await electron.launch({
  executablePath: resolveElectronPath(),
  args: [
    path.join(desktopDir, "dist-electron", "main.js"),
    `--user-data-dir=${userDataDir}`,
  ],
  cwd: desktopDir,
  env: {
    ...process.env,
    KICKSTART_DEBUG_AUTOMATION: "1",
    KICKSTART_DISABLE_AUTO_UPDATE: "1",
  },
});
```

If the app does not exit because a PTY is still alive, terminate only the Electron child process from your script. Do not kill the installed Kickstart app.

## Existing Example

`apps/desktop/scripts/debug-terminal-persistence.mjs` is an example of this pattern. It builds the app, launches an isolated profile, creates a project, types into a real terminal, reads debug IPC snapshots, relaunches, and verifies persistence.

Run it from `apps/desktop`:

```sh
bun run debug:terminal
bun run debug:terminal -- --keep
```

Use `--keep` when you want to inspect the temporary `userData` directory after a failed run.

## Useful Files

- `apps/desktop/scripts/debug-terminal-persistence.mjs`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- `apps/desktop/src/components/app/terminal-view.tsx`
- `apps/desktop/src/lib/terminal-manager.ts`
