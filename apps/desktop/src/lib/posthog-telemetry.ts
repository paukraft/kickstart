import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type DailyAppUsedTrigger = "app-activate" | "app-opened" | "window-focus";

export interface DesktopTelemetryContext {
  appLocale: string | null;
  inferredCountryCode: string | null;
  isPackaged: boolean;
  osRelease: string;
  osVersion: string | null;
  platform: NodeJS.Platform;
  preferredSystemLanguages: readonly string[];
  runningUnderArm64Translation: boolean;
  systemLocale: string | null;
  timezone: string | null;
}

interface TelemetryState {
  lastSentUtcDate: string | null;
}

interface DesktopTelemetryClientArgs {
  appVersion: string;
  config: PostHogConfig;
  context: DesktopTelemetryContext;
  productName: string;
  userDataPath: string;
}

type TelemetryProperties = Readonly<Record<string, unknown>>;

interface PostHogConfig {
  enabled: boolean;
  host: string;
  key: string | null;
}

export interface EmbeddedPostHogConfig {
  enabled?: boolean | null;
  host?: string | null;
  key?: string | null;
}

const DAILY_APP_USED_EVENT = "desktop_app_used";
const TELEMETRY_STATE_FILE = "telemetry-state.json";
const SHARED_DISTINCT_ID = "kickstart-desktop-anonymous";

function normalizePostHogHost(host: string | undefined): string {
  const normalized = host?.trim();
  return normalized?.length ? normalized.replace(/\/+$/, "") : "https://eu.i.posthog.com";
}

export function resolvePostHogConfig(embedded?: EmbeddedPostHogConfig | null): PostHogConfig {
  const rawEnabled = process.env.KICKSTART_TELEMETRY_ENABLED?.trim().toLowerCase();
  const enabled =
    rawEnabled === undefined
      ? embedded?.enabled ?? true
      : rawEnabled !== "0" && rawEnabled !== "false";
  const key = process.env.KICKSTART_POSTHOG_KEY?.trim() || embedded?.key?.trim() || null;

  return {
    enabled,
    host: normalizePostHogHost(process.env.KICKSTART_POSTHOG_HOST ?? embedded?.host ?? undefined),
    key,
  };
}

export function getUtcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function shouldSendDailyAppUsed(args: {
  lastSentUtcDate: string | null;
  now?: Date;
}): boolean {
  return args.lastSentUtcDate !== getUtcDateKey(args.now ?? new Date());
}

export class DesktopTelemetryClient {
  private readonly appVersion: string;
  private readonly config: PostHogConfig;
  private readonly context: DesktopTelemetryContext;
  private readonly productName: string;
  private readonly statePath: string;
  private lastSentUtcDate: string | null = null;
  private loadStatePromise: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(args: DesktopTelemetryClientArgs) {
    this.appVersion = args.appVersion;
    this.config = args.config;
    this.context = args.context;
    this.productName = args.productName;
    this.statePath = path.join(args.userDataPath, TELEMETRY_STATE_FILE);
  }

  trackDailyAppUsed(
    trigger: DailyAppUsedTrigger,
    properties?: TelemetryProperties,
  ): Promise<void> {
    this.queue = this.queue
      .then(() => this.trackDailyAppUsedNow(trigger, properties))
      .catch((error) => {
        console.error("[desktop-telemetry] Failed to record daily app use:", error);
      });

    return this.queue;
  }

  async shouldTrackDailyAppUsed(now: Date = new Date()): Promise<boolean> {
    if (!this.config.enabled || !this.config.key) {
      return false;
    }

    await this.loadState();
    return shouldSendDailyAppUsed({ lastSentUtcDate: this.lastSentUtcDate, now });
  }

  private async trackDailyAppUsedNow(
    trigger: DailyAppUsedTrigger,
    properties?: TelemetryProperties,
  ): Promise<void> {
    if (!this.config.enabled || !this.config.key) {
      return;
    }

    await this.loadState();

    const now = new Date();
    const utcDate = getUtcDateKey(now);
    if (!shouldSendDailyAppUsed({ lastSentUtcDate: this.lastSentUtcDate, now })) {
      return;
    }

    const response = await fetch(`${this.config.host}/batch/`, {
      body: JSON.stringify({
        api_key: this.config.key,
        batch: [{
          distinct_id: SHARED_DISTINCT_ID,
          event: DAILY_APP_USED_EVENT,
          properties: {
            $process_person_profile: false,
            appLocale: this.context.appLocale,
            appVersion: this.appVersion,
            arch: process.arch,
            inferredCountryCode: this.context.inferredCountryCode,
            isPackaged: this.context.isPackaged,
            osRelease: this.context.osRelease,
            osVersion: this.context.osVersion,
            platform: this.context.platform,
            preferredSystemLanguages: this.context.preferredSystemLanguages,
            product: this.productName,
            runningUnderArm64Translation: this.context.runningUnderArm64Translation,
            systemLocale: this.context.systemLocale,
            timezone: this.context.timezone,
            trigger,
            utcDate,
            ...properties,
          },
          timestamp: now.toISOString(),
        }],
      }),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `${this.productName} Desktop`,
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`PostHog responded with ${response.status}.`);
    }

    this.lastSentUtcDate = utcDate;
    await this.persistState();
  }

  private async loadState(): Promise<void> {
    if (this.loadStatePromise) {
      return this.loadStatePromise;
    }

    this.loadStatePromise = (async () => {
      try {
        const raw = await readFile(this.statePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<TelemetryState>;
        this.lastSentUtcDate =
          typeof parsed.lastSentUtcDate === "string" ? parsed.lastSentUtcDate : null;
      } catch {
        this.lastSentUtcDate = null;
      }
    })();

    return this.loadStatePromise;
  }

  private async persistState(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(
      this.statePath,
      JSON.stringify(
        {
          lastSentUtcDate: this.lastSentUtcDate,
        } satisfies TelemetryState,
        null,
        2,
      ),
      "utf8",
    );
  }
}
