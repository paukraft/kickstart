"use client"

import { OpenPanelComponent } from "@openpanel/nextjs"

const openPanelClientId = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID

export function TrackiTrack() {
  if (!openPanelClientId) {
    return null
  }

  return (
    <OpenPanelComponent
      apiUrl="/api/op"
      clientId={openPanelClientId}
      scriptUrl="/api/op/op1.js"
      trackScreenViews={true}
      trackOutgoingLinks={true}
    />
  )
}
