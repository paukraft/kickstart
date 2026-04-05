"use client"

import { ContentSlider } from "@/components/content-slider"
import { FeatureVideo } from "@/components/feature-video"

export function Features() {
  return (
    <ContentSlider
      aspectRatio="4/3"
      gap={3}
      className=""
      items={[
        {
          title: "All your repos, one sidebar",
          description: "Add your projects and see which ones are running, stopped, or need attention.",
          content: (active: boolean) => (
            <FeatureVideo src="/projects.mp4" active={active} />
          ),
        },
        {
          title: "One click, whole project running",
          description: "Hit start and all your project's dev servers launch at once.",
          content: (active: boolean) => (
            <FeatureVideo src="/start-project.mp4" active={active} />
          ),
        },
        {
          title: "One-off commands, always ready",
          description: "Save commands like test, lint, or deploy to each project. Share them with the team or keep them just for you.",
          content: (active: boolean) => (
            <FeatureVideo src="/actions.mp4" active={active} />
          ),
        },
        {
          title: "Jump between projects",
          description: "Start one project, switch to the next, start that too.",
          content: (active: boolean) => (
            <FeatureVideo src="/start-multiple-in-parralel.mp4" active={active} />
          ),
        },
        {
          title: "Drag, drop, done",
          description:
            "Reorder projects and nest them in folders. Same drag-and-drop you know from Discord.",
          content: (active: boolean) => (
            <FeatureVideo src="/order-projects.mp4" active={active} />
          ),
        },
        {
          title: "Throwaway terminals when you need them",
          description:
            "Quick command that doesn't need saving? Open a one-off shell in any project.",
          content: (active: boolean) => (
            <FeatureVideo src="/throwaway-terminals.mp4" active={active} />
          ),
        },
      ]}
    />
  )
}
