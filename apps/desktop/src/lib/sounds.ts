import {
  RiNotification3Line,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";

import type { SoundId } from "@kickstart/contracts";
import type { ComponentType } from "react";

interface Tone {
  freq: number;
  start: number;
  vol: number;
  decay: number;
}

export interface SoundMeta {
  id: SoundId | null;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const sounds = {
  neutral: [
    { freq: 440, start: 0, vol: 0.25, decay: 0.12 },
    { freq: 523, start: 0.09, vol: 0.2, decay: 0.12 },
  ],
  happy: [
    { freq: 440, start: 0, vol: 0.25, decay: 0.1 },
    { freq: 554, start: 0.08, vol: 0.22, decay: 0.1 },
    { freq: 660, start: 0.16, vol: 0.18, decay: 0.14 },
  ],
} satisfies Record<SoundId, Tone[]>;

export const SOUND_OPTIONS: SoundMeta[] = [
  { id: null, label: "None", icon: RiVolumeMuteLine },
  { id: "neutral", label: "Neutral", icon: RiNotification3Line },
  { id: "happy", label: "Happy", icon: RiVolumeUpLine },
];

let audioContext: AudioContext | null = null;
let unlockHandlersInstalled = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

async function ensureAudioContextReady() {
  const ctx = getAudioContext();
  if (!ctx) {
    return null;
  }
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }
  return ctx.state === "running" ? ctx : null;
}

export function installSoundAutoplayUnlock() {
  if (unlockHandlersInstalled || typeof window === "undefined") {
    return;
  }

  const unlock = () => {
    void ensureAudioContextReady().then((ctx) => {
      if (!ctx) {
        return;
      }
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("pointerdown", unlock, true);
      unlockHandlersInstalled = false;
    });
  };

  window.addEventListener("keydown", unlock, true);
  window.addEventListener("pointerdown", unlock, true);
  unlockHandlersInstalled = true;
}

export async function playSound(id: SoundId) {
  const ctx = await ensureAudioContextReady();
  if (!ctx) {
    return false;
  }
  const t = ctx.currentTime;

  for (const tone of sounds[id]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.freq, t + tone.start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(tone.vol, t + tone.start);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      t + tone.start + tone.decay,
    );

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t + tone.start);
    osc.stop(t + tone.start + tone.decay + 0.01);

    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  return true;
}
