import React, { useState } from 'react';
import {
  Upload,
  Download,
  Undo2,
  Redo2,
  ShieldCheck,
  Save,
  Sparkles,
  Bone as BoneIcon,
  Paintbrush,
  GitBranch,
  Film,
  ChevronDown,
  Rocket,
  FolderOpen,
  Box,
  ScanSearch,
  Database,
  Sliders,
} from 'lucide-react';
import type { SkeletonPresetType, StudioWorkspaceMode } from '../../types';

interface StudioTopToolbarProps {
  modelName: string;
  onChangeModelName: (name: string) => void;
  workspaceMode: StudioWorkspaceMode;
  onChangeWorkspaceMode: (mode: StudioWorkspaceMode) => void;
  skeletonPreset: SkeletonPresetType;
  onApplyPreset: (preset: SkeletonPresetType) => void;
  onScanAndRepairRig: () => void;
  scanningRig?: boolean;
  onImportFiles: (files: FileList) => void;
  onLoadStarter: (variant: 'knight' | 'vanguard') => void;
  onExportGLB: () => void;
  onExportGLTF: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  validationIssueCount: number;
  validationErrorCount: number;
  onOpenValidation: () => void;
  onSaveProject: () => void;
  savedProjects: Array<{ id: string; name: string; updatedAt: string }>;
  onLoadSavedProject: (id: string) => void;
  isBound: boolean;
  onToggleBind: () => void;
  onTestInLounge: () => void;
  isAdmin: boolean;
  publishing: boolean;
  onOpenPublishModal: () => void;
  savingLibrary?: boolean;
  onSaveToLibrary?: () => void;
}

const MODE_TABS: Array<{
  id: StudioWorkspaceMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'object', label: 'Object', icon: Box },
  { id: 'edit', label: 'Edit Mode', icon: BoneIcon },
  { id: 'pose', label: 'Pose Mode', icon: Sliders },
  { id: 'weights', label: 'Weight Paint', icon: Paintbrush },
  { id: 'ikfk', label: 'IK / FK', icon: GitBranch },
  { id: 'animation', label: 'Animation', icon: Film },
];

export const StudioTopToolbar: React.FC<StudioTopToolbarProps> = ({
  modelName,
  onChangeModelName,
  workspaceMode,
  onChangeWorkspaceMode,
  skeletonPreset,
  onApplyPreset,
  onScanAndRepairRig,
  scanningRig = false,
  onImportFiles,
  onLoadStarter,
  onExportGLB,
  onExportGLTF,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  validationIssueCount,
  validationErrorCount,
  onOpenValidation,
  onSaveProject,
  savedProjects,
  onLoadSavedProject,
  isBound,
  onToggleBind,
  onTestInLounge,
  isAdmin,
  publishing,
  onOpenPublishModal,
  savingLibrary = false,
  onSaveToLibrary,
}) => {
  const [menuOpen, setMenuOpen] = useState<'auto' | 'export' | 'saved' | null>(null);

  return (
    <div className="bg-[#16181D] border-b border-white/[0.08] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 select-none relative z-30">
      {/* Left: Asset Name, Import, Starter Meshes, Auto-Rig, Scan & Repair Rig, Export */}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={modelName}
          onChange={(e) => onChangeModelName(e.target.value)}
          aria-label="Character Rig Name"
          className="w-36 sm:w-44 px-2 py-1 rounded bg-[#111317] border border-white/[0.08] text-xs font-medium text-slate-100 focus:outline-none focus:border-[#E5A93B]"
        />

        <label className="cursor-pointer px-2.5 py-1 rounded bg-[#2A2F3A] hover:bg-[#343B48] border border-white/10 text-slate-100 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors">
          <Upload className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Import Character</span>
          <input
            type="file"
            multiple
            accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.bmp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onImportFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </label>

        {/* Starter Presets */}
        <div className="hidden xl:flex items-center bg-[#1D2026] border border-white/[0.08] rounded p-0.5">
          <button
            type="button"
            onClick={() => onLoadStarter('knight')}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-slate-300 hover:bg-white/5 hover:text-white whitespace-nowrap"
          >
            Knight
          </button>
          <button
            type="button"
            onClick={() => onLoadStarter('vanguard')}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-slate-300 hover:bg-white/5 hover:text-white whitespace-nowrap"
          >
            Vanguard
          </button>
        </div>

        {/* Auto-Rig Dropdown */}
        <div className="relative">
          <button
            type="button"
            disabled={isBound}
            onClick={() => setMenuOpen((m) => (m === 'auto' ? null : 'auto'))}
            className="px-2.5 py-1 rounded bg-[#1F232B] hover:bg-[#2A2F3A] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center gap-1 disabled:opacity-40 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#E5A93B]" />
            <span>Auto-Rig</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          {menuOpen === 'auto' && !isBound && (
            <div className="absolute left-0 mt-1 w-60 rounded bg-[#1E2128] border border-white/15 shadow-2xl p-1 z-40 space-y-0.5">
              {(
                [
                  { id: 'full-33', title: 'Full Humanoid (33 Bones)', sub: 'Head, Jaw, 10 Fingers, Feet & Toes' },
                  { id: 'ultra-45', title: 'Ultra Rig (45 Bones)', sub: 'Eyes, 2-Joint Fingers, Crown & Jaw' },
                  { id: 'stylized-anime', title: 'Stylized / Anime (45)', sub: 'Proportional big-head & eye rig' },
                  { id: 'simple-15', title: 'Game-Ready Core (15)', sub: 'Lightweight mobile & LOD rig' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onApplyPreset(opt.id);
                    setMenuOpen(null);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${
                    skeletonPreset === opt.id
                      ? 'bg-[#E5A93B]/15 text-[#FDE68A]'
                      : 'text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <div className="font-medium">{opt.title}</div>
                  <div className="text-[10px] text-slate-400">{opt.sub}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dedicated Scan & Repair Rig Button */}
        <button
          type="button"
          disabled={scanningRig}
          onClick={onScanAndRepairRig}
          title="Validate GLB skeleton, detect missing bones, rescale to 1.9m humanoid base & highlight mesh topology issues"
          className="px-2.5 py-1 rounded bg-[#2B2518] hover:bg-[#3A311D] border border-[#E5A93B]/50 text-xs font-semibold text-[#FDE68A] flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap transition-colors"
        >
          <ScanSearch className="w-3.5 h-3.5 text-[#E5A93B]" />
          <span>{scanningRig ? 'Scanning GLB...' : 'Scan & Repair Rig'}</span>
        </button>

        {/* Export Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((m) => (m === 'export' ? null : 'export'))}
            className="px-2.5 py-1 rounded bg-[#1F232B] hover:bg-[#2A2F3A] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center gap-1 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export GLB</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          {menuOpen === 'export' && (
            <div className="absolute left-0 mt-1 w-48 rounded bg-[#1E2128] border border-white/15 shadow-2xl p-1 z-40 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  onExportGLB();
                  setMenuOpen(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded text-xs text-slate-200 hover:bg-white/5"
              >
                <div className="font-medium">Export .GLB (Binary)</div>
                <div className="text-[10px] text-slate-400">Mesh + Skeleton + Clips</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportGLTF();
                  setMenuOpen(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded text-xs text-slate-200 hover:bg-white/5"
              >
                <div className="font-medium">Export .GLTF (JSON)</div>
                <div className="text-[10px] text-slate-400">Embedded buffers & weights</div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Segmented Workspace Mode Switcher */}
      <div className="flex items-center bg-[#111317] border border-white/[0.08] rounded p-0.5">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = workspaceMode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeWorkspaceMode(tab.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#2B303A] text-white border border-white/10'
                  : 'text-slate-400 hover:text-slate-100 border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#E5A93B]' : ''}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Undo/Redo, Validate, Save/Load, Bind, Test & Publish */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center bg-[#1D2026] border border-white/[0.08] rounded p-0.5">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Ctrl+Z)"
            className="p-1 rounded text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-30"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Ctrl+Y)"
            className="p-1 rounded text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-30"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenValidation}
          className={`px-2 py-1 rounded border text-xs font-medium flex items-center gap-1 tabular-nums whitespace-nowrap ${
            validationErrorCount > 0
              ? 'bg-red-950/50 border-red-500/40 text-red-200'
              : validationIssueCount > 0
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-[#1F232B] border-white/[0.08] text-emerald-300 hover:bg-[#2A2F3A]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Audit</span>
          {validationIssueCount > 0 && (
            <span className="font-mono text-[11px]">({validationIssueCount})</span>
          )}
        </button>

        {/* Save & Load */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={onSaveProject}
            className="px-2 py-1 rounded-l bg-[#1F232B] hover:bg-[#2A2F3A] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center gap-1 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 text-sky-400" />
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((m) => (m === 'saved' ? null : 'saved'))}
            title="Load Saved Project"
            className="px-1.5 py-1 rounded-r bg-[#1F232B] hover:bg-[#2A2F3A] border-y border-r border-white/[0.08] text-slate-300"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          {menuOpen === 'saved' && (
            <div className="absolute right-0 top-full mt-1 w-60 rounded bg-[#1E2128] border border-white/15 shadow-2xl p-1.5 z-40 space-y-1">
              <div className="px-2 py-1 text-[10px] tracking-wider text-slate-400 font-semibold">
                Saved Rig Projects
              </div>
              {savedProjects.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-500">No saved projects yet.</div>
              ) : (
                savedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onLoadSavedProject(p.id);
                      setMenuOpen(null);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-slate-200 hover:bg-white/5"
                  >
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-400 tabular-nums">{p.updatedAt}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleBind}
          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap border ${
            isBound
              ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white'
              : 'bg-[#E5A93B] hover:bg-[#EEB852] border-[#E5A93B] text-slate-950'
          }`}
        >
          <span>{isBound ? 'Bound · Edit Rest' : 'Bind Rig'}</span>
        </button>

        <button
          type="button"
          onClick={onTestInLounge}
          className="hidden xl:flex px-2.5 py-1 rounded bg-[#1F232B] hover:bg-[#2A2F3A] border border-white/[0.08] text-xs font-medium text-slate-200 whitespace-nowrap"
        >
          Test in Lounge
        </button>

        {isAdmin && onSaveToLibrary && (
          <button
            type="button"
            disabled={savingLibrary || publishing}
            onClick={onSaveToLibrary}
            title="Upload GLB & save character directly to Global Character Library (available in 3D Lounge)"
            className="px-2.5 py-1 rounded bg-[#182232] hover:bg-[#223047] border border-sky-400/40 text-xs font-semibold text-sky-200 flex items-center gap-1 disabled:opacity-40 whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5 text-sky-400" />
            <span>{savingLibrary ? 'Saving...' : 'Save to Library'}</span>
          </button>
        )}

        {isAdmin && (
          <button
            type="button"
            disabled={publishing}
            onClick={onOpenPublishModal}
            className="px-2.5 py-1 rounded bg-[#2B2518] hover:bg-[#3A311D] border border-[#E5A93B]/40 text-xs font-semibold text-[#FDE68A] flex items-center gap-1 disabled:opacity-40 whitespace-nowrap"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Publish</span>
          </button>
        )}
      </div>
    </div>
  );
};
