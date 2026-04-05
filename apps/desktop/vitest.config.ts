import { defineConfig } from "vitest/config";

import { desktopResolveAlias } from "./vite.shared";

export default defineConfig({
  resolve: {
    alias: desktopResolveAlias,
  },
  test: {
    environment: "node",
  },
});
