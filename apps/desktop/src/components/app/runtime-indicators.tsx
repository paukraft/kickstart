import { motion } from "motion/react";

/** Raw RGB channels for runtime state colors — use with rgb()/rgba() in gradients */
export const RUNTIME_RGB = {
  running: "16, 185, 129",
  runningLight: "52, 211, 153",
  starting: "245, 158, 11",
} as const;

export const RUNTIME_COLORS = {
  running: `rgb(${RUNTIME_RGB.running})`,
  starting: `rgb(${RUNTIME_RGB.starting})`,
} as const;

export function AnimatedBars({
  size,
  color,
  barWidth,
  gap,
}: {
  size: number;
  color: string;
  barWidth: number;
  gap: number;
}) {
  const totalWidth = barWidth * 3 + gap * 2;
  const offsetX = (size - totalWidth) / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0, 1, 2].map((index) => (
        <motion.rect
          key={index}
          x={offsetX + index * (barWidth + gap)}
          width={barWidth}
          rx={barWidth / 2}
          fill={color}
          animate={{
            y: [size * 0.6, size * 0.25, size * 0.6],
            height: [size * 0.2, size * 0.55, size * 0.2],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: index * 0.15,
          }}
        />
      ))}
    </svg>
  );
}
