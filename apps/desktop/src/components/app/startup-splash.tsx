import splashVideoUrl from "@/assets/splash.mp4";
import { useDarkMode } from "@/lib/media-preferences";

interface StartupSplashProps {
  onComplete: () => void;
  visible: boolean;
}

export function StartupSplash({ onComplete, visible }: StartupSplashProps) {
  const isDark = useDarkMode();

  if (!visible) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-auto fixed inset-0 z-[200] overflow-hidden transition-colors",
        isDark
          ? "bg-[radial-gradient(circle_at_top,rgba(20,24,29,0.98),rgba(10,13,18,0.99)_58%,rgba(6,8,12,1))]"
          : "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(247,246,243,0.985)_58%,rgba(240,238,234,1))]",
      ].join(" ")}
    >
      <div className="flex h-full w-full items-center justify-center">
        <video
          autoPlay
          className={[
            "h-full w-full object-cover object-center transition-[filter] duration-200",
            isDark ? "invert contrast-125 brightness-95" : "",
          ].join(" ")}
          disablePictureInPicture
          muted
          onEnded={onComplete}
          onError={onComplete}
          playsInline
          preload="auto"
          src={splashVideoUrl}
        />
      </div>
    </div>
  );
}
