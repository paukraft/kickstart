import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { desktopResolveAlias } from "./vite.shared";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-renderer",
    sourcemap: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: desktopResolveAlias,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
