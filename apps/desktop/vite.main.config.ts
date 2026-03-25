import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const external = [
  "electron",
  "electron-squirrel-startup",
  "better-sqlite3",
  "node-pty",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      fileName: () => "main.js",
      formats: ["cjs"],
    },
    minify: false,
    outDir: "dist-electron",
    rollupOptions: {
      external,
    },
    sourcemap: true,
    target: "node22",
  },
});

