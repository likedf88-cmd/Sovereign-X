import React, { useMemo, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Repeat,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Download,
  Upload,
  Layers,
} from 'lucide-react';
import type { AnimationKeyframe, AvatarEmote } from '../../types';

export type ActiveClipSource =
  | { kind: 'preset'; emote: AvatarEmote }
  | { kind: 'custom' }
  | { kind: 'native'; index: number; name: string };

interface StudioBottomTimelineProps {
  isBound: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStopAndReset: () => void;
  loop: boolean;
  onToggleLoop: () => void;
  speed: number;
  onChangeSpeed: (s: number) => void;
  currentTime: number;
  duration: number;
  onScrubTime: (t: number) => void;
  onChangeDuration: (d: number) => void;
  activeClip: ActiveClipSource;
  onSelectClip: (clip: ActiveClipSource) => void;
  nativeClipNames: string[];
  keyframes: AnimationKeyframe[];
  selectedKeyframeId: string | null;
  onSelectKeyframe: (id: string) => void;
  onInsertKeyframe: () => void;
  onDeleteSelectedKeyframe: () => void;
  onExportAnimationJSON?: () => void;
  onImportAnimationFile?: (file: File) => void;
}

const PRESET_CLIPS: Array<{ id: AvatarEmote; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'walk', label: 'Walk' },
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'combat', label: 'Combat' },
  { id: 'wave', label: 'Wave' },
  { id: 'dance', label: 'Dance' },
  { id: 'hero', label: 'Hero' },
];

export const StudioBottomTimeline: React.FC<StudioBottomTimelineProps> = ({
  isBound,
  isPlaying,
  onTogglePlay,
  onStopAndReset,
  loop,
  onToggleLoop,
  speed,
  onChangeSpeed,
  currentTime,
  duration,
  onScrubTime,
  onChangeDuration,
  activeClip,
  onSelectClip,
  nativeClipNames,
  keyframes,
  selectedKeyframeId,
  onSelectKeyframe,
  onInsertKeyframe,
  onDeleteSelectedKeyframe,
  onExportAnimationJSON,
  onImportAnimationFile,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showDopeSheet, setShowDopeSheet] = useState(false);

  const dopeChannels = useMemo(() => {
    const names = new Set<string>();
    keyframes.forEach((kf) => {
      Object.keys(kf.boneTransforms).forEach((b) => names.add(b));
    });
    return Array.from(names).slice(0, 12);
  }, [keyframes]);

  return (
    <div className="bg-[#16181D] border-t border-white/[0.08] select-none">
      {/* Transport Header Bar */}
      <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white"
            title={collapsed ? 'Expand Timeline' : 'Collapse Timeline'}
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 border ${
              isPlaying
                ? 'bg-[#E5A93B] border-[#E5A93B] text-slate-950'
                : 'bg-[#2A2F3A] hover:bg-[#343B48] border-white/10 text-white'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={onStopAndReset}
            title="Stop & Reset Pose"
            className="p-1.5 rounded bg-[#1D2026] hover:bg-[#2A2F3A] border border-white/[0.08] text-slate-200"
          >
            <Square className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={onStopAndReset}
            className="px-2 py-1 rounded bg-[#1D2026] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-300 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Pose</span>
          </button>

          <button
            type="button"
            onClick={onToggleLoop}
            className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 ${
              loop
                ? 'bg-[#2B2518] border-[#E5A93B]/50 text-[#FDE68A]'
                : 'bg-[#1D2026] border-white/[0.08] text-slate-400'
            }`}
          >
            <Repeat className="w-3 h-3" />
            <span>Loop</span>
          </button>

          {/* Clip Selector */}
          <div className="flex items-center gap-1 pl-1 overflow-x-auto max-w-[460px]">
            {PRESET_CLIPS.map((c) => {
              const active = activeClip.kind === 'preset' && activeClip.emote === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectClip({ kind: 'preset', emote: c.id })}
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap border ${
                    active
                      ? 'bg-[#E5A93B] border-[#E5A93B] text-slate-950 font-semibold'
                      : 'bg-[#1D2026] text-slate-300 hover:text-white border-white/[0.08]'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSelectClip({ kind: 'custom' })}
              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap border ${
                activeClip.kind === 'custom'
                  ? 'bg-emerald-500 border-emerald-500 text-slate-950 font-semibold'
                  : 'bg-[#1D2026] text-emerald-300 border-emerald-500/30 hover:bg-emerald-950/30'
              }`}
            >
              Custom ({keyframes.length})
            </button>
            {nativeClipNames.map((n, idx) => (
              <button
                key={`${n}_${idx}`}
                type="button"
                onClick={() => onSelectClip({ kind: 'native', index: idx, name: n })}
                className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap border ${
                  activeClip.kind === 'native' && activeClip.index === idx
                    ? 'bg-sky-500 border-sky-500 text-slate-950 font-semibold'
                    : 'bg-[#1D2026] text-sky-300 border-sky-500/30'
                }`}
              >
                GLB: {n}
              </button>
            ))}
          </div>
        </div>

        {/* Speed, Duration & Keyframe Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span>Speed</span>
            <input
              type="range"
              min={0.1}
              max={2.5}
              step={0.1}
              value={speed}
              onChange={(e) => onChangeSpeed(Number(e.target.value))}
              className="w-16 accent-[#E5A93B]"
            />
            <span className="font-mono w-9 text-right">{speed.toFixed(1)}x</span>
          </div>

          <div className="font-mono text-xs text-slate-100 bg-[#111317] border border-white/[0.08] rounded px-2 py-0.5">
            {currentTime.toFixed(2)}s / {duration.toFixed(1)}s
          </div>

          <button
            type="button"
            onClick={onInsertKeyframe}
            className="px-2 py-1 rounded bg-[#E5A93B] hover:bg-[#EEB852] text-slate-950 text-[11px] font-semibold flex items-center gap-1"
            title={isBound ? 'Record Pose Keyframe at Playhead' : 'Auto-Bind & Record Keyframe'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Keyframe</span>
          </button>

          <button
            type="button"
            disabled={!selectedKeyframeId}
            onClick={onDeleteSelectedKeyframe}
            className="p-1 rounded bg-[#1D2026] hover:bg-red-950/60 border border-white/[0.08] text-red-300 disabled:opacity-30"
            title="Delete Selected Keyframe"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowDopeSheet((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 ${
              showDopeSheet
                ? 'bg-[#2B303A] border-[#E5A93B]/60 text-[#FDE68A]'
                : 'bg-[#1D2026] border-white/[0.08] text-slate-300 hover:text-white'
            }`}
            title="Toggle Per-Bone Dope Sheet Channels"
          >
            <Layers className="w-3 h-3" />
            <span>Dope Sheet</span>
          </button>

          {onImportAnimationFile && (
            <label
              className="cursor-pointer px-2 py-1 rounded bg-[#1D2026] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-sky-300 flex items-center gap-1"
              title="Import Animation Clip (.json or .glb/.gltf)"
            >
              <Upload className="w-3 h-3" />
              <span>Import Clip</span>
              <input
                type="file"
                accept=".json,.glb,.gltf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportAnimationFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          {onExportAnimationJSON && (
            <button
              type="button"
              disabled={keyframes.length === 0}
              onClick={onExportAnimationJSON}
              className="px-2 py-1 rounded bg-[#1D2026] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-emerald-300 flex items-center gap-1 disabled:opacity-35"
              title="Export Custom Keyframes (.json)"
            >
              <Download className="w-3 h-3" />
              <span>Export Clip</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrubbable Dope Sheet */}
      {!collapsed && (
        <div className="px-3 py-2 space-y-1.5 bg-[#121419]">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 font-medium w-24 shrink-0">
              Timeline
            </span>
            <div className="relative flex-1 h-7 bg-[#1A1D24] border border-white/[0.08] rounded flex items-center px-2">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.02}
                value={Math.min(currentTime, duration)}
                onChange={(e) => onScrubTime(Number(e.target.value))}
                className="w-full accent-[#E5A93B] relative z-10"
              />
              {/* Keyframe Diamonds */}
              {keyframes.map((kf) => {
                const pct = Math.max(0, Math.min(100, (kf.time / Math.max(duration, 0.1)) * 100));
                const isSel = kf.id === selectedKeyframeId;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    onClick={() => {
                      onSelectKeyframe(kf.id);
                      onScrubTime(kf.time);
                    }}
                    style={{ left: `calc(${pct}% - 5px)` }}
                    title={`Keyframe @ ${kf.time.toFixed(2)}s (${Object.keys(kf.boneTransforms).length} bones)`}
                    className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 z-20 border transition-transform ${
                      isSel
                        ? 'bg-[#E5A93B] border-white scale-125'
                        : 'bg-emerald-400 border-slate-900 hover:scale-125'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0">
              <span>Len</span>
              <input
                type="number"
                min={1}
                max={12}
                step={0.5}
                value={duration}
                onChange={(e) => onChangeDuration(Math.max(1, Math.min(12, Number(e.target.value) || 3)))}
                className="w-12 px-1 py-0.5 rounded bg-[#1A1D24] border border-white/[0.08] font-mono text-white"
              />
              <span>s</span>
            </div>
          </div>

          {showDopeSheet && (
            <div className="pt-1 border-t border-white/[0.06] max-h-28 overflow-y-auto space-y-1">
              {dopeChannels.length === 0 ? (
                <div className="text-[11px] text-slate-500 py-1 px-1">
                  No custom keyframes recorded yet. Pose the rig and click + Keyframe or Import Clip to inspect per-bone Dope Sheet channels.
                </div>
              ) : (
                dopeChannels.map((boneName) => (
                  <div key={boneName} className="flex items-center gap-3 text-[10px]">
                    <span className="w-24 shrink-0 truncate font-mono text-slate-300">
                      {boneName}
                    </span>
                    <div className="relative flex-1 h-4 bg-[#181B22] border border-white/[0.05] rounded">
                      {keyframes.map((kf) => {
                        if (!kf.boneTransforms[boneName]) return null;
                        const pct = Math.max(0, Math.min(100, (kf.time / Math.max(duration, 0.1)) * 100));
                        const isSel = kf.id === selectedKeyframeId;
                        return (
                          <button
                            key={`${boneName}_${kf.id}`}
                            type="button"
                            onClick={() => {
                              onSelectKeyframe(kf.id);
                              onScrubTime(kf.time);
                            }}
                            style={{ left: `calc(${pct}% - 4px)` }}
                            title={`${boneName} @ ${kf.time.toFixed(2)}s`}
                            className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 ${
                              isSel ? 'bg-[#E5A93B]' : 'bg-sky-400'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
