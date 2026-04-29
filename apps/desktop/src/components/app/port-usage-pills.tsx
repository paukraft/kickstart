import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiExternalLinkLine,
  RiGlobalLine,
  RiRouteLine,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  labelForPortPreviewFramework,
  PORT_PREVIEW_FRAMEWORKS,
  type PortPreviewFrameworkId,
  type PortPreviewMetadata,
  type ProjectWithRuntime,
  type TerminalPortUsage,
} from "@kickstart/contracts";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { SeededAvatar } from "@/components/ui/seeded-avatar";
import { cn } from "@/lib/utils";

export type PortUsageProjectInfo = Pick<
  ProjectWithRuntime,
  "id" | "name" | "path" | "iconUrl"
>;

export interface PortUsagePillsProps {
  projects: Record<string, PortUsageProjectInfo>;
  onSelect: (payload: { projectId: string; tabId: string }) => void;
}

function openUrlHostForAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  if (
    normalized === "*" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  ) {
    return "localhost";
  }
  if (normalized.includes(":") && !normalized.startsWith("[")) {
    return `[${address.trim()}]`;
  }
  return address.trim();
}

export function primaryOpenUrl(usage: TerminalPortUsage) {
  const portless = usage.portlessRoutes[0];
  if (portless) return portless.url;
  return `http://${openUrlHostForAddress(usage.address)}:${usage.port}`;
}

const SCROLL_STEP_PX = 140;
const SCROLL_FADE_PX = 56;
const HOVER_DELAY_MS = 200;
const HOVER_SKIP_WINDOW_MS = 300;

export function PortUsagePills({ projects, onSelect }: PortUsagePillsProps) {
  const [usages, setUsages] = useState<TerminalPortUsage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [skipHoverDelay, setSkipHoverDelay] = useState(false);
  const suppressCloseUntilRef = useRef(0);
  const skipHoverDelayTimerRef = useRef<number | null>(null);
  const delay = cardOpen || skipHoverDelay ? 0 : HOVER_DELAY_MS;

  const handle = useMemo(
    () => PreviewCardPrimitive.createHandle<TerminalPortUsage>(),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const initial = await window.desktop.getActivePortUsages();
        if (!cancelled) {
          setUsages(initial);
        }
      } catch {
        // tracker may not be ready yet, subscription will fill in
      }
    })();

    const unsubscribe = window.desktop.watchPortUsage((next) => {
      setUsages(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const startHoverDelaySkip = useCallback(() => {
    if (skipHoverDelayTimerRef.current) {
      window.clearTimeout(skipHoverDelayTimerRef.current);
    }
    setSkipHoverDelay(true);
    skipHoverDelayTimerRef.current = window.setTimeout(() => {
      skipHoverDelayTimerRef.current = null;
      setSkipHoverDelay(false);
    }, HOVER_SKIP_WINDOW_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (skipHoverDelayTimerRef.current) {
        window.clearTimeout(skipHoverDelayTimerRef.current);
      }
    };
  }, []);

  const syncScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = element;
    setCanScrollLeft(scrollLeft > 0.5);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 0.5);
  }, []);

  useEffect(() => {
    syncScrollState();
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => syncScrollState());
    observer.observe(element);
    for (const child of Array.from(element.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [usages, syncScrollState]);

  const scrollByStep = (direction: "left" | "right") => {
    const element = scrollRef.current;
    if (!element) return;
    const delta = direction === "left" ? -SCROLL_STEP_PX : SCROLL_STEP_PX;
    element.scrollBy({ left: delta, behavior: "smooth" });
  };

  if (usages.length === 0) {
    return null;
  }

  return (
    <div className="group/pills relative max-w-[clamp(160px,40vw,400px)]">
      <div
        ref={scrollRef}
        onScroll={syncScrollState}
        className="scrollbar-hidden flex items-center gap-0.5 overflow-x-auto"
      >
        <AnimatePresence initial={false}>
          {usages.map((usage) => {
            const project = projects[usage.projectId];
            const projectName = project?.name ?? usage.projectId;
            const portlessRoute = usage.portlessRoutes[0] ?? null;
            const extraAliasCount = Math.max(usage.portlessRoutes.length - 1, 0);
            const label = portlessRoute
              ? portlessRoute.hostname
              : `:${usage.port}`;
            return (
              <motion.div
                key={usage.id}
                layout
                initial={{ opacity: 0, transform: "scale(0.92)" }}
                animate={{ opacity: 1, transform: "scale(1)" }}
                exit={{ opacity: 0, transform: "scale(0.92)" }}
                transition={{
                  duration: 0.18,
                  ease: [0.23, 1, 0.32, 1],
                }}
                style={{ display: "inline-flex" }}
              >
                <HoverCardTrigger
                  handle={handle}
                  payload={usage}
                  delay={delay}
                  closeDelay={120}
                  render={<div />}
                >
                  <button
                    type="button"
                    onClick={() => {
                      suppressCloseUntilRef.current = Date.now() + 400;
                      onSelect({
                        projectId: usage.projectId,
                        tabId: usage.tabId,
                      });
                    }}
                    className="flex h-6 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 font-mono text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent/50 hover:text-foreground active:scale-[0.97]"
                  >
                    {project?.iconUrl ? (
                      <img
                        src={project.iconUrl}
                        alt=""
                        draggable={false}
                        className="size-3.5 shrink-0 rounded-[3px] object-cover"
                      />
                    ) : (
                      <SeededAvatar
                        seed={project?.path || usage.projectId}
                        displayValue={projectName}
                        variant="character"
                        rounded="sm"
                        size="sm"
                        className="size-3.5 shrink-0 rounded-[3px]"
                      />
                    )}
                    <span>{label}</span>
                    {extraAliasCount > 0 ? (
                      <span className="rounded-[4px] bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">
                        +{extraAliasCount}
                      </span>
                    ) : null}
                  </button>
                </HoverCardTrigger>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-background via-background/80 to-transparent transition-opacity duration-150 ease-out",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SCROLL_FADE_PX }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-background via-background/80 to-transparent transition-opacity duration-150 ease-out",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SCROLL_FADE_PX }}
      />
      <ScrollEdge
        direction="left"
        visible={canScrollLeft}
        onClick={() => scrollByStep("left")}
      />
      <ScrollEdge
        direction="right"
        visible={canScrollRight}
        onClick={() => scrollByStep("right")}
      />

      <HoverCard<TerminalPortUsage>
        handle={handle}
        onOpenChange={(open, eventDetails) => {
          if (!open && Date.now() < suppressCloseUntilRef.current) {
            eventDetails.cancel();
            return;
          }
          setCardOpen(open);
          if (!open) startHoverDelaySkip();
        }}
      >
        {({ payload }) =>
          payload ? (
            <HoverCardContent side="bottom" align="end" className="w-72 p-0">
              <PortCardBody
                usage={payload}
                project={projects[payload.projectId]}
              />
            </HoverCardContent>
          ) : null
        }
      </HoverCard>
    </div>
  );
}

function PortCardBody({
  usage,
  project,
}: {
  usage: TerminalPortUsage;
  project: PortUsageProjectInfo | undefined;
}) {
  const projectName = project?.name ?? usage.projectId;
  const portlessRoute = usage.portlessRoutes[0] ?? null;
  const openUrl = primaryOpenUrl(usage);
  const extraPortlessRoutes = usage.portlessRoutes.slice(1);
  const endpointLabel = portlessRoute?.hostname ?? openUrl;
  const localEndpoint = formatLocalEndpoint(usage);
  const networkCopyUrl = portlessRoute ? `http://localhost:${usage.port}` : openUrl;
  const command = getDistinctCommand(usage);
  const [preview, setPreview] = useState<PortPreviewMetadata | null>(null);
  const badges = getPortBadges(usage, preview);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    void window.desktop.getPortPreview(openUrl).then((metadata) => {
      if (!cancelled) {
        setPreview(metadata);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openUrl]);

  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <ProjectAvatar project={project} projectId={usage.projectId} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <div className="truncate text-sm font-semibold">
            {projectName}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {usage.tabTitle}
          </div>
        </div>
      </div>

      <BadgeRow badges={badges} openUrl={networkCopyUrl} />

      {portlessRoute ? (
        <div className="border-b px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate font-mono text-sm">
              {endpointLabel}
            </div>
            <button
              type="button"
              onClick={() =>
                void window.desktop.openExternalUrl("https://portless.sh/")
              }
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <RiRouteLine className="size-3" />
              Portless
            </button>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            Local {localEndpoint}
          </div>
        </div>
      ) : null}

      {preview ? <PortPreview preview={preview} /> : null}

      {extraPortlessRoutes.length > 0 || command ? (
        <dl className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
          {extraPortlessRoutes.length > 0 ? (
            <DetailRow
              label="Aliases"
              value={extraPortlessRoutes.map((route) => route.hostname).join(", ")}
              mono
            />
          ) : null}
          {command ? (
            <DetailRow label="Command" value={command} mono />
          ) : null}
        </dl>
      ) : null}

      <div className="border-t p-2">
        <button
          type="button"
          onClick={() => void window.desktop.openExternalUrl(openUrl)}
          className="group/open flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-out hover:bg-accent/50 active:scale-[0.98]"
        >
          <span className="truncate font-mono text-muted-foreground group-hover/open:text-foreground">
            {openUrl}
          </span>
          <RiExternalLinkLine className="size-3.5 shrink-0 text-muted-foreground group-hover/open:text-foreground" />
        </button>
      </div>
    </>
  );
}

function BadgeRow({ badges, openUrl }: { badges: string[]; openUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  if (badges.length === 0) {
    return null;
  }

  const copyNetworkUrl = async () => {
    const copiedUrl = await window.desktop.copyNetworkPortUrl(openUrl);
    if (!copiedUrl) {
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1_200);
  };

  return (
    <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
      {badges.map((badge) =>
        badge === "Network visible" ? (
          <button
            key={badge}
            type="button"
            onClick={copyNetworkUrl}
            title="Copy network URL"
            className="inline-flex h-5 cursor-pointer items-center rounded-md bg-muted px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? "Copied" : badge}
          </button>
        ) : (
          <span
            key={badge}
            className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {badge}
          </span>
        ),
      )}
    </div>
  );
}

function PortPreview({ preview }: { preview: PortPreviewMetadata }) {
  const hasBody = Boolean(preview.title || preview.description);
  if (!hasBody) {
    return null;
  }

  return (
    <div className="border-b px-3 py-2.5">
      <div className="relative pl-2.5">
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 w-[2px] rounded-full bg-border"
        />
        {preview.siteName ? (
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <RiGlobalLine className="size-3 shrink-0" />
            <span className="truncate">{preview.siteName}</span>
          </div>
        ) : null}
        {preview.title ? (
          <div
            className={cn(
              "line-clamp-2 text-sm font-semibold leading-snug text-foreground",
              preview.siteName && "mt-1",
            )}
          >
            {preview.title}
          </div>
        ) : null}
        {preview.description ? (
          <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {preview.description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatLocalEndpoint(usage: TerminalPortUsage) {
  const host = openUrlHostForAddress(usage.address);
  if (host === "localhost") {
    return `:${usage.port}`;
  }
  return `${host}:${usage.port}`;
}

function getDistinctCommand(usage: TerminalPortUsage) {
  const command = usage.lastCommand?.trim();
  if (!command) {
    return null;
  }
  if (command === usage.tabTitle.trim()) {
    return null;
  }
  return command;
}

export function getPortBadges(
  usage: TerminalPortUsage,
  preview: PortPreviewMetadata | null = null,
) {
  return [
    inferServiceBadge(usage, preview),
    inferBindingBadge(usage.address),
  ].filter((badge): badge is string => Boolean(badge));
}

export function inferServiceBadge(
  usage: TerminalPortUsage,
  preview: PortPreviewMetadata | null = null,
) {
  if (preview?.frameworkId) {
    return labelForPortPreviewFramework(preview.frameworkId);
  }

  const haystack = [
    usage.lastCommand,
    usage.tabTitle,
    usage.processName,
    preview?.title,
    preview?.siteName,
    preview?.url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const inferredFrameworkId = inferFrameworkIdFromText(haystack);
  if (inferredFrameworkId) {
    return labelForPortPreviewFramework(inferredFrameworkId);
  }

  if (usage.port === 5432) return "Postgres";
  if (usage.port === 6379) return "Redis";
  if (usage.port === 3306) return "MySQL";
  if (usage.port === 27017) return "MongoDB";

  if (preview?.title || preview?.description || preview?.siteName) return "Web app";
  if (haystack.includes("node") || haystack.includes("bun")) return "Node";

  return null;
}

function inferFrameworkIdFromText(haystack: string): PortPreviewFrameworkId | null {
  for (const framework of PORT_PREVIEW_FRAMEWORKS) {
    if (framework.commandKeywords.some((keyword) => haystack.includes(keyword))) {
      return framework.id;
    }
  }
  return null;
}

export function inferBindingBadge(address: string) {
  const normalized = address.trim().toLowerCase();
  if (
    normalized === "*" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  ) {
    return "Network visible";
  }
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return "Local only";
  }
  return "Specific host";
}

function ScrollEdge({
  direction,
  visible,
  onClick,
}: {
  direction: "left" | "right";
  visible: boolean;
  onClick: () => void;
}) {
  const isLeft = direction === "left";
  const Chevron = isLeft ? RiArrowLeftSLine : RiArrowRightSLine;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? "Scroll ports left" : "Scroll ports right"}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "absolute inset-y-0 z-10 flex cursor-pointer items-center justify-center rounded-md px-1 text-muted-foreground transition-[opacity,color,background-color,transform] duration-150 ease-out hover:bg-foreground/5 hover:text-foreground active:scale-90",
        isLeft ? "left-0" : "right-0",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <Chevron className="size-4" />
    </button>
  );
}

function ProjectAvatar({
  project,
  projectId,
}: {
  project: PortUsageProjectInfo | undefined;
  projectId: string;
}) {
  if (project?.iconUrl) {
    return (
      <img
        src={project.iconUrl}
        alt=""
        draggable={false}
        className="size-7 shrink-0 rounded-md object-cover"
      />
    );
  }

  return (
    <SeededAvatar
      seed={project?.path || projectId}
      displayValue={project?.name ?? projectId}
      variant="character"
      rounded="md"
      size="default"
      className="size-7 shrink-0"
    />
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 break-all",
          mono ? "font-mono" : undefined,
        )}
      >
        {value}
      </dd>
    </div>
  );
}
