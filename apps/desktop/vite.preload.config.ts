import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const external = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/preload.ts", import.meta.url)),
      fileName: () => "preload.js",
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

