"use client"

import { AppleIcon, GitHubIcon } from "@/components/icons"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { DownloadButton } from "@/components/download-dialog-button"
import { cn } from "@/lib/utils"
import wordmarkPng from "@kickstart/assets/src/wordmark.png"

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="sticky top-0 z-50 mx-auto w-full max-w-5xl px-6 pt-4">
      <nav
        className={cn(
          "flex items-center justify-between rounded-2xl px-5 py-3 transition-colors duration-300",
          scrolled ? "bg-muted backdrop-blur-md" : "bg-transparent"
        )}
      >
        <Link href="/">
          <Image
            src={wordmarkPng}
            alt="Kickstart"
            className="h-5 w-auto"
          />
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            render={
              <a
                href="https://github.com/paukraft/kickstart"
                target="_blank"
                rel="noopener"
              />
            }
          >
            <GitHubIcon className="size-4" />
          </Button>
          <DownloadButton size="sm">
            <AppleIcon className="size-4" />
            Download for macOS
          </DownloadButton>
        </div>
      </nav>
    </div>
  )
}
