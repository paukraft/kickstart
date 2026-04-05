"use client"

export function HeroVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      autoPlay
      loop
      muted
      playsInline
      className="size-full object-cover"
    />
  )
}
