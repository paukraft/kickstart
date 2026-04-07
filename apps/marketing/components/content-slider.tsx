"use client"

import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useRef, useState } from "react"

export interface SliderItem {
  title: string
  description: string
  content?:
    | ReactNode
    | ((state: { active: boolean; preload: boolean }) => ReactNode)
}

interface ContentSliderProps {
  items: SliderItem[]
  className?: string
  aspectRatio?: string
  gap?: number
}

const SLIDE_WIDTH = 65 // % of container
const GAP = 1.5 // rem

const getCircularDistance = (a: number, b: number, length: number) => {
  const direct = Math.abs(a - b)
  return Math.min(direct, length - direct)
}

const textVariants = {
  enter: (d: number) => ({ x: d > 0 ? 20 : -20, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d < 0 ? 20 : -20, opacity: 0 }),
}

export const ContentSlider = ({ items, className, aspectRatio = "16/10", gap: gapProp }: ContentSliderProps) => {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef(0)
  const dragged = useRef(false)

  if (items.length === 0) return null

  const go = (newIndex: number) => {
    setDirection(newIndex > index ? 1 : -1)
    setIndex(newIndex)
  }

  const prev = () => go((index - 1 + items.length) % items.length)
  const next = () => go((index + 1) % items.length)

  const item = items[index]!
  const gap = gapProp ?? GAP

  const trackX = `calc(-${index} * (${SLIDE_WIDTH}% + ${gap}rem) + ${dragOffset}px)`

  const SWIPE_THRESHOLD = 50

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientX
    dragged.current = false
    setIsDragging(true)
    setDragOffset(0)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.current
    if (Math.abs(dx) > 5) dragged.current = true
    setDragOffset(dx)
  }

  const onPointerUp = () => {
    if (!isDragging) return
    setIsDragging(false)
    if (dragOffset < -SWIPE_THRESHOLD && index < items.length - 1) {
      go(index + 1)
    } else if (dragOffset > SWIPE_THRESHOLD && index > 0) {
      go(index - 1)
    }
    setDragOffset(0)
  }

  if (items.length === 0) return null

  return (
    <div className={className}>
      {/* Track — overflow visible so peeking slides aren't clipped */}
      <div className="w-full overflow-visible">
        <motion.div
          className="flex select-none cursor-grab active:cursor-grabbing"
          animate={{ x: trackX }}
          transition={isDragging ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
          style={{ gap: `${gap}rem` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {items.map((slide, i) => (
            <div
              key={i}
              className={`relative shrink-0 overflow-hidden rounded-2xl bg-muted md:rounded-3xl ${i !== index ? "cursor-pointer" : ""}`}
              style={{ width: `${SLIDE_WIDTH}%`, aspectRatio }}
              onClick={() => !dragged.current && i !== index && go(i)}
            >
              {typeof slide.content === "function"
                ? slide.content({
                    active: i === index,
                    preload: getCircularDistance(i, index, items.length) <= 1,
                  })
                : slide.content}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Info + controls */}
      <div
        className="mt-4 flex items-start justify-between gap-6 md:mt-6"
        style={{ width: `${SLIDE_WIDTH}%` }}
      >
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            variants={textVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
              mass: 0.5,
            }}
            className="min-w-0 flex-1"
          >
            <strong className="block text-base leading-6 font-normal text-foreground md:text-xl md:leading-7">
              {item.title}
            </strong>
            <p className="mt-1 text-sm leading-5 text-muted-foreground md:text-base md:leading-6">
              {item.description}
            </p>
          </motion.div>
        </AnimatePresence>

        {items.length > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={prev}
              className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary md:size-12"
              aria-label="Previous slide"
            >
              <RiArrowLeftLine className="size-4 md:size-5" />
            </button>
            <button
              onClick={next}
              className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary md:size-12"
              aria-label="Next slide"
            >
              <RiArrowRightLine className="size-4 md:size-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
