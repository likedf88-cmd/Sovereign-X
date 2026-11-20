import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const AUDIO_STORAGE_KEY = 'sovereign_x_audio_muted';

export type UiSfxKind = 'click' | 'nav' | 'like' | 'repost' | 'share' | 'post' | 'story';

interface GlobalAudioContextValue {
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  playUiSfx: (kind: UiSfxKind) => void;
  getAudioContext: () => AudioContext | null;
}

const GlobalAudioContext = createContext<GlobalAudioContextValue>({
  isMuted: false,
  setMuted: () => {},
  toggleMute: () => {},
  playUiSfx: () => {},
  getAudioContext: () => null,
});

function readStoredMuteState(): boolean {
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export const GlobalAudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMuted, setIsMutedState] = useState<boolean>(() => readStoredMuteState());
  const isMutedRef = useRef<boolean>(isMuted);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientMasterGainRef = useRef<GainNode | null>(null);
  const ambientStartedRef = useRef<boolean>(false);

  const getOrCreateAudioContext = useCallback((): AudioContext | null => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const ensureAmbientPadStarted = useCallback(() => {
    if (ambientStartedRef.current || isMutedRef.current) return;
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    try {
      // Soft atmospheric Sovereign Sanctuary drone (two warm detuned oscillators + lowpass LFO)
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(isMutedRef.current ? 0.0001 : 0.016, ctx.currentTime + 1.4);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, ctx.currentTime);
      filter.Q.setValueAtTime(1.2, ctx.currentTime);

      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(110, ctx.currentTime); // A2

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(164.81, ctx.currentTime); // E3 fifth

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(220.4, ctx.currentTime); // Subtle detuned A3 shimmer

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.14, ctx.currentTime);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(140, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      const subGain1 = ctx.createGain();
      subGain1.gain.setValueAtTime(0.55, ctx.currentTime);
      const subGain2 = ctx.createGain();
      subGain2.gain.setValueAtTime(0.24, ctx.currentTime);
      const subGain3 = ctx.createGain();
      subGain3.gain.setValueAtTime(0.18, ctx.currentTime);

      osc1.connect(subGain1);
      osc2.connect(subGain2);
      osc3.connect(subGain3);
      subGain1.connect(filter);
      subGain2.connect(filter);
      subGain3.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc3.start();
      lfo.start();

      ambientMasterGainRef.current = masterGain;
      ambientStartedRef.current = true;
    } catch {
      // Web Audio blocked until next gesture
    }
  }, [getOrCreateAudioContext]);

  const syncMuteToAudioGraph = useCallback(
    (muted: boolean) => {
      const ctx = audioCtxRef.current;
      const master = ambientMasterGainRef.current;
      if (ctx && master) {
        try {
          const now = ctx.currentTime;
          master.gain.cancelScheduledValues(now);
          if (muted) {
            master.gain.setTargetAtTime(0.0001, now, 0.06);
          } else {
            if (ctx.state === 'suspended') {
              void ctx.resume().catch(() => {});
            }
            master.gain.setTargetAtTime(0.016, now, 0.25);
          }
        } catch {
          // ignore
        }
      } else if (!muted) {
        ensureAmbientPadStarted();
      }
    },
    [ensureAmbientPadStarted],
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      isMutedRef.current = muted;
      setIsMutedState(muted);
      try {
        window.localStorage.setItem(AUDIO_STORAGE_KEY, String(muted));
      } catch {
        // ignore storage quota
      }
      syncMuteToAudioGraph(muted);
    },
    [syncMuteToAudioGraph],
  );

  const toggleMute = useCallback(() => {
    setMuted(!isMutedRef.current);
  }, [setMuted]);

  const playUiSfx = useCallback(
    (kind: UiSfxKind) => {
      if (isMutedRef.current) return;
      ensureAmbientPadStarted();
      const ctx = getOrCreateAudioContext();
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (kind === 'like') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(523.25, now);
          osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.09);
          gain.gain.setValueAtTime(0.055, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
          osc.start(now);
          osc.stop(now + 0.15);
        } else if (kind === 'repost') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.setValueAtTime(587.33, now + 0.06);
          osc.frequency.setValueAtTime(880, now + 0.12);
          gain.gain.setValueAtTime(0.055, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          osc.start(now);
          osc.stop(now + 0.21);
        } else if (kind === 'share') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(659.25, now);
          osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.1);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
          osc.start(now);
          osc.stop(now + 0.17);
        } else if (kind === 'story' || kind === 'post') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(392, now);
          osc.frequency.setValueAtTime(523.25, now + 0.07);
          osc.frequency.setValueAtTime(783.99, now + 0.14);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
          osc.start(now);
          osc.stop(now + 0.29);
        } else if (kind === 'nav') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(330, now);
          osc.frequency.exponentialRampToValueAtTime(440, now + 0.05);
          gain.gain.setValueAtTime(0.03, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
          osc.start(now);
          osc.stop(now + 0.08);
        } else {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(420, now);
          gain.gain.setValueAtTime(0.03, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.06);
        }
      } catch {
        // ignore audio errors
      }
    },
    [ensureAmbientPadStarted, getOrCreateAudioContext],
  );

  // Unlock subtle ambient soundscape cleanly on first user pointer/key interaction when not muted
  useEffect(() => {
    const onFirstGesture = () => {
      if (!isMutedRef.current) {
        ensureAmbientPadStarted();
      }
    };
    window.addEventListener('pointerdown', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, [ensureAmbientPadStarted]);

  // Cross-tab localStorage sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUDIO_STORAGE_KEY && e.newValue !== null) {
        const next = e.newValue === 'true';
        isMutedRef.current = next;
        setIsMutedState(next);
        syncMuteToAudioGraph(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncMuteToAudioGraph]);

  return (
    <GlobalAudioContext.Provider
      value={{
        isMuted,
        setMuted,
        toggleMute,
        playUiSfx,
        getAudioContext: getOrCreateAudioContext,
      }}
    >
      {children}
    </GlobalAudioContext.Provider>
  );
};

export function useGlobalAudio(): GlobalAudioContextValue {
  return useContext(GlobalAudioContext);
}
