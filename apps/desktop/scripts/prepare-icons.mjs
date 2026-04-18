import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const resourcesDir = join(desktopDir, "resources");

const requiredFiles = [
  join(resourcesDir, "logo.png"),
  join(resourcesDir, "icon.png"),
  join(resourcesDir, "icon.icns"),
  join(resourcesDir, "icon.ico"),
];

const missingFiles = requiredFiles.filter((filePath) => !existsSync(filePath));

if (missingFiles.length > 0) {
  throw new Error(
    [
      "Desktop icon assets are missing.",
      ...missingFiles.map((filePath) => `- ${filePath}`),
      "Update the checked-in files in apps/desktop/resources when the app icon changes.",
    ].join("\n"),
  );
}
