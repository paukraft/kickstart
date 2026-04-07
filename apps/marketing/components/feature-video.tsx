"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"

export function FeatureVideo({
  src,
  poster,
  active,
  preload = false,
}: {
  src: string
  poster: string
  active: boolean
  preload?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false)
  const shouldLoad = active || preload || hasLoadedFrame

  useEffect(() => {
    const video = ref.current
    if (!video || !shouldLoad) return

    if (active) {
      video.currentTime = 0
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [active, shouldLoad])

  return (
    <div className="relative size-full overflow-hidden bg-muted">
      <Image
        src={poster}
        alt=""
        aria-hidden="true"
        fill
        draggable={false}
        loading={preload ? "eager" : "lazy"}
        sizes="(min-width: 1024px) 720px, (min-width: 768px) 70vw, 100vw"
        className={`object-cover transition-opacity duration-200 ${
          hasLoadedFrame ? "opacity-0" : "opacity-100"
        }`}
      />
      <video
        ref={ref}
        src={shouldLoad ? src : undefined}
        loop
        muted
        playsInline
        preload={active || preload ? "auto" : "metadata"}
        onLoadedData={() => setHasLoadedFrame(true)}
        className="size-full object-cover"
      />
    </div>
  )
}
