import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectFavicon } from "./favicon";

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const target of cleanupPaths) {
    fs.rmSync(target, { force: true, recursive: true });
  }
  cleanupPaths.clear();
});

function createProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-favicon-"));
  cleanupPaths.add(dir);
  return dir;
}

function writeFile(rootDir: string, relativePath: string, contents: string | Uint8Array) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
}

function createPng(width: number, height: number) {
  const body = Buffer.alloc(24);
  body[0] = 0x89;
  body.write("PNG", 1, "ascii");
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  return body;
}

function createIco(sizes: number[]) {
  const body = Buffer.alloc(6 + sizes.length * 16);
  body.writeUInt16LE(0, 0);
  body.writeUInt16LE(1, 2);
  body.writeUInt16LE(sizes.length, 4);

  for (const [index, size] of sizes.entries()) {
    const offset = 6 + index * 16;
    body[offset] = size === 256 ? 0 : size;
    body[offset + 1] = size === 256 ? 0 : size;
  }

  return body;
}

describe("resolveProjectFavicon", () => {
  it("uses root order as a tie-breaker when candidates have the same quality", async () => {
    const rootDir = createProjectDir();
    writeFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "repo", private: true, workspaces: ["apps/*"] }),
    );
    writeFile(rootDir, "favicon.png", createPng(256, 256));
    writeFile(rootDir, "apps/web/package.json", JSON.stringify({ name: "web" }));
    writeFile(rootDir, "apps/web/app/favicon.png", createPng(256, 256));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body)).toEqual(createPng(256, 256));
    expect(favicon?.contentType).toBe("image/png");
  });

  it("finds the highest-quality workspace favicon for a monorepo root", async () => {
    const rootDir = createProjectDir();
    writeFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "repo", private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    writeFile(rootDir, "apps/marketing/package.json", JSON.stringify({ name: "marketing" }));
    writeFile(rootDir, "apps/marketing/app/favicon.ico", createIco([16, 32]));
    writeFile(rootDir, "packages/core/package.json", JSON.stringify({ name: "core" }));
    writeFile(rootDir, "packages/core/assets/logo.png", createPng(512, 512));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body)).toEqual(createPng(512, 512));
    expect(favicon?.contentType).toBe("image/png");
  });

  it("prefers svg assets over raster icons when available", async () => {
    const rootDir = createProjectDir();
    writeFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "repo", private: true, workspaces: ["packages/*", "apps/*"] }),
    );
    writeFile(rootDir, "apps/marketing/package.json", JSON.stringify({ name: "marketing" }));
    writeFile(rootDir, "apps/marketing/app/favicon.png", createPng(1024, 1024));
    writeFile(rootDir, "packages/core/package.json", JSON.stringify({ name: "core" }));
    writeFile(
      rootDir,
      "packages/core/assets/logo.svg",
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"></svg>',
    );

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body).toString("utf8")).toContain("<svg");
    expect(favicon?.contentType).toBe("image/svg+xml");
  });

  it("considers shared asset package logos in src directories", async () => {
    const rootDir = createProjectDir();
    writeFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "repo", private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    writeFile(rootDir, "apps/marketing/package.json", JSON.stringify({ name: "marketing" }));
    writeFile(rootDir, "apps/marketing/app/favicon.ico", createIco([16, 32]));
    writeFile(rootDir, "packages/assets/package.json", JSON.stringify({ name: "assets" }));
    writeFile(rootDir, "packages/assets/src/logo.png", createPng(1080, 1080));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body)).toEqual(createPng(1080, 1080));
    expect(favicon?.contentType).toBe("image/png");
  });

  it("falls back to nested web app public directories", async () => {
    const rootDir = createProjectDir();
    writeFile(rootDir, "package.json", JSON.stringify({ name: "repo", private: true }));
    writeFile(rootDir, "src/logo.png", createPng(32, 32));
    writeFile(rootDir, "ui/public/favicon.svg", '<svg viewBox="0 0 64 64"></svg>');
    writeFile(rootDir, "docs/assets/logo.png", createPng(1200, 630));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body).toString("utf8")).toContain("<svg");
    expect(favicon?.contentType).toBe("image/svg+xml");
  });

  it("falls back to likely logo files before generic app assets", async () => {
    const rootDir = createProjectDir();
    writeFile(rootDir, "resources/branding/app_icon/file.png", createPng(512, 512));
    writeFile(rootDir, "resources/branding/product_logo.svg", '<svg viewBox="0 0 32 32"></svg>');
    writeFile(rootDir, "resources/favicons/favicon_flags_48.png", createPng(48, 48));
    writeFile(rootDir, "docs/assets/hero.png", createPng(1600, 900));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body).toString("utf8")).toContain("<svg");
    expect(favicon?.contentType).toBe("image/svg+xml");
  });

  it("prefers square logo marks over wide wordmarks for fallback logos", async () => {
    const rootDir = createProjectDir();
    writeFile(rootDir, "resources/branding/product_logo_200.png", createPng(280, 64));
    writeFile(rootDir, "resources/branding/product_logo_22_mono.png", createPng(22, 22));

    const favicon = await resolveProjectFavicon(rootDir);

    expect(favicon).not.toBeNull();
    expect(Buffer.from(favicon!.body)).toEqual(createPng(22, 22));
    expect(favicon?.contentType).toBe("image/png");
  });
});
