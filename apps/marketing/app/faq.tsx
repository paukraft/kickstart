"use client"

import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"

const items = [
  {
    q: "What is kickstart.json?",
    a: "It is a small file in your project root that defines the commands for that repo. Each command can have a name, working directory, environment variables, a type, and a start mode.",
  },
  {
    q: "Does it work with any stack?",
    a: "Yes. Kickstart runs normal shell commands, so if your project already starts from the terminal, Kickstart can run it too.",
  },
  {
    q: "What is the difference between services and actions?",
    a: "Services are the long-running commands you want to keep around, like a dev server or worker. Actions are one-off commands you run when needed, like tests, lint, builds, or deploy scripts.",
  },
  {
    q: "Do terminals survive restarts?",
    a: "Your tabs, scrollback, and current working directory stay there when you reopen the app, so each shell comes back in the folder you left it in. Running processes do not keep going, but you can start them again with one click.",
  },
  {
    q: "Can I open extra shells without saving them?",
    a: "Yes. You can open extra shell tabs inside a project whenever you need a quick command, and there is also a shared General workspace for shells that do not belong to one repo.",
  },
  {
    q: "Is it free?",
    a: "Yes, Kickstart is free and open source.",
  },
  {
    q: "macOS only?",
    a: "Right now, yes. Linux and Windows are planned later.",
  },
  {
    q: "Why is the app unsigned?",
    a: "Signing a macOS app costs $99/year — I've decided against paying that for now, but if Kickstart gets some traction I'll consider it. No worries though, everything works the same, installation just takes a few seconds longer. Try opening the app, then go to System Settings > Privacy & Security and click Open Anyway.",
  },
]

export function FAQ() {
  return (
    <Accordion transition={{ duration: 0.2, ease: "easeInOut" }}>
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <AccordionItem key={i} value={i} className="rounded-xl bg-muted/50">
            <AccordionTrigger className="flex w-full items-center justify-between gap-6 px-5 py-4 text-left text-sm font-medium md:text-base">
              {item.q}
              <RiArrowDownSLine className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-expanded:hidden" />
              <RiArrowUpSLine className="hidden size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-expanded:inline" />
            </AccordionTrigger>
            <AccordionContent className="overflow-hidden px-5">
              <p className="pb-4 text-sm leading-relaxed text-muted-foreground md:text-base">{item.a}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </div>
    </Accordion>
  )
}
