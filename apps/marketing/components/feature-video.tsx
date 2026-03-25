"use client"

import { useEffect, useRef } from "react"

export function FeatureVideo({
  src,
  active,
}: {
  src: string
  active: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return

    if (active) {
      video.currentTime = 0
      video.play()
    } else {
      video.pause()
    }
  }, [active])

  return (
    <video
      ref={ref}
      src={src}
      loop
      muted
      playsInline
      className="size-full object-cover"
    />
  )
}
