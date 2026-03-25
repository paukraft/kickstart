"use client"

import { useOpenPanel } from "@openpanel/nextjs"
import type { ComponentPropsWithoutRef, PropsWithChildren } from "react"

type TrackedDownloadLinkProps = PropsWithChildren<
  Omit<ComponentPropsWithoutRef<"a">, "href" | "children"> & {
    href: string
    location: string
    platform?: string
  }
>

export function TrackedDownloadLink({
  children,
  href,
  location,
  platform = "macos",
  onClick,
  ...props
}: TrackedDownloadLinkProps) {
  const op = useOpenPanel()

  return (
    <a
      href={href}
      onClick={(event) => {
        op.track("download_clicked", {
          location,
          platform,
          href,
        })
        onClick?.(event)
      }}
      {...props}
    >
      {children}
    </a>
  )
}
