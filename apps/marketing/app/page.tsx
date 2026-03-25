import { AppleIcon, GitHubIcon } from "@/components/icons"
import Image from "next/image"

import { Navbar } from "@/components/navbar"
import { TrackedDownloadLink } from "@/components/tracked-download-link"
import { Button } from "@/components/ui/button"
import logoPng from "@kickstart/assets/src/logo.png"
import wordmarkPng from "@kickstart/assets/src/wordmark.png"
import { FAQ } from "./faq"
import { Features } from "./features"

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <Navbar />

      {/* Hero */}
      <div className="mx-auto mt-8 w-full max-w-5xl px-6 md:mt-16">
        <div className="relative w-full overflow-hidden rounded-2xl bg-muted/50 p-10 md:rounded-3xl md:p-16">
          <Image
            src={logoPng}
            alt=""
            width={500}
            height={500}
            className="pointer-events-none absolute -right-32 -bottom-32 w-[24rem] select-none opacity-[0.15] md:-right-20 md:-bottom-20 md:w-[36rem]"
            style={{
              maskImage:
                "radial-gradient(ellipse 60% 60% at 70% 70%, black 20%, transparent 70%)",
            }}
          />
          <h1 className="relative max-w-lg text-4xl font-bold tracking-tight md:max-w-2xl md:text-6xl">
            Your command center for local dev.
          </h1>
          <p className="relative mt-4 max-w-md text-lg text-muted-foreground md:max-w-xl md:text-xl">
            Pin commands to each repo, start everything at once,
            and always know what&apos;s running where.
          </p>
          <div className="relative mt-8 flex items-center gap-3">
            <Button
              size="lg"
              render={
                <TrackedDownloadLink
                  href="https://github.com/paukraft/kickstart/releases/latest"
                  location="hero"
                />
              }
            >
              <AppleIcon className="size-5" />
              Download for macOS
            </Button>
            <Button
              variant="ghost"
              size="lg"
              render={
                <a
                  href="https://github.com/paukraft/kickstart"
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <GitHubIcon className="size-4" />
              GitHub
            </Button>
          </div>
          <p className="relative mt-4 text-sm text-muted-foreground">
            Free and open source. MIT license.
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="mx-auto w-full max-w-5xl px-6 mt-24 md:mt-40">
        <h2 className="mb-12 text-2xl font-bold tracking-tight md:text-3xl">How it works</h2>
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-lg font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold">Download &amp; open</h3>
            <p className="mt-2 text-muted-foreground">
              Grab the app and you&apos;re ready. No config files, no setup scripts.
            </p>
          </div>
          <div>
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-lg font-bold">
              2
            </div>
            <h3 className="text-lg font-semibold">Add your project</h3>
            <p className="mt-2 text-muted-foreground">
              Select a repo folder. Kickstart picks it up instantly.
            </p>
          </div>
          <div>
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-lg font-bold">
              3
            </div>
            <h3 className="text-lg font-semibold">Set up your commands</h3>
            <p className="mt-2 text-muted-foreground">
              A quick wizard walks you through it. Kickstart saves everything
              to a{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">kickstart.json</code>{" "}
              in your repo, your whole team gets the same setup.
            </p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="mx-auto max-w-5xl px-6 mt-40">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">Features</h2>
        <Features />
      </div>

      {/* Why */}
      <div className="mx-auto w-full max-w-5xl px-6 mt-40">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">Why I built this</h2>
        <div className="rounded-xl bg-muted/50 px-6 py-5 md:px-8 md:py-6 space-y-4">
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            AI coding made me jump between more projects than ever.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            I kept losing track of which terminal belonged to which project, especially once multiple were running in parallel, each needing two or three processes.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            So I built Kickstart. One place to see what&apos;s running and start or stop everything with one click.
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto w-full max-w-5xl px-6 mt-40 mb-24">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">Frequently asked questions</h2>
        <FAQ />
      </div>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-5xl px-6 py-16 text-center">
        <Image
          src={wordmarkPng}
          alt="Kickstart"
          className="mx-auto w-64 md:w-96"
        />
        <p className="mt-4 text-sm text-muted-foreground">
          <a
            href="https://github.com/paukraft/kickstart"
            className="transition-colors hover:text-foreground"
          >
            Free and open source under MIT.
          </a>
          {" · Built by "}
          <a
            href="https://paukraft.com"
            className="transition-colors hover:text-foreground"
          >
            Pau Kraft
          </a>
        </p>
      </footer>
    </div>
  )
}
