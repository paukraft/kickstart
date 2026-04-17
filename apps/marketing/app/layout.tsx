import type { Metadata } from "next"
import { JetBrains_Mono, Manrope } from "next/font/google"
import Image from "next/image"

import "./globals.css"
import { Navbar } from "@/components/navbar"
import { TrackiTrack } from "@/components/tracki-track"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import wordmarkPng from "@kickstart/assets/src/wordmark.png"

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Kickstart — Manage dev servers across all your repos",
  description:
    "Free macOS app that runs and organizes your dev commands across every project. One click to start everything, one place to see what's running.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", manrope.variable)}
    >
      <body>
        <TrackiTrack />
        <ThemeProvider>
          <div className="flex min-h-svh flex-col overflow-x-clip">
            <Navbar />
            {children}
            <footer className="mx-auto mt-auto w-full max-w-5xl px-6 py-16 text-center">
              <Image
                src={wordmarkPng}
                alt="Kickstart"
                className="mx-auto w-64 invert dark:invert-0 md:w-96"
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
        </ThemeProvider>
      </body>
    </html>
  )
}
