import { LatestMacDownloadButton } from "@/components/latest-mac-download-button"

const steps = [
  "Download the latest Kickstart DMG.",
  "Open the DMG and drag Kickstart into Applications.",
  "Open Kickstart. If macOS blocks it: System Settings → Privacy & Security → Open Anyway.",
  "To update, just download the new version and replace the app.",
]

export default function InstallPage() {
  return (
      <main className="mx-auto w-full max-w-5xl px-6 pt-10 pb-24 md:pt-16">
        <section className="rounded-2xl bg-muted/50 p-10 md:rounded-3xl md:p-16">
          <h1 className="max-w-lg text-4xl font-bold tracking-tight md:text-5xl">
            One extra step, then you&apos;re set.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground md:text-xl">
            The app isn&apos;t code-signed yet (Apple charges $99/year), so macOS
            will ask you to approve it manually. Everything works the same.
          </p>
          <div className="mt-8">
            <LatestMacDownloadButton />
          </div>

          <ol className="mt-12 space-y-4">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-4">
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
