import type { ReactNode } from "react";

import appLogo from "@kickstart/assets/src/logo.png";

export interface TitleBarProps {
  rightSlot?: ReactNode;
}

export function TitleBar({ rightSlot }: TitleBarProps) {
  const isDevelopment = import.meta.env.DEV;
  const title = isDevelopment ? "kickstart (dev)" : "kickstart";

  return (
    <div className="desktop-drag relative flex h-9 shrink-0 items-center justify-center border-b">
      <div className="flex items-center gap-2">
        <img
          src={appLogo}
          alt="Kickstart logo"
          className="size-5 rounded-sm object-contain"
          draggable={false}
        />
        <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {title}
        </span>
      </div>
      {rightSlot ? (
        <div className="desktop-no-drag absolute inset-y-0 right-0 flex items-center pr-2">
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
