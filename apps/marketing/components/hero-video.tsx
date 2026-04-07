"use client"

import Image from "next/image"
import { useState } from "react"

export function HeroVideo({
  src,
  poster,
}: {
  src: string
  poster: string
}) {
  const [isReady, setIsReady] = useState(false)

  return (
    <div className="relative size-full overflow-hidden bg-muted">
      <Image
        src={poster}
        alt=""
        aria-hidden="true"
        fill
        draggable={false}
        loading="eager"
        sizes="(min-width: 1280px) 1024px, (min-width: 768px) calc(100vw - 3rem), 100vw"
        className={`object-cover transition-opacity duration-200 ${
          isReady ? "opacity-0" : "opacity-100"
        }`}
      />
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setIsReady(true)}
        className="size-full object-cover"
      />
    </div>
  )
}
