import type { Metadata } from "next"
import { OpenPanelComponent } from "@openpanel/nextjs"
import { JetBrains_Mono, Manrope } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Kickstart — Desktop launcher for dev projects",
  description:
    "Add repos, pin dev commands, and keep every terminal tab durable across restarts.",
}

const openPanelClientId = process.env.OPENPANEL_CLIENT_ID

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", manrope.variable)}
    >
      <body>
        {openPanelClientId ? (
          <OpenPanelComponent
            apiUrl="/api/op"
            clientId={openPanelClientId}
            scriptUrl="/api/op/op1.js"
            trackScreenViews={true}
            trackOutgoingLinks={true}
          />
        ) : null}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
