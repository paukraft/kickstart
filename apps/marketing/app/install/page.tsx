import { LatestMacDownloadButton } from "@/components/latest-mac-download-button"
import type { ReactNode } from "react"

const PRIVACY_AND_SECURITY_URL = "x-apple.systempreferences:com.apple.preference.security"

const steps: ReactNode[] = [
  "Click the download button. Your Mac will download the latest Kickstart DMG.",
  "Open the file you just downloaded, then drag Kickstart into Applications.",
  <>
    Open Kickstart from Applications. If macOS blocks it, open{" "}
    <a
      href={PRIVACY_AND_SECURITY_URL}
      className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground"
    >
      Privacy &amp; Security
    </a>{" "}
    and click Open Anyway.
  </>,
  "When there’s a new version, download it again and replace the old app.",
]

export default function InstallPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-10 pb-24 md:pt-16">
      <section className="rounded-2xl bg-muted/50 p-10 md:rounded-3xl md:p-16">
        <h1 className="max-w-lg text-4xl font-bold tracking-tight md:text-5xl">
          Install Kickstart on your Mac
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground md:text-xl">
          This takes about a minute. The only odd part is that macOS will ask
          you to approve the app the first time you open it.
        </p>
        <div className="mt-8">
          <LatestMacDownloadButton />
        </div>

        <ol className="mt-12 space-y-4">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {index + 1}
              </div>
              <p className="pt-1 text-sm leading-6 text-muted-foreground md:text-base">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
