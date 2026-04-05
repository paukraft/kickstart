import path from "node:path";

export const desktopResolveAlias = {
  "@": path.resolve(__dirname, "src"),
} as const;
