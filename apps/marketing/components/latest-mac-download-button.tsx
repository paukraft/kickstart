"use client"

import { useOpenPanel } from "@openpanel/nextjs"
import { useEffect, useState } from "react"

import { AppleIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

const RELEASES_LATEST_URL = "https://github.com/paukraft/kickstart/releases/latest"
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/paukraft/kickstart/releases/latest"
const CACHE_KEY = "kickstart-latest-release"
const CACHE_TTL_MS = 60 * 60 * 1000

type GitHubReleaseAsset = {
  browser_download_url?: string
  name?: string
}

type GitHubRelease = {
  assets?: GitHubReleaseAsset[]
}

type CachedRelease = {
  cachedAt: number
  release: GitHubRelease
}

function pickLatestMacAssetUrl(release: GitHubRelease): string | null {
  const asset = release.assets?.find(
    (entry) =>
      entry.name?.endsWith("-arm64.dmg") && typeof entry.browser_download_url === "string",
  )

  return asset?.browser_download_url ?? null
}

export function LatestMacDownloadButton() {
  const op = useOpenPanel()
  const [href, setHref] = useState(RELEASES_LATEST_URL)

  useEffect(() => {
    let cancelled = false

    const applyRelease = (release: GitHubRelease) => {
      const assetUrl = pickLatestMacAssetUrl(release)
      if (!cancelled && assetUrl) {
        setHref(assetUrl)
      }
    }

    const loadLatestRelease = async () => {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as CachedRelease
          if (Date.now() - parsed.cachedAt < CACHE_TTL_MS) {
            applyRelease(parsed.release)
            return
          }
        } catch {
          sessionStorage.removeItem(CACHE_KEY)
        }
      }

      try {
        const response = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {
            Accept: "application/vnd.github+json",
          },
        })

        if (!response.ok) {
          return
        }

        const release = (await response.json()) as GitHubRelease
        if (release.assets) {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              cachedAt: Date.now(),
              release,
            } satisfies CachedRelease),
          )
        }
        applyRelease(release)
      } catch {
        // Fall back to the latest GitHub release page.
      }
    }

    void loadLatestRelease()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Button
      nativeButton={false}
      size="lg"
      render={
        <a
          href={href}
          onClick={() => {
            op.track("download_clicked", {
              href,
              location: "install-page",
              platform: "macos",
            })
          }}
        />
      }
    >
      <AppleIcon className="size-5" />
      Download for macOS
    </Button>
  )
}
