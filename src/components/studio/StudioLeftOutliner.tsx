import React, { useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Grid,
  Image as ImageIcon,
  Plus,
  Copy,
  Trash2,
  FlipHorizontal2,
  Bone as BoneIcon,
  Layers,
  Search,
  Box,
  PanelLeftClose,
  PanelLeftOpen,
  Link2,
} from 'lucide-react';
import type { BoneNode, ModelStats, SceneMeshInfo } from '../../types';

interface StudioLeftOutlinerProps {
  stats: ModelStats;
  meshes: SceneMeshInfo[];
  selectedMeshUuid: string | null;
  onSelectMesh: (uuid: string) => void;
  onToggleMeshVisible: (uuid: string) => void;
  onToggleMeshWireframe: (uuid: string) => void;
  onAttachTextureToMesh: (uuid: string, file: File) => void;
  bones: BoneNode[];
  selectedBoneIdx: number;
  onSelectBone: (idx: number) => void;
  isBound: boolean;
  onAddChildBone: () => void;
  onAddSymmetryPair: () => void;
  onAddBoneChain?: () => void;
  onDuplicateBone: () => void;
  onDeleteBone: () => void;
  onMirrorSkeletonLR: (dir: 'LtoR' | 'RtoL') => void;
  onClearSkeleton: () => void;
}

interface TreeItem {
  bone: BoneNode;
  idx: number;
  depth: number;
  hasChildren: boolean;
}

export const StudioLeftOutliner: React.FC<StudioLeftOutlinerProps> = ({
  stats,
  meshes,
  selectedMeshUuid,
  onSelectMesh,
  onToggleMeshVisible,
  onToggleMeshWireframe,
  onAttachTextureToMesh,
  bones,
  selectedBoneIdx,
  onSelectBone,
  isBound,
  onAddChildBone,
  onAddSymmetryPair,
  onAddBoneChain,
  onDuplicateBone,
  onDeleteBone,
  onMirrorSkeletonLR,
  onClearSkeleton,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedBones, setCollapsedBones] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'meshes'>('hierarchy');
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const flattenedTree = useMemo<TreeItem[]>(() => {
    const filter = searchQuery.trim().toLowerCase();
    if (filter) {
      return bones
        .map((bone, idx) => ({ bone, idx, depth: 0, hasChildren: false }))
        .filter((item) => item.bone.name.toLowerCase().includes(filter));
    }

    const byParent = new Map<string | null, Array<{ bone: BoneNode; idx: number }>>();
    const boneNames = new Set(bones.map((b) => b.name));

    bones.forEach((bone, idx) => {
      const parentKey = bone.parent && boneNames.has(bone.parent) && bone.parent !== bone.name ? bone.parent : null;
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey)!.push({ bone, idx });
    });

    const out: TreeItem[] = [];
    const visited = new Set<string>();

    const walk = (parentKey: string | null, depth: number) => {
      const children = byParent.get(parentKey) || [];
      for (const entry of children) {
        if (visited.has(entry.bone.name)) continue;
        visited.add(entry.bone.name);
        const childList = byParent.get(entry.bone.name) || [];
        const hasChildren = childList.length > 0;
        out.push({ bone: entry.bone, idx: entry.idx, depth, hasChildren });
        if (hasChildren && !collapsedBones[entry.bone.name]) {
          walk(entry.bone.name, depth + 1);
        }
      }
    };

    walk(null, 0);
    bones.forEach((bone, idx) => {
      if (!visited.has(bone.name)) {
        out.push({ bone, idx, depth: 0, hasChildren: false });
      }
    });
    return out;
  }, [bones, searchQuery, collapsedBones]);

  const filteredMeshes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return meshes;
    return meshes.filter(
      (m) => m.name.toLowerCase().includes(q) || m.materialName.toLowerCase().includes(q),
    );
  }, [meshes, searchQuery]);

  const toggleCollapse = (name: string) => {
    setCollapsedBones((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  if (panelCollapsed) {
    return (
      <aside className="hidden lg:flex w-9 shrink-0 bg-[#1D2026] border-r border-white/[0.08] flex-col items-center py-2.5 gap-3">
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          title="Expand Scene Outliner"
          className="p-1.5 rounded bg-[#16181D] hover:bg-[#2A2F3A] text-slate-300 hover:text-white border border-white/10"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
        </button>
        <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] tracking-wider uppercase text-slate-400 font-medium">
          Outliner ({bones.length})
        </span>
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-[268px] shrink-0 bg-[#1D2026] border-b lg:border-b-0 lg:border-r border-white/[0.08] flex flex-col min-h-0">
      {/* Model Telemetry Strip */}
      <div className="p-2.5 border-b border-white/[0.08]">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] font-medium text-slate-400">Scene Outliner</div>
          <button
            type="button"
            onClick={() => setPanelCollapsed(true)}
            title="Collapse Scene Outliner"
            className="hidden lg:inline-flex p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/5"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 text-xs tabular-nums">
          <div className="bg-[#16181D] border border-white/[0.06] rounded px-2 py-1 flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">Verts</span>
            <span className="font-mono font-medium text-slate-100">{stats.vertices.toLocaleString()}</span>
          </div>
          <div className="bg-[#16181D] border border-white/[0.06] rounded px-2 py-1 flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">Tris</span>
            <span className="font-mono font-medium text-slate-100">{stats.triangles.toLocaleString()}</span>
          </div>
          <div className="bg-[#16181D] border border-white/[0.06] rounded px-2 py-1 flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">Meshes</span>
            <span className="font-mono font-medium text-sky-300">{stats.meshes}</span>
          </div>
          <div className="bg-[#16181D] border border-white/[0.06] rounded px-2 py-1 flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">Mats</span>
            <span className="font-mono font-medium text-[#E5A93B]">{stats.materials}</span>
          </div>
        </div>
        {(stats.morphTargetCount > 0 || stats.animations > 0 || stats.existingBones > 0) && (
          <div className="mt-1.5 text-[10px] text-slate-400 tabular-nums flex flex-wrap gap-x-1.5">
            {stats.existingBones > 0 && <span>Native Bones: {stats.existingBones}</span>}
            {stats.animations > 0 && <span>· Clips: {stats.animations}</span>}
            {stats.morphTargetCount > 0 && <span>· Morphs: {stats.morphTargetCount}</span>}
          </div>
        )}
      </div>

      {/* Outliner Tab Switcher */}
      <div className="flex border-b border-white/[0.08] bg-[#16181D] text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('hierarchy')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === 'hierarchy'
              ? 'border-[#E5A93B] text-white bg-[#1D2026]'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          <BoneIcon className="w-3.5 h-3.5" />
          <span className="tabular-nums">Skeleton ({bones.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('meshes')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === 'meshes'
              ? 'border-[#E5A93B] text-white bg-[#1D2026]'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="tabular-nums">Objects ({meshes.length})</span>
        </button>
      </div>

      {/* Shared Search Filter */}
      <div className="p-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'hierarchy' ? 'Filter bones...' : 'Filter meshes & materials...'}
            className="w-full pl-8 pr-2.5 py-1 rounded bg-[#14161B] border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#E5A93B]"
          />
        </div>
      </div>

      {activeTab === 'hierarchy' ? (
        <div className="flex-1 flex flex-col min-h-0 p-2 space-y-2">
          {/* Bone Manipulation Actions */}
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              disabled={isBound}
              onClick={onAddChildBone}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-[#2F3440] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Plus className="w-3 h-3 text-sky-400" />
              <span>Child</span>
            </button>
            <button
              type="button"
              disabled={isBound}
              onClick={onAddSymmetryPair}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-[#2F3440] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Plus className="w-3 h-3 text-[#E5A93B]" />
              <span>L/R Pair</span>
            </button>
            <button
              type="button"
              disabled={isBound}
              onClick={onDuplicateBone}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-[#2F3440] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Copy className="w-3 h-3" />
              <span>Clone</span>
            </button>
            <button
              type="button"
              disabled={isBound}
              onClick={() => onMirrorSkeletonLR('LtoR')}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-[#2F3440] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <FlipHorizontal2 className="w-3 h-3 text-emerald-400" />
              <span>L→R</span>
            </button>
            <button
              type="button"
              disabled={isBound || bones.length <= 1}
              onClick={onDeleteBone}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-red-950/60 border border-white/[0.08] text-[11px] font-medium text-red-300 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              <span>Del</span>
            </button>
            <button
              type="button"
              disabled={isBound}
              onClick={onClearSkeleton}
              className="px-1.5 py-1 rounded bg-[#252932] hover:bg-[#2F3440] border border-white/[0.08] text-[11px] font-medium text-slate-400 hover:text-white disabled:opacity-40"
            >
              Root 1
            </button>
            {onAddBoneChain && (
              <button
                type="button"
                disabled={isBound}
                onClick={onAddBoneChain}
                title="Create 3-bone chain (tail / wing / hair) under selected bone"
                className="col-span-3 px-2 py-1 rounded bg-[#1E2736] hover:bg-[#273347] border border-sky-500/30 text-[11px] font-medium text-sky-200 flex items-center justify-center gap-1 disabled:opacity-40"
              >
                <Link2 className="w-3 h-3 text-sky-400" />
                <span>+ 3-Bone Chain (Tail / Cape / Wing)</span>
              </button>
            )}
          </div>

          {/* Collapsible Skeleton Hierarchy */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5 max-h-[380px] lg:max-h-none">
            {flattenedTree.map(({ bone, idx, depth, hasChildren }) => {
              const selected = idx === selectedBoneIdx;
              const isCollapsed = Boolean(collapsedBones[bone.name]);
              const isLeft = /^(left|l_)|_l$|\.l$/i.test(bone.name);
              const isRight = /^(right|r_)|_r$|\.r$/i.test(bone.name);
              return (
                <div
                  key={`${bone.name}_${idx}`}
                  style={{ paddingLeft: `${Math.min(depth, 6) * 12 + 4}px` }}
                  className={`flex items-center gap-1.5 pr-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                    selected
                      ? 'bg-[#2C3546] text-white border border-[#38BDF8]/50'
                      : 'text-slate-300 hover:bg-white/[0.04] border border-transparent'
                  }`}
                  onClick={() => onSelectBone(idx)}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(bone.name);
                      }}
                      className="p-0.5 text-slate-400 hover:text-white"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4 inline-block shrink-0" />
                  )}
                  <BoneIcon
                    className={`w-3 h-3 shrink-0 ${
                      selected
                        ? 'text-[#FACC15]'
                        : isLeft
                          ? 'text-sky-400'
                          : isRight
                            ? 'text-orange-400'
                            : bone.parent
                              ? 'text-slate-400'
                              : 'text-emerald-400'
                    }`}
                  />
                  <span className="truncate flex-1 font-medium">{bone.name}</span>
                  {bone.connected && (
                    <span className="font-mono text-[9px] text-sky-300 shrink-0" title="Connected to Parent">
                      LNK
                    </span>
                  )}
                  {bone.constraint?.enabled && (
                    <span className="font-mono text-[9px] text-[#E5A93B] shrink-0">LIM</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[420px] lg:max-h-none">
          {filteredMeshes.map((m) => {
            const isSelected = m.uuid === selectedMeshUuid;
            return (
              <div
                key={m.uuid}
                onClick={() => onSelectMesh(m.uuid)}
                className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#2C3546] border-[#38BDF8]/60 text-white'
                    : 'bg-[#181B21] border-white/[0.06] text-slate-300 hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Box className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="font-medium truncate">{m.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Toggle Wireframe"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMeshWireframe(m.uuid);
                      }}
                      className={`p-1 rounded ${
                        m.wireframe ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Grid className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title="Toggle Visibility"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMeshVisible(m.uuid);
                      }}
                      className={`p-1 rounded ${
                        m.visible ? 'text-slate-200 hover:text-white' : 'text-slate-600'
                      }`}
                    >
                      {m.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </button>
                    <label
                      title="Attach Albedo Texture"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded text-slate-400 hover:text-[#E5A93B] cursor-pointer"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,.bmp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) onAttachTextureToMesh(m.uuid, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-slate-400 tabular-nums flex items-center justify-between">
                  <span>{m.vertices.toLocaleString()} v · {m.triangles.toLocaleString()} t</span>
                  <span className="truncate max-w-[100px]">{m.materialName}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
