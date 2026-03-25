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
          description: "Add all your code repos and see everything at a glance.",
          content: (active: boolean) => (
            <FeatureVideo src="/projects.mp4" active={active} />
          ),
        },
        {
          title: "One click, whole project running",
          description: "Hit start and your entire dev environment spins up.",
          content: (active: boolean) => (
            <FeatureVideo src="/start-project.mp4" active={active} />
          ),
        },
        {
          title: "Custom actions per project",
          description: "Run tests, lint, deploy. Wire up any command as an action.",
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
          title: "Not every terminal needs a name",
          description:
            "Need a quick command? Spin up a throwaway terminal in one click.",
          content: (active: boolean) => (
            <FeatureVideo src="/throwaway-terminals.mp4" active={active} />
          ),
        },
      ]}
    />
  )
}
