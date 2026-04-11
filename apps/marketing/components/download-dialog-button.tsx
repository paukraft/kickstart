import type { PropsWithChildren } from "react"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"

type DownloadButtonProps = PropsWithChildren<
  VariantProps<typeof buttonVariants> & {
    className?: string
  }
>

export function DownloadButton({
  children,
  className,
  size,
  variant,
}: DownloadButtonProps) {
  return (
    <Button
      className={className}
      nativeButton={false}
      size={size}
      variant={variant}
      render={<a href="/install" />}
    >
      {children}
    </Button>
  )
}
