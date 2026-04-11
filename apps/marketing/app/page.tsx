import { AppleIcon, GitHubIcon } from "@/components/icons"
import Image from "next/image"
import { preload } from "react-dom"

import { DownloadButton } from "@/components/download-dialog-button"
import { HeroVideo } from "@/components/hero-video"
import { Button } from "@/components/ui/button"
import logoPng from "@kickstart/assets/src/logo.png"
import { FAQ } from "./faq"
import { Features } from "./features"

export default function Page() {
  preload("/start-project.jpg", { as: "image", fetchPriority: "high" })
  preload("/start-project.mp4", {
    as: "video",
    type: "video/mp4",
    fetchPriority: "high",
  })

  return (
    <>
      {/* Hero */}
      <div className="mx-auto mt-8 w-full max-w-5xl px-6 md:mt-16">
        <div className="relative w-full overflow-hidden rounded-2xl bg-muted/50 p-10 md:rounded-3xl md:p-16">
          <Image
            src={logoPng}
            alt=""
            width={500}
            height={500}
            className="pointer-events-none absolute -right-32 -bottom-32 w-[24rem] opacity-[0.15] select-none md:-right-20 md:-bottom-20 md:w-[36rem]"
            style={{
              maskImage:
                "radial-gradient(ellipse 60% 60% at 70% 70%, black 20%, transparent 70%)",
            }}
          />
          <p className="relative text-sm font-medium tracking-widest text-muted-foreground uppercase">
            The home for all your Terminals!
          </p>
          <h1 className="relative mt-3 max-w-lg text-4xl font-bold tracking-tight md:max-w-2xl md:text-6xl">
            Stop losing track of your terminals.
          </h1>
          <p className="relative mt-4 max-w-md text-lg text-muted-foreground md:max-w-xl md:text-xl">
            Organized like the Discord app. Repos are servers, terminals are
            channels. One click to run{" "}
            <mark className="rounded bg-foreground/10 px-1 text-inherit">
              npm run dev
            </mark>{" "}
            and everything else your project needs.
          </p>
          <div className="relative mt-8 flex items-center gap-3">
            <DownloadButton size="lg">
              <AppleIcon className="size-5" />
              Download for macOS
            </DownloadButton>
            <Button
              nativeButton={false}
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

      {/* App preview */}
      <div className="mx-auto mt-4 w-full max-w-5xl px-6 md:mt-6">
        <div
          className="overflow-hidden rounded-2xl bg-muted md:rounded-3xl"
          style={{ aspectRatio: "16/10" }}
        >
          <HeroVideo src="/start-project.mp4" poster="/start-project.jpg" />
        </div>
      </div>

      {/* Features */}
      <div className="mx-auto mt-40 max-w-5xl px-6">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">
          Features
        </h2>
        <Features />
      </div>

      {/* How it works */}
      <div className="mx-auto mt-24 w-full max-w-5xl px-6 md:mt-40">
        <h2 className="mb-12 text-2xl font-bold tracking-tight md:text-3xl">
          How it works
        </h2>
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-lg font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold">Download &amp; open</h3>
            <p className="mt-2 text-muted-foreground">
              Grab the app and you&apos;re ready. No config files, no setup
              scripts.
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
            <h3 className="text-lg font-semibold">Tell it what to run</h3>
            <p className="mt-2 text-muted-foreground">
              Add the commands each project needs, like{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
                npm run dev
              </code>{" "}
              or{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
                docker compose up
              </code>
              . Share them with your team via the repo, or keep them local to
              your machine.
            </p>
          </div>
        </div>
      </div>

      {/* Why */}
      <div className="mx-auto mt-40 w-full max-w-5xl px-6">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">
          Why I built this
        </h2>
        <div className="space-y-4 rounded-xl bg-muted/50 px-6 py-5 md:px-8 md:py-6">
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            AI coding made me jump between more projects than ever.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            I kept losing track of which terminal belonged to which project,
            especially once multiple were running in parallel, each needing two
            or three processes.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
            So I built Kickstart. One place to see what&apos;s running and start
            or stop everything with one click.
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto mt-40 mb-24 w-full max-w-5xl px-6">
        <h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">
          Frequently asked questions
        </h2>
        <FAQ />
      </div>
    </>
  )
}
