import { useSyncExternalStore } from "react";

function getMediaQueryList(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  return window.matchMedia(query);
}

const darkModeQuery = getMediaQueryList("(prefers-color-scheme: dark)");
const reducedMotionQuery = getMediaQueryList("(prefers-reduced-motion: reduce)");

function subscribeToMediaQuery(
  mediaQuery: MediaQueryList | null,
  callback: () => void,
) {
  mediaQuery?.addEventListener("change", callback);
  return () => mediaQuery?.removeEventListener("change", callback);
}

export function getPrefersDarkMode() {
  return darkModeQuery?.matches ?? true;
}

export function prefersReducedMotion() {
  return reducedMotionQuery?.matches ?? false;
}

export function useDarkMode() {
  return useSyncExternalStore(
    (callback) => subscribeToMediaQuery(darkModeQuery, callback),
    getPrefersDarkMode,
    getPrefersDarkMode,
  );
}
