import type { DesktopBridge } from "@kickstart/contracts";

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
  const MAIN_WINDOW_VITE_NAME: string;

  interface Window {
    desktop: DesktopBridge;
    __kickstartTerminalDebug?: {
      rowsText: () => string;
      scrollToBottom: () => void;
      scrollToTop: () => void;
      serialize: () => string;
    };
  }
}

export {};
