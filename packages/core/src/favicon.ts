import fs from "node:fs/promises";
import path from "node:path";

const FAVICON_MIME_TYPES: Record<string, string> = {
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "favicon.jpg",
  "apple-touch-icon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/favicon.jpg",
  "public/apple-touch-icon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/favicon.svg",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "app/apple-touch-icon.png",
  "src/favicon.png",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/icon.svg",
  "src/icon.png",
  "src/icon.ico",
  "src/logo.svg",
  "src/logo.png",
  "src/logo.ico",
  "src/logo.jpg",
  "src/app/favicon.png",
  "src/app/favicon.ico",
  "src/app/favicon.svg",
  "src/app/icon.svg",
  "src/app/icon.png",
  "src/app/icon.ico",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/icon.ico",
  "assets/logo.svg",
  "assets/logo.png",
  "assets/logo.ico",
  "src/assets/icon.svg",
  "src/assets/icon.png",
  "src/assets/icon.ico",
  "src/assets/logo.svg",
  "src/assets/logo.png",
  "src/assets/logo.ico",
];
const KNOWN_FAVICON_CANDIDATE_PATHS = new Set(FAVICON_CANDIDATES.map((candidate) => candidate.toLowerCase()));

const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/root.tsx",
  "app/routes/__root.tsx",
  "src/root.tsx",
  "src/routes/__root.tsx",
  "src/index.html",
];

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;

type PackageJsonWithWorkspaces = {
  workspaces?: string[] | { packages?: string[] };
};

type ResolvedFavicon = {
  body: Uint8Array | string;
  contentType: string;
};

type FaviconCandidate = ResolvedFavicon & {
  candidateIndex: number;
  dimensions: { width: number; height: number } | null;
  relevanceScore: number;
  rootIndex: number;
};

const FALLBACK_ICON_EXTENSIONS = new Set([".png", ".svg", ".ico", ".jpg"]);
const FALLBACK_SCAN_MAX_DEPTH = 5;
const FALLBACK_SCAN_MAX_CANDIDATES = 80;
const EXCLUDED_SCAN_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
  "target",
]);
const POSITIVE_PATH_SEGMENTS = new Map<string, number>([
  ["app", 90],
  ["app_icon", 260],
  ["appicon", 260],
  ["assets", 40],
  ["branding", 120],
  ["brand", 80],
  ["icons", 110],
  ["images", 20],
  ["img", 20],
  ["public", 120],
  ["resources", 40],
  ["src", 20],
  ["static", 80],
  ["ui", 60],
  ["web", 70],
]);
const NEGATIVE_PATH_SEGMENTS = new Map<string, number>([
  ["__fixtures__", -200],
  ["__tests__", -200],
  ["cypress", -160],
  ["demo", -90],
  ["docs", -260],
  ["e2e", -160],
  ["example", -100],
  ["examples", -100],
  ["fixtures", -200],
  ["favicons", -220],
  ["patches", -260],
  ["playwright", -160],
  ["screenshot", -180],
  ["screenshots", -180],
  ["stories", -140],
  ["storybook", -160],
  ["test", -180],
  ["tests", -180],
]);

function isPathWithinProject(projectPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(projectPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function tryReadFile(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

function readPngDimensions(body: Buffer) {
  if (body.length < 24 || body.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: body.readUInt32BE(16),
    height: body.readUInt32BE(20),
  };
}

function readJpegDimensions(body: Buffer) {
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = body[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > body.length) break;

    const segmentLength = body.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > body.length) break;

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 7 > body.length) break;
      return {
        height: body.readUInt16BE(offset + 3),
        width: body.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readIcoDimensions(body: Buffer) {
  if (body.length < 6 || body.readUInt16LE(0) !== 0 || body.readUInt16LE(2) !== 1) return null;
  const imageCount = body.readUInt16LE(4);
  if (imageCount < 1 || body.length < 6 + imageCount * 16) return null;

  let maxWidth = 0;
  let maxHeight = 0;
  for (let index = 0; index < imageCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = body[entryOffset] || 256;
    const height = body[entryOffset + 1] || 256;
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
  }

  if (maxWidth === 0 || maxHeight === 0) return null;
  return { width: maxWidth, height: maxHeight };
}

function readSvgDimensions(body: Buffer) {
  const source = body.toString("utf8");
  const widthMatch = source.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i);
  const heightMatch = source.match(/\bheight=["']([0-9.]+)(?:px)?["']/i);
  if (widthMatch?.[1] && heightMatch?.[1]) {
    return {
      width: Number.parseFloat(widthMatch[1]),
      height: Number.parseFloat(heightMatch[1]),
    };
  }

  const viewBoxMatch = source.match(/\bviewBox=["'][^"']*\s([0-9.]+)\s([0-9.]+)["']/i);
  if (viewBoxMatch?.[1] && viewBoxMatch?.[2]) {
    return {
      width: Number.parseFloat(viewBoxMatch[1]),
      height: Number.parseFloat(viewBoxMatch[2]),
    };
  }

  return { width: 4096, height: 4096 };
}

function getFaviconDimensions(filePath: string, body: Buffer) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return readPngDimensions(body);
    case ".jpg":
      return readJpegDimensions(body);
    case ".ico":
      return readIcoDimensions(body);
    case ".svg":
      return readSvgDimensions(body);
    default:
      return null;
  }
}

async function readResolvedFavicon(projectPath: string, filePath: string) {
  if (!isPathWithinProject(projectPath, filePath)) return null;
  const body = await tryReadFile(filePath);
  if (!body) return null;
  return {
    body,
    contentType:
      FAVICON_MIME_TYPES[path.extname(filePath).toLowerCase()] ??
      "application/octet-stream",
    dimensions: getFaviconDimensions(filePath, body),
  };
}

async function resolveFaviconsFromDirectory(
  projectPath: string,
  rootIndex: number,
  blockedPaths: ReadonlySet<string> = new Set(),
) {
  const resolvedCandidates: FaviconCandidate[] = [];

  for (const [candidateIndex, candidate] of FAVICON_CANDIDATES.entries()) {
    const resolved = await readResolvedFavicon(projectPath, path.join(projectPath, candidate));
    if (resolved) {
      resolvedCandidates.push({
        ...resolved,
        candidateIndex,
        rootIndex,
        relevanceScore: 10_000,
      });
    }
  }

  let candidateIndex = FAVICON_CANDIDATES.length;
  for (const sourceFile of ICON_SOURCE_FILES) {
    try {
      const content = await fs.readFile(path.join(projectPath, sourceFile), "utf8");
      const match = content.match(LINK_ICON_HTML_RE);
      const href = match?.[1];
      if (!href || /^(?:https?:|data:)/i.test(href)) {
        continue;
      }
      const cleanHref = href.replace(/^\//, "");
      for (const candidate of [
        path.join(projectPath, "public", cleanHref),
        path.join(projectPath, cleanHref),
      ]) {
        const resolved = await readResolvedFavicon(projectPath, candidate);
        if (resolved) {
          resolvedCandidates.push({
            ...resolved,
            candidateIndex,
            rootIndex,
            relevanceScore: 9_000,
          });
        }
        candidateIndex += 1;
      }
    } catch {
      continue;
    }
  }

  const fallbackCandidates = await resolveFallbackFaviconsFromDirectory(
    projectPath,
    rootIndex,
    blockedPaths,
  );
  resolvedCandidates.push(...fallbackCandidates);

  return resolvedCandidates;
}

function getFallbackNameScore(name: string): number {
  let score = 0;
  const normalized = name.toLowerCase();
  const stem = normalized.replace(/\.[^.]+$/, "");

  if (stem === "favicon") score += 900;
  if (stem === "apple-touch-icon") score += 840;
  if (stem === "appicon" || stem === "app_icon") score += 760;
  if (stem === "icon") score += 680;
  if (stem === "logo") score += 560;
  if (stem.includes("favicon")) score += 600;
  if (stem.includes("appicon") || stem.includes("app_icon")) score += 520;
  if (stem.includes("apple-touch-icon")) score += 500;
  if (stem.includes("icon")) score += 320;
  if (stem.includes("logo")) score += 520;
  if (stem.includes("brand")) score += 160;
  if (stem.includes("product")) score += 120;

  if (/(^|[-_])(maskable|touch|launcher|android-chrome)([-_]|$)/.test(stem)) score += 140;
  if (/^favicon[-_]/.test(stem)) score -= 260;
  if (
    /(^|[-_])(bookmarks|conflicts|downloads|flags|help|history|management|newtab|ntp|plugins|settings)([-_]|$)/.test(
      stem,
    )
  ) {
    score -= 420;
  }
  if (/(^|[-_])(raw|white|dark|light|text|wordmark|banner|hero|background)([-_]|$)/.test(stem)) {
    score -= 180;
  }
  if (/\d{3,4}$/.test(stem)) score += 20;
  if (/\b(16|24|32|48|64|128|256|512|1024)\b/.test(stem.replaceAll("-", " "))) score += 30;

  return score;
}

function isLikelyLogoFileName(name: string): boolean {
  const stem = name.toLowerCase().replace(/\.[^.]+$/, "");

  if (
    /(^|[-_])(favicon|icon|logo|logomark|wordmark|brand|branding|mark|appicon|app_icon|apple-touch-icon)([-_]|$)/.test(
      stem,
    )
  ) {
    return true;
  }

  return false;
}

function getFallbackBaseScore(name: string): number {
  const stem = name.toLowerCase().replace(/\.[^.]+$/, "");

  if (stem === "favicon" || stem === "apple-touch-icon") {
    return 10_500;
  }

  return 0;
}

function getFallbackPathScore(projectPath: string, filePath: string): number {
  const relativePath = path.relative(projectPath, filePath).replaceAll("\\", "/").toLowerCase();
  const segments = relativePath.split("/").filter(Boolean);
  let score = 0;

  for (const segment of segments.slice(0, -1)) {
    score += POSITIVE_PATH_SEGMENTS.get(segment) ?? 0;
    score += NEGATIVE_PATH_SEGMENTS.get(segment) ?? 0;
  }

  if (relativePath.startsWith("public/")) score += 220;
  if (relativePath.startsWith("app/")) score += 160;
  if (relativePath.startsWith("src/app/")) score += 150;
  if (relativePath.startsWith("src/assets/")) score += 120;
  if (relativePath.startsWith("assets/")) score += 100;
  if (relativePath.startsWith("ui/public/")) score += 220;
  if (relativePath.startsWith("resources/branding/")) score += 240;
  if (relativePath.includes("/appicon/")) score += 360;
  if (relativePath.includes("/app_icon/")) score += 360;
  if (relativePath.includes("/favicon")) score += 130;
  if (relativePath.includes("/logo")) score -= 40;
  if (relativePath.includes("/favicons/")) score -= 260;

  if (/(^|\/)(docs|examples?|tests?|__tests__|__fixtures__|fixtures|patches)\//.test(relativePath)) {
    score -= 260;
  }
  if (/(screenshot|banner|hero|background|wordmark)/.test(relativePath)) {
    score -= 200;
  }

  return score;
}

async function collectFallbackIconPaths(
  projectPath: string,
  currentPath: string,
  depth: number,
  collected: string[],
  blockedPaths: ReadonlySet<string>,
): Promise<void> {
  if (depth > FALLBACK_SCAN_MAX_DEPTH || collected.length >= FALLBACK_SCAN_MAX_CANDIDATES) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sortedEntries) {
    if (collected.length >= FALLBACK_SCAN_MAX_CANDIDATES) {
      return;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (!isPathWithinProject(projectPath, entryPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (EXCLUDED_SCAN_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      if (blockedPaths.has(path.resolve(entryPath)) && path.resolve(entryPath) !== path.resolve(projectPath)) {
        continue;
      }
      await collectFallbackIconPaths(projectPath, entryPath, depth + 1, collected, blockedPaths);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!isLikelyLogoFileName(entry.name)) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!FALLBACK_ICON_EXTENSIONS.has(extension)) continue;
    collected.push(entryPath);
  }
}

async function resolveFallbackFaviconsFromDirectory(
  projectPath: string,
  rootIndex: number,
  blockedPaths: ReadonlySet<string> = new Set(),
) {
  const fallbackPaths: string[] = [];
  await collectFallbackIconPaths(projectPath, projectPath, 0, fallbackPaths, blockedPaths);

  const resolvedCandidates: FaviconCandidate[] = [];
  for (const [candidateIndex, filePath] of fallbackPaths.entries()) {
    if (!isLikelyLogoFileName(path.basename(filePath))) continue;
    const relativePath = path.relative(projectPath, filePath).replaceAll("\\", "/").toLowerCase();
    if (KNOWN_FAVICON_CANDIDATE_PATHS.has(relativePath)) continue;

    const resolved = await readResolvedFavicon(projectPath, filePath);
    if (!resolved) continue;

    const relevanceScore =
      getFallbackBaseScore(path.basename(filePath)) +
      getFallbackNameScore(path.basename(filePath)) +
      getFallbackPathScore(projectPath, filePath) +
      getShapeScore(resolved.dimensions) * 2;
    if (relevanceScore <= 0) continue;

    resolvedCandidates.push({
      ...resolved,
      candidateIndex,
      rootIndex,
      relevanceScore,
    });
  }

  return resolvedCandidates;
}

function getShapeScore(dimensions: { width: number; height: number } | null) {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return 0;
  const shorterSide = Math.min(dimensions.width, dimensions.height);
  const longerSide = Math.max(dimensions.width, dimensions.height);
  return Math.round((shorterSide / longerSide) * 1000);
}

function normalizeWorkspacePatterns(packageJson: PackageJsonWithWorkspaces): string[] {
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }
  if (Array.isArray(packageJson.workspaces?.packages)) {
    return packageJson.workspaces.packages;
  }
  return [];
}

function createSegmentMatcher(segment: string): RegExp {
  const escaped = segment.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function expandWorkspacePattern(projectPath: string, pattern: string): Promise<string[]> {
  const normalized = pattern.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("!")) {
    return [];
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [];
  }

  let currentPaths = [projectPath];
  for (const segment of segments) {
    const matcher = createSegmentMatcher(segment);
    const nextPaths: string[] = [];
    for (const currentPath of currentPaths) {
      let entries;
      try {
        entries = await fs.readdir(currentPath, { encoding: "utf8", withFileTypes: true });
      } catch {
        continue;
      }

      const matchingEntries = entries
        .filter((entry) => entry.isDirectory() && matcher.test(entry.name))
        .map((entry) => path.join(currentPath, entry.name))
        .sort((left, right) => left.localeCompare(right));
      nextPaths.push(...matchingEntries);
    }
    currentPaths = nextPaths;
    if (currentPaths.length === 0) {
      return [];
    }
  }

  const workspaceRoots: string[] = [];
  for (const currentPath of currentPaths) {
    if (
      isPathWithinProject(projectPath, currentPath) &&
      (await pathExists(path.join(currentPath, "package.json")))
    ) {
      workspaceRoots.push(currentPath);
    }
  }
  return workspaceRoots;
}

async function listWorkspaceRoots(projectPath: string): Promise<string[]> {
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectPath, "package.json"), "utf8"),
    ) as PackageJsonWithWorkspaces;
    const patterns = normalizeWorkspacePatterns(packageJson);
    const seenPaths = new Set<string>();
    const workspaceRoots: string[] = [];

    for (const pattern of patterns) {
      for (const workspaceRoot of await expandWorkspacePattern(projectPath, pattern)) {
        if (!seenPaths.has(workspaceRoot)) {
          seenPaths.add(workspaceRoot);
          workspaceRoots.push(workspaceRoot);
        }
      }
    }

    return workspaceRoots;
  } catch {
    return [];
  }
}

function getFormatScore(contentType: string) {
  switch (contentType) {
    case "image/svg+xml":
      return 4;
    case "image/png":
      return 3;
    case "image/x-icon":
      return 2;
    case "image/jpeg":
      return 1;
    default:
      return 0;
  }
}

function getDimensionScore(dimensions: { width: number; height: number } | null) {
  if (!dimensions) return 0;
  return dimensions.width * dimensions.height;
}

function compareCandidates(left: FaviconCandidate, right: FaviconCandidate) {
  const relevanceScoreDelta = right.relevanceScore - left.relevanceScore;
  if (relevanceScoreDelta !== 0) return relevanceScoreDelta;

  const shapeScoreDelta = getShapeScore(right.dimensions) - getShapeScore(left.dimensions);
  if (shapeScoreDelta !== 0) return shapeScoreDelta;

  const formatScoreDelta = getFormatScore(right.contentType) - getFormatScore(left.contentType);
  if (formatScoreDelta !== 0) return formatScoreDelta;

  const dimensionScoreDelta = getDimensionScore(right.dimensions) - getDimensionScore(left.dimensions);
  if (dimensionScoreDelta !== 0) return dimensionScoreDelta;

  const rootIndexDelta = left.rootIndex - right.rootIndex;
  if (rootIndexDelta !== 0) return rootIndexDelta;

  return left.candidateIndex - right.candidateIndex;
}

export async function resolveProjectFavicon(projectPath: string): Promise<ResolvedFavicon | null> {
  const workspaceRoots = await listWorkspaceRoots(projectPath);
  const blockedWorkspaceRoots = new Set(workspaceRoots.map((root) => path.resolve(root)));
  const candidates = (
    await Promise.all(
      [projectPath, ...workspaceRoots].map((root, rootIndex) =>
        resolveFaviconsFromDirectory(root, rootIndex, rootIndex === 0 ? blockedWorkspaceRoots : new Set()),
      ),
    )
  ).flat();

  if (candidates.length === 0) return null;
  candidates.sort(compareCandidates);
  const bestCandidate = candidates[0];
  return {
    body: bestCandidate.body,
    contentType: bestCandidate.contentType,
  };
}
