import appLogo from "@kickstart/assets/src/logo.png";

export function TitleBar() {
  const isDevelopment = import.meta.env.DEV;
  const title = isDevelopment ? "kickstart (dev)" : "kickstart";

  return (
    <div className="desktop-drag flex h-9 shrink-0 items-center justify-center border-b">
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
    </div>
  );
}
