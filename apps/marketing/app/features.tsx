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
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/projects.mp4"
              poster="/projects.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
        {
          title: "One click, whole project running",
          description: "Hit start and all your project's dev servers launch at once.",
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/start-project.mp4"
              poster="/start-project.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
        {
          title: "One-off commands, always ready",
          description: "Save commands like test, lint, or deploy to each project. Share them with the team or keep them just for you.",
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/actions.mp4"
              poster="/actions.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
        {
          title: "Jump between projects",
          description: "Start one project, switch to the next, start that too.",
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/start-multiple-in-parralel.mp4"
              poster="/start-multiple-in-parralel.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
        {
          title: "Drag, drop, done",
          description:
            "Reorder projects and nest them in folders. Same drag-and-drop you know from Discord.",
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/order-projects.mp4"
              poster="/order-projects.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
        {
          title: "Throwaway terminals when you need them",
          description:
            "Quick command that doesn't need saving? Open a one-off shell in any project.",
          content: ({ active, preload }) => (
            <FeatureVideo
              src="/throwaway-terminals.mp4"
              poster="/throwaway-terminals.jpg"
              active={active}
              preload={preload}
            />
          ),
        },
      ]}
    />
  )
}
