import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const assetsDir = join(desktopDir, "src", "assets");
const sharedAssetsDir = resolve(desktopDir, "../../packages/assets/src");
const resourcesDir = join(desktopDir, "resources");
const macSourceIconPath = join(assetsDir, "logo_mac.png");
const defaultSourceIconPath = join(sharedAssetsDir, "logo.png");
const macCanvasSize = 1024;
const macVisibleSize = 832;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${details}`.trim());
  }
}

function buildMacIcon(sourceIconPath, targetIconPath) {
  const tempDir = mkdtempSync(join(tmpdir(), "kickstart-iconset-"));
  const iconsetDir = join(tempDir, "kickstart.iconset");
  const iconPairs = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  try {
    mkdirSync(iconsetDir, { recursive: true });

    for (const [size, fileName] of iconPairs) {
      run("sips", ["-z", String(size), String(size), sourceIconPath, "--out", join(iconsetDir, fileName)]);
    }

    run("iconutil", ["-c", "icns", iconsetDir, "-o", targetIconPath]);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function buildPreparedMacPng(sourceIconPath, targetIconPath) {
  const swiftScript = `
import AppKit

let sourcePath = CommandLine.arguments[1]
let targetPath = CommandLine.arguments[2]
let canvasSize: CGFloat = ${macCanvasSize}
let visibleSize: CGFloat = ${macVisibleSize}
let pixelSize = Int(canvasSize)

let sourceUrl = URL(fileURLWithPath: sourcePath)
let targetUrl = URL(fileURLWithPath: targetPath)

guard let sourceImage = NSImage(contentsOf: sourceUrl) else {
  fputs("Failed to load source image\\n", stderr)
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: pixelSize,
  pixelsHigh: pixelSize,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Failed to create bitmap\\n", stderr)
  exit(1)
}

bitmap.size = NSSize(width: canvasSize, height: canvasSize)

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("Failed to create graphics context\\n", stderr)
  exit(1)
}
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.set()
NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize).fill()
sourceImage.draw(
  in: NSRect(
    x: (canvasSize - visibleSize) / 2,
    y: (canvasSize - visibleSize) / 2,
    width: visibleSize,
    height: visibleSize
  ),
  from: NSRect(origin: .zero, size: sourceImage.size),
  operation: .copy,
  fraction: 1
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Failed to encode output image\\n", stderr)
  exit(1)
}

try pngData.write(to: targetUrl)
`;

  run("swift", ["-", sourceIconPath, targetIconPath], { input: swiftScript });
}

if (!existsSync(macSourceIconPath)) {
  throw new Error(`Missing macOS source icon at ${macSourceIconPath}`);
}

if (!existsSync(defaultSourceIconPath)) {
  throw new Error(`Missing default source icon at ${defaultSourceIconPath}`);
}

mkdirSync(resourcesDir, { recursive: true });
cpSync(defaultSourceIconPath, join(resourcesDir, "logo.png"));

if (process.platform === "darwin") {
  const preparedMacIconPath = join(resourcesDir, "icon.png");
  buildPreparedMacPng(macSourceIconPath, preparedMacIconPath);
  buildMacIcon(preparedMacIconPath, join(resourcesDir, "icon.icns"));
} else {
  cpSync(macSourceIconPath, join(resourcesDir, "icon.png"));
}

const windowsIconBuffer = await pngToIco(defaultSourceIconPath);
writeFileSync(join(resourcesDir, "icon.ico"), windowsIconBuffer);
