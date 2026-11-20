import React, { useState } from 'react';
import {
  Crosshair,
  Paintbrush,
  Sliders,
  Sparkles,
  Smile,
  GitBranch,
  Sun,
  RotateCcw,
  FlipHorizontal2,
  Wand2,
  Eraser,
  ArrowRightLeft,
  CheckCircle2,
  Rocket,
  Box,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type {
  BoneControlShape,
  BoneNode,
  FacialRigState,
  IKLimbId,
  IKLimbState,
  SceneMeshInfo,
  SelectedVertexInfo,
  ShopRarity,
  StudioWorkspaceMode,
} from '../../types';

export type WeightSubTool = 'brush' | 'inspect';
export type PaintBrushMode = 'add' | 'subtract' | 'smooth' | 'replace';

interface StudioRightInspectorProps {
  workspaceMode: StudioWorkspaceMode;
  isBound: boolean;
  bones: BoneNode[];
  selectedBoneIdx: number;
  selectedBone: BoneNode | undefined;
  selectedMesh?: SceneMeshInfo;
  symmetry: boolean;
  onToggleSymmetry: (v: boolean) => void;
  onUpdateBoneProp: (patch: Partial<BoneNode>) => void;
  onRenameBone: (newName: string) => void;
  onFocusBone: () => void;

  // Bound Pose Offsets
  manualRot: { x: number; y: number; z: number };
  manualPosOffset: { x: number; y: number; z: number };
  onChangeManualRot: (rot: { x: number; y: number; z: number }) => void;
  onChangeManualPosOffset: (pos: { x: number; y: number; z: number }) => void;
  onResetAllBoundBones: () => void;

  // Weight Painting & Tools
  weightSubTool: WeightSubTool;
  onChangeWeightSubTool: (t: WeightSubTool) => void;
  paintMode: PaintBrushMode;
  onChangePaintMode: (m: PaintBrushMode) => void;
  brushRadius: number;
  onChangeBrushRadius: (v: number) => void;
  brushStrength: number;
  onChangeBrushStrength: (v: number) => void;
  showHeatMap: boolean;
  onToggleHeatMap: (v: boolean) => void;
  heatRadius: number;
  heatFalloff: number;
  onChangeHeatRadius: (v: number) => void;
  onChangeHeatFalloff: (v: number) => void;
  onRecomputeAutoWeights: () => void;
  onNormalizeWeights: () => void;
  onSmoothAllWeights: () => void;
  onMirrorAllWeights: (dir: 'LtoR' | 'RtoL') => void;
  onCleanupWeights: (threshold: number) => void;
  onTransferWeights: (fromBoneIdx: number, toBoneIdx: number) => void;
  selectedVertex: SelectedVertexInfo | null;
  onEditVertexSlotWeight: (slot: number, boneIndex: number, weight: number) => void;

  // IK / FK
  ikLimbs: Record<IKLimbId, IKLimbState>;
  onToggleLimbIK: (id: IKLimbId, enabled: boolean) => void;
  onChangeLimbIKBlend: (id: IKLimbId, blend: number) => void;
  onResetIKTargets: () => void;

  // Facial & Finger Rig + Morphs
  facialRig: FacialRigState;
  morphTargetNames: string[];
  onChangeFacialRig: (patch: Partial<FacialRigState>) => void;
  onChangeMorphInfluence: (name: string, value: number) => void;

  // Calibration & Viewport Lighting
  meshRotDeg: [number, number, number];
  meshScale: number;
  onApplyMeshCalibration: (rot: [number, number, number], scale: number) => void;
  lightingConfig: {
    keyIntensity: number;
    rimIntensity: number;
    exposure: number;
    showGrid: boolean;
    xrayBones: boolean;
  };
  onChangeLighting: (
    patch: Partial<{
      keyIntensity: number;
      rimIntensity: number;
      exposure: number;
      showGrid: boolean;
      xrayBones: boolean;
    }>,
  ) => void;

  // Admin Publish
  isAdmin: boolean;
  shopPrice: number;
  shopRarity: ShopRarity;
  publishing: boolean;
  onChangeShopPrice: (v: number) => void;
  onChangeShopRarity: (r: ShopRarity) => void;
  onPublish: () => void;
}

export const StudioRightInspector: React.FC<StudioRightInspectorProps> = ({
  workspaceMode,
  isBound,
  bones,
  selectedBoneIdx,
  selectedBone,
  selectedMesh,
  symmetry,
  onToggleSymmetry,
  onUpdateBoneProp,
  onRenameBone,
  onFocusBone,
  manualRot,
  manualPosOffset,
  onChangeManualRot,
  onChangeManualPosOffset,
  onResetAllBoundBones,
  weightSubTool,
  onChangeWeightSubTool,
  paintMode,
  onChangePaintMode,
  brushRadius,
  onChangeBrushRadius,
  brushStrength,
  onChangeBrushStrength,
  showHeatMap,
  onToggleHeatMap,
  heatRadius,
  heatFalloff,
  onChangeHeatRadius,
  onChangeHeatFalloff,
  onRecomputeAutoWeights,
  onNormalizeWeights,
  onSmoothAllWeights,
  onMirrorAllWeights,
  onCleanupWeights,
  onTransferWeights,
  selectedVertex,
  onEditVertexSlotWeight,
  ikLimbs,
  onToggleLimbIK,
  onChangeLimbIKBlend,
  onResetIKTargets,
  facialRig,
  morphTargetNames,
  onChangeFacialRig,
  onChangeMorphInfluence,
  meshRotDeg,
  meshScale,
  onApplyMeshCalibration,
  lightingConfig,
  onChangeLighting,
  isAdmin,
  shopPrice,
  shopRarity,
  publishing,
  onChangeShopPrice,
  onChangeShopRarity,
  onPublish,
}) => {
  const [cleanupThresh, setCleanupThresh] = useState(0.025);
  const [transferFromIdx, setTransferFromIdx] = useState(0);
  const [transferToIdx, setTransferToIdx] = useState(Math.min(1, Math.max(0, bones.length - 1)));
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const constraint = selectedBone?.constraint ?? {
    enabled: false,
    minDeg: [-90, -90, -90] as [number, number, number],
    maxDeg: [90, 90, 90] as [number, number, number],
    lockPosition: false,
  };

  const toDeg = (rad: number) => Math.round((rad * 180) / Math.PI);
  const toRad = (deg: number) => Number(((deg * Math.PI) / 180).toFixed(3));
  const boneRot = selectedBone?.rotation ?? [0, 0, 0];
  const boneScale = selectedBone?.scale ?? [1, 1, 1];

  if (panelCollapsed) {
    return (
      <aside className="hidden lg:flex w-9 shrink-0 bg-[#1D2026] border-l border-white/[0.08] flex-col items-center py-2.5 gap-3">
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          title="Expand Rig Inspector"
          className="p-1.5 rounded bg-[#16181D] hover:bg-[#2A2F3A] text-slate-300 hover:text-white border border-white/10"
        >
          <PanelRightOpen className="w-3.5 h-3.5" />
        </button>
        <span className="[writing-mode:vertical-rl] text-[10px] tracking-wider uppercase text-slate-400 font-medium">
          Inspector
        </span>
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-[320px] shrink-0 bg-[#1D2026] border-t lg:border-t-0 lg:border-l border-white/[0.08] overflow-y-auto p-2.5 space-y-2.5 max-h-[580px] lg:max-h-none">
      <div className="flex items-center justify-between px-0.5 text-[11px] font-medium text-slate-400">
        <span>
          {workspaceMode === 'edit'
            ? 'Edit Mode · Armature'
            : workspaceMode === 'pose'
              ? 'Pose Mode · Deform'
              : workspaceMode === 'object'
                ? 'Object Mode · Scene'
                : workspaceMode === 'weights'
                  ? 'Weight Paint'
                  : workspaceMode === 'ikfk'
                    ? 'IK / FK Solver'
                    : 'Animation Pose'}
        </span>
        <button
          type="button"
          onClick={() => setPanelCollapsed(true)}
          title="Collapse Rig Inspector"
          className="hidden lg:inline-flex p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/5"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* SELECTED MESH OBJECT PROPERTIES */}
      {selectedMesh && (
        <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-1.5 text-xs tabular-nums">
          <div className="flex items-center justify-between text-slate-100 font-medium">
            <span className="flex items-center gap-1.5 truncate">
              <Box className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">{selectedMesh.name}</span>
            </span>
            <span className="text-[10px] text-slate-400">
              {selectedMesh.visible ? 'Visible' : 'Hidden'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-300">
            <div className="bg-[#16181D] rounded px-1.5 py-1">
              <div className="text-slate-500">Vertices</div>
              <div className="font-mono">{selectedMesh.vertices.toLocaleString()}</div>
            </div>
            <div className="bg-[#16181D] rounded px-1.5 py-1">
              <div className="text-slate-500">Triangles</div>
              <div className="font-mono">{selectedMesh.triangles.toLocaleString()}</div>
            </div>
            <div className="bg-[#16181D] rounded px-1.5 py-1 truncate">
              <div className="text-slate-500">Material</div>
              <div className="truncate text-slate-200">{selectedMesh.materialName}</div>
            </div>
          </div>
          {workspaceMode === 'object' && (
            <div className="text-[11px] text-sky-300 bg-sky-950/30 border border-sky-500/25 rounded px-2 py-1.5">
              Object Mode: Click any mesh in viewport or outliner and drag with G (Move) / R (Rotate) / S (Scale).
            </div>
          )}
        </div>
      )}
      {workspaceMode === 'object' && !selectedMesh && (
        <div className="bg-[#23272F] border border-sky-500/30 rounded p-2.5 text-[11px] text-sky-200">
          Object Mode active: Click any mesh in the 3D viewport or Scene Outliner to position, rotate, or scale it.
        </div>
      )}

      {/* WEIGHT PAINT STUDIO */}
      {workspaceMode === 'weights' && (
        <div className="space-y-2.5">
          <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Paintbrush className="w-3.5 h-3.5 text-[#E5A93B]" />
                <span>Weight Paint Studio</span>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHeatMap}
                  onChange={(e) => onToggleHeatMap(e.target.checked)}
                  className="accent-[#E5A93B]"
                />
                <span>Heat Map</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onChangeWeightSubTool('brush')}
                className={`py-1 rounded text-xs font-medium border ${
                  weightSubTool === 'brush'
                    ? 'bg-[#E5A93B] text-slate-950 border-[#E5A93B] font-semibold'
                    : 'bg-[#16181D] text-slate-300 border-white/[0.08]'
                }`}
              >
                Paint Brush
              </button>
              <button
                type="button"
                onClick={() => onChangeWeightSubTool('inspect')}
                className={`py-1 rounded text-xs font-medium border ${
                  weightSubTool === 'inspect'
                    ? 'bg-[#3B82F6] text-white border-[#3B82F6] font-semibold'
                    : 'bg-[#16181D] text-slate-300 border-white/[0.08]'
                }`}
              >
                Inspect Vertex
              </button>
            </div>

            {weightSubTool === 'brush' && (
              <>
                <div className="grid grid-cols-4 gap-1">
                  {(['add', 'subtract', 'smooth', 'replace'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChangePaintMode(m)}
                      className={`py-1 rounded text-[11px] font-medium capitalize border ${
                        paintMode === m
                          ? 'bg-[#3B82F6] border-[#3B82F6] text-white'
                          : 'bg-[#16181D] border-white/[0.06] text-slate-400 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="space-y-1 text-xs tabular-nums">
                  <div className="flex justify-between text-slate-300">
                    <span>Brush Radius</span>
                    <span className="font-mono">{brushRadius.toFixed(2)}m</span>
                  </div>
                  <input
                    type="range"
                    min={0.03}
                    max={0.55}
                    step={0.01}
                    value={brushRadius}
                    onChange={(e) => onChangeBrushRadius(Number(e.target.value))}
                    className="w-full accent-[#E5A93B]"
                  />
                  <div className="flex justify-between text-slate-300">
                    <span>Brush Strength</span>
                    <span className="font-mono">{Math.round(brushStrength * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={brushStrength}
                    onChange={(e) => onChangeBrushStrength(Number(e.target.value))}
                    className="w-full accent-[#E5A93B]"
                  />
                </div>
              </>
            )}

            <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
              <div className="text-[11px] font-medium text-slate-300">Weight Utilities</div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  disabled={isBound}
                  onClick={onNormalizeWeights}
                  className="py-1 px-2 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Normalize</span>
                </button>
                <button
                  type="button"
                  disabled={isBound}
                  onClick={onSmoothAllWeights}
                  className="py-1 px-2 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <Wand2 className="w-3 h-3 text-sky-400" />
                  <span>Smooth Mesh</span>
                </button>
                <button
                  type="button"
                  disabled={isBound}
                  onClick={() => onMirrorAllWeights('LtoR')}
                  className="py-1 px-2 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <FlipHorizontal2 className="w-3 h-3 text-[#E5A93B]" />
                  <span>Mirror L→R</span>
                </button>
                <button
                  type="button"
                  disabled={isBound}
                  onClick={() => onMirrorAllWeights('RtoL')}
                  className="py-1 px-2 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <FlipHorizontal2 className="w-3 h-3 text-[#E5A93B]" />
                  <span>Mirror R→L</span>
                </button>
              </div>

              {/* Cleanup threshold */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-400 whitespace-nowrap">Prune &lt;</span>
                <input
                  type="number"
                  step={0.005}
                  min={0.005}
                  max={0.25}
                  value={cleanupThresh}
                  onChange={(e) => setCleanupThresh(Number(e.target.value) || 0.025)}
                  className="w-16 px-1.5 py-1 rounded bg-[#14161B] border border-white/[0.08] text-[11px] font-mono text-white"
                />
                <button
                  type="button"
                  disabled={isBound}
                  onClick={() => onCleanupWeights(cleanupThresh)}
                  className="flex-1 py-1 px-2 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <Eraser className="w-3 h-3 text-rose-400" />
                  <span>Clean Weights</span>
                </button>
              </div>

              {/* Weight Transfer */}
              <div className="pt-1 border-t border-white/[0.08] space-y-1.5">
                <div className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
                  <ArrowRightLeft className="w-3 h-3 text-sky-400" />
                  <span>Transfer Bone Weights</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <select
                    value={transferFromIdx}
                    onChange={(e) => setTransferFromIdx(Number(e.target.value))}
                    className="px-1.5 py-1 rounded bg-[#14161B] border border-white/[0.08] text-[11px] text-slate-200"
                  >
                    {bones.map((b, i) => (
                      <option key={`${b.name}_${i}`} value={i}>
                        From: {b.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={transferToIdx}
                    onChange={(e) => setTransferToIdx(Number(e.target.value))}
                    className="px-1.5 py-1 rounded bg-[#14161B] border border-white/[0.08] text-[11px] text-slate-200"
                  >
                    {bones.map((b, i) => (
                      <option key={`${b.name}_${i}`} value={i}>
                        To: {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={isBound}
                  onClick={() => onTransferWeights(transferFromIdx, transferToIdx)}
                  className="w-full py-1 rounded bg-[#2A2F3A] hover:bg-[#343B48] border border-white/10 text-[11px] font-medium text-slate-100 disabled:opacity-40"
                >
                  Transfer 100% Influence
                </button>
              </div>
            </div>

            {/* Auto-Weight Parameters */}
            <div className="pt-2 border-t border-white/[0.08] space-y-1 text-xs tabular-nums">
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Heat Radius</span>
                <span className="font-mono">{heatRadius.toFixed(2)}m</span>
              </div>
              <input
                type="range"
                min={0.12}
                max={0.85}
                step={0.02}
                value={heatRadius}
                onChange={(e) => onChangeHeatRadius(Number(e.target.value))}
                className="w-full accent-[#E5A93B]"
              />
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Heat Falloff</span>
                <span className="font-mono">{heatFalloff.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.8}
                max={5.0}
                step={0.1}
                value={heatFalloff}
                onChange={(e) => onChangeHeatFalloff(Number(e.target.value))}
                className="w-full accent-[#E5A93B]"
              />
              <button
                type="button"
                disabled={isBound}
                onClick={onRecomputeAutoWeights}
                className="w-full py-1.5 rounded bg-[#2B2518] hover:bg-[#3A311D] border border-[#E5A93B]/40 text-xs font-semibold text-[#FDE68A] disabled:opacity-40"
              >
                Recompute Automatic Heat Weights
              </button>
            </div>
          </div>

          {/* Per-Vertex Influence Inspector */}
          <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2">
            <div className="text-xs font-semibold text-white flex items-center justify-between">
              <span>Vertex Influence Inspector</span>
              {selectedVertex && (
                <span className="font-mono text-[10px] text-[#E5A93B] tabular-nums">
                  #{selectedVertex.vertexIndex}
                </span>
              )}
            </div>
            {!selectedVertex ? (
              <p className="text-[11px] text-slate-400">
                Choose Inspect Vertex and click any point on the 3D mesh to inspect and adjust its 4 bone weights.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-slate-400 tabular-nums">
                  {selectedVertex.meshName} · ({selectedVertex.worldPos.join(', ')})
                </div>
                {selectedVertex.influences.map((inf, slot) => (
                  <div key={slot} className="space-y-0.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={inf.boneIndex}
                        disabled={isBound}
                        onChange={(e) =>
                          onEditVertexSlotWeight(slot, Number(e.target.value), inf.weight)
                        }
                        className="flex-1 px-1.5 py-0.5 rounded bg-[#14161B] border border-white/[0.08] text-[11px] text-slate-200"
                      >
                        {bones.map((b, bIdx) => (
                          <option key={`${b.name}_${bIdx}`} value={bIdx}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <span className="font-mono text-white w-11 text-right tabular-nums">
                        {(inf.weight * 100).toFixed(1)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={isBound}
                      value={inf.weight}
                      onChange={(e) =>
                        onEditVertexSlotWeight(slot, inf.boneIndex, Number(e.target.value))
                      }
                      className="w-full accent-[#3B82F6]"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* IK / FK RIGGING PANEL */}
      {workspaceMode === 'ikfk' && (
        <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <GitBranch className="w-3.5 h-3.5 text-[#E5A93B]" />
              <span>IK / FK Limb Controllers</span>
            </div>
            <button
              type="button"
              onClick={onResetIKTargets}
              className="text-[11px] text-sky-400 hover:text-sky-300"
            >
              Reset Targets
            </button>
          </div>
          {!isBound && (
            <div className="p-2 rounded bg-[#2B2518] border border-[#E5A93B]/30 text-[11px] text-[#FDE68A]">
              Bind Rig or toggle any IK button below to enable interactive 3D hand/foot targets and pole controls.
            </div>
          )}
          <div className="space-y-1.5">
            {(Object.keys(ikLimbs) as IKLimbId[]).map((id) => {
              const limb = ikLimbs[id];
              return (
                <div
                  key={id}
                  className="p-2 rounded bg-[#181B21] border border-white/[0.08] space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-200">{limb.label}</span>
                    <div className="flex rounded overflow-hidden border border-white/10 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() => onToggleLimbIK(id, false)}
                        className={`px-2 py-0.5 ${
                          !limb.enabled ? 'bg-[#3B82F6] text-white' : 'bg-[#14161B] text-slate-400'
                        }`}
                      >
                        FK
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLimbIK(id, true)}
                        className={`px-2 py-0.5 ${
                          limb.enabled ? 'bg-[#E5A93B] text-slate-950' : 'bg-[#14161B] text-slate-400'
                        }`}
                      >
                        IK
                      </button>
                    </div>
                  </div>
                  {limb.enabled && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
                        <span>IK Blend</span>
                        <span className="font-mono">{Math.round(limb.blend * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={limb.blend}
                        onChange={(e) => onChangeLimbIKBlend(id, Number(e.target.value))}
                        className="w-full accent-[#E5A93B]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SELECTED BONE PROPERTIES & CONSTRAINTS */}
      {selectedBone && (
        <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white truncate">
              <Sparkles className="w-3.5 h-3.5 text-[#E5A93B]" />
              <span className="truncate">{selectedBone.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={symmetry}
                  onChange={(e) => onToggleSymmetry(e.target.checked)}
                  className="accent-[#E5A93B]"
                />
                <span>Sym</span>
              </label>
              <button
                type="button"
                onClick={onFocusBone}
                className="px-1.5 py-0.5 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[10px] text-slate-200 flex items-center gap-1"
              >
                <Crosshair className="w-3 h-3" />
                <span>Focus</span>
              </button>
            </div>
          </div>

          {!isBound ? (
            <>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div>
                  <label className="text-[10px] text-slate-400">Bone Name</label>
                  <input
                    type="text"
                    value={selectedBone.name}
                    onChange={(e) => onRenameBone(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1 rounded bg-[#14161B] border border-white/[0.08] text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Parent</label>
                  <select
                    value={selectedBone.parent || ''}
                    onChange={(e) =>
                      onUpdateBoneProp({ parent: e.target.value ? e.target.value : null })
                    }
                    className="w-full mt-0.5 px-2 py-1 rounded bg-[#14161B] border border-white/[0.08] text-xs text-slate-200"
                  >
                    <option value="">None (Root)</option>
                    {bones
                      .filter((b) => b.name !== selectedBone.name)
                      .map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Control Shape */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[11px] text-slate-400">Control Shape</span>
                <div className="flex gap-1">
                  {(['sphere', 'ring', 'cube', 'diamond'] as BoneControlShape[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onUpdateBoneProp({ controlShape: s })}
                      className={`px-2 py-0.5 rounded text-[10px] capitalize border ${
                        (selectedBone.controlShape || 'sphere') === s
                          ? 'bg-[#E5A93B] text-slate-950 border-[#E5A93B] font-semibold'
                          : 'bg-[#16181D] text-slate-400 border-white/[0.08]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rest Position X/Y/Z */}
              <div>
                <div className="text-[10px] text-slate-400 mb-1">Location (m)</div>
                <div className="grid grid-cols-3 gap-1 tabular-nums">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <div
                      key={axis}
                      className="bg-[#14161B] border border-white/[0.08] rounded px-1.5 py-1 flex items-center gap-1"
                    >
                      <span
                        className={`text-[10px] font-mono ${
                          idx === 0 ? 'text-red-400' : idx === 1 ? 'text-emerald-400' : 'text-sky-400'
                        }`}
                      >
                        {axis}
                      </span>
                      <input
                        type="number"
                        step={0.01}
                        value={selectedBone.position[idx]}
                        onChange={(e) => {
                          const next: [number, number, number] = [...selectedBone.position];
                          next[idx] = Number(e.target.value) || 0;
                          onUpdateBoneProp({ position: next });
                        }}
                        className="w-full bg-transparent text-[11px] font-mono text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rest Rotation X/Y/Z (deg) */}
              <div>
                <div className="text-[10px] text-slate-400 mb-1">Rotation (°)</div>
                <div className="grid grid-cols-3 gap-1 tabular-nums">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <div
                      key={axis}
                      className="bg-[#14161B] border border-white/[0.08] rounded px-1.5 py-1 flex items-center gap-1"
                    >
                      <span
                        className={`text-[10px] font-mono ${
                          idx === 0 ? 'text-red-400' : idx === 1 ? 'text-emerald-400' : 'text-sky-400'
                        }`}
                      >
                        {axis}
                      </span>
                      <input
                        type="number"
                        step={1}
                        value={toDeg(boneRot[idx])}
                        onChange={(e) => {
                          const next: [number, number, number] = [boneRot[0], boneRot[1], boneRot[2]];
                          next[idx] = toRad(Number(e.target.value) || 0);
                          onUpdateBoneProp({ rotation: next });
                        }}
                        className="w-full bg-transparent text-[11px] font-mono text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rest Scale X/Y/Z */}
              <div>
                <div className="text-[10px] text-slate-400 mb-1">Scale</div>
                <div className="grid grid-cols-3 gap-1 tabular-nums">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <div
                      key={axis}
                      className="bg-[#14161B] border border-white/[0.08] rounded px-1.5 py-1 flex items-center gap-1"
                    >
                      <span
                        className={`text-[10px] font-mono ${
                          idx === 0 ? 'text-red-400' : idx === 1 ? 'text-emerald-400' : 'text-sky-400'
                        }`}
                      >
                        {axis}
                      </span>
                      <input
                        type="number"
                        step={0.05}
                        min={0.1}
                        max={4}
                        value={boneScale[idx]}
                        onChange={(e) => {
                          const next: [number, number, number] = [
                            boneScale[0],
                            boneScale[1],
                            boneScale[2],
                          ];
                          next[idx] = Math.max(0.05, Number(e.target.value) || 1);
                          onUpdateBoneProp({ scale: next });
                        }}
                        className="w-full bg-transparent text-[11px] font-mono text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Bone Roll (°) & Connected to Parent */}
              <div className="pt-1 border-t border-white/[0.06] space-y-1.5 text-xs tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">Bone Roll (°)</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#E5A93B]">
                      {toDeg(selectedBone.roll ?? 0)}°
                    </span>
                    <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedBone.connected)}
                        onChange={(e) => onUpdateBoneProp({ connected: e.target.checked })}
                        className="accent-[#38BDF8]"
                      />
                      <span>Connected</span>
                    </label>
                  </div>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={toDeg(selectedBone.roll ?? 0)}
                  onChange={(e) => onUpdateBoneProp({ roll: toRad(Number(e.target.value)) })}
                  className="w-full accent-[#E5A93B]"
                />
              </div>

              {/* Heat Weight Scale */}
              <div className="space-y-1 text-xs tabular-nums">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Weight Envelope Scale</span>
                  <span className="font-mono">{(selectedBone.weightScale ?? 1.0).toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={2.0}
                  step={0.05}
                  value={selectedBone.weightScale ?? 1.0}
                  onChange={(e) => onUpdateBoneProp({ weightScale: Number(e.target.value) })}
                  className="w-full accent-[#E5A93B]"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2 text-xs tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Live Pose Rotation</span>
                <button
                  type="button"
                  onClick={onResetAllBoundBones}
                  className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Pose</span>
                </button>
              </div>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={axis} className="flex items-center gap-2">
                  <span className="w-4 font-mono text-[11px] uppercase text-slate-400">{axis}</span>
                  <input
                    type="range"
                    min={-3.14}
                    max={3.14}
                    step={0.04}
                    value={manualRot[axis]}
                    onChange={(e) =>
                      onChangeManualRot({ ...manualRot, [axis]: Number(e.target.value) })
                    }
                    className="flex-1 accent-[#E5A93B]"
                  />
                  <span className="w-12 text-right font-mono text-[11px] text-white">
                    {toDeg(manualRot[axis])}°
                  </span>
                </div>
              ))}
              {selectedBoneIdx === 0 && (
                <div className="pt-1 border-t border-white/[0.08] space-y-1">
                  <div className="text-[10px] text-slate-400">Root / Pelvis Offset (m)</div>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <div key={axis} className="flex items-center gap-2">
                      <span className="w-4 font-mono text-[10px] uppercase text-slate-500">{axis}</span>
                      <input
                        type="range"
                        min={-0.6}
                        max={0.6}
                        step={0.01}
                        value={manualPosOffset[axis]}
                        onChange={(e) =>
                          onChangeManualPosOffset({
                            ...manualPosOffset,
                            [axis]: Number(e.target.value),
                          })
                        }
                        className="flex-1 accent-[#3B82F6]"
                      />
                      <span className="w-12 text-right font-mono text-[10px] text-slate-300">
                        {manualPosOffset[axis].toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Joint Constraints & Rotation Limits */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Joint Rotation Limits</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={constraint.enabled}
                  onChange={(e) =>
                    onUpdateBoneProp({
                      constraint: { ...constraint, enabled: e.target.checked },
                    })
                  }
                  className="accent-[#E5A93B]"
                />
                <span>Enforce</span>
              </label>
            </div>
            {constraint.enabled && (
              <div className="space-y-1 text-[10px] tabular-nums">
                {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                  <div key={axis} className="grid grid-cols-[20px_1fr_1fr] gap-1 items-center">
                    <span className="font-mono text-slate-400">{axis}</span>
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      value={constraint.minDeg[idx]}
                      onChange={(e) => {
                        const minDeg: [number, number, number] = [...constraint.minDeg];
                        minDeg[idx] = Number(e.target.value) || -90;
                        onUpdateBoneProp({ constraint: { ...constraint, minDeg } });
                      }}
                      className="px-1.5 py-0.5 rounded bg-[#14161B] border border-white/[0.08] font-mono text-white"
                      title="Min Degrees"
                    />
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      value={constraint.maxDeg[idx]}
                      onChange={(e) => {
                        const maxDeg: [number, number, number] = [...constraint.maxDeg];
                        maxDeg[idx] = Number(e.target.value) || 90;
                        onUpdateBoneProp({ constraint: { ...constraint, maxDeg } });
                      }}
                      className="px-1.5 py-0.5 rounded bg-[#14161B] border border-white/[0.08] font-mono text-white"
                      title="Max Degrees"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* FACIAL, EYE, JAW & FINGER RIGGING CONTROLS */}
      <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2 text-xs tabular-nums">
        <div className="flex items-center gap-1.5 font-semibold text-white">
          <Smile className="w-3.5 h-3.5 text-[#E5A93B]" />
          <span>Facial &amp; Finger Rig Controls</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>Jaw Open</span>
            <span className="font-mono">{toDeg(facialRig.jawOpen)}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.65}
            step={0.02}
            value={facialRig.jawOpen}
            onChange={(e) => onChangeFacialRig({ jawOpen: Number(e.target.value) })}
            className="w-full accent-[#E5A93B]"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Eye Look H</span>
                <span className="font-mono">{toDeg(facialRig.eyeLookX)}°</span>
              </div>
              <input
                type="range"
                min={-0.45}
                max={0.45}
                step={0.02}
                value={facialRig.eyeLookX}
                onChange={(e) => onChangeFacialRig({ eyeLookX: Number(e.target.value) })}
                className="w-full accent-[#38BDF8]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Eye Look V</span>
                <span className="font-mono">{toDeg(facialRig.eyeLookY)}°</span>
              </div>
              <input
                type="range"
                min={-0.35}
                max={0.35}
                step={0.02}
                value={facialRig.eyeLookY}
                onChange={(e) => onChangeFacialRig({ eyeLookY: Number(e.target.value) })}
                className="w-full accent-[#38BDF8]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Left Fist Curl</span>
                <span className="font-mono">{Math.round(facialRig.leftFistCurl * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.04}
                value={facialRig.leftFistCurl}
                onChange={(e) => onChangeFacialRig({ leftFistCurl: Number(e.target.value) })}
                className="w-full accent-[#E5A93B]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Right Fist Curl</span>
                <span className="font-mono">{Math.round(facialRig.rightFistCurl * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.04}
                value={facialRig.rightFistCurl}
                onChange={(e) => onChangeFacialRig({ rightFistCurl: Number(e.target.value) })}
                className="w-full accent-[#E5A93B]"
              />
            </div>
          </div>

          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Finger Spread</span>
            <span className="font-mono">{toDeg(facialRig.fingerSpread)}°</span>
          </div>
          <input
            type="range"
            min={-0.08}
            max={0.22}
            step={0.01}
            value={facialRig.fingerSpread}
            onChange={(e) => onChangeFacialRig({ fingerSpread: Number(e.target.value) })}
            className="w-full accent-[#3B82F6]"
          />

          {morphTargetNames.length > 0 && (
            <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
              <div className="text-[11px] font-medium text-[#E5A93B]">
                GLB Morph Targets ({morphTargetNames.length})
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {morphTargetNames.map((mName) => {
                  const val = facialRig.morphInfluences[mName] ?? 0;
                  return (
                    <div key={mName} className="space-y-0.5">
                      <div className="flex justify-between text-[10px] text-slate-300">
                        <span className="truncate">{mName}</span>
                        <span className="font-mono">{Math.round(val * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={val}
                        onChange={(e) => onChangeMorphInfluence(mName, Number(e.target.value))}
                        className="w-full accent-[#E5A93B]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MESH CALIBRATION & VIEWPORT LIGHTING */}
      <div className="bg-[#23272F] border border-white/[0.08] rounded p-2.5 space-y-2 text-xs tabular-nums">
        <div className="flex items-center gap-1.5 font-semibold text-white">
          <Sliders className="w-3.5 h-3.5 text-sky-400" />
          <span>Rig &amp; Mesh Calibration</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { label: 'Rot X +90°', delta: [90, 0, 0] },
              { label: 'Rot Y +90°', delta: [0, 90, 0] },
              { label: 'Reset Calib', reset: true },
            ] as const
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={isBound}
              onClick={() => {
                if ('reset' in item) {
                  onApplyMeshCalibration([0, 0, 0], 1.0);
                } else {
                  onApplyMeshCalibration(
                    [
                      (meshRotDeg[0] + item.delta[0]) % 360,
                      (meshRotDeg[1] + item.delta[1]) % 360,
                      (meshRotDeg[2] + item.delta[2]) % 360,
                    ],
                    meshScale,
                  );
                }
              }}
              className="py-1 px-1.5 rounded bg-[#16181D] hover:bg-[#2A2F3A] border border-white/[0.08] text-[10px] font-medium text-slate-200 disabled:opacity-40"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Scale</span>
          <input
            type="range"
            min={0.4}
            max={2.0}
            step={0.05}
            disabled={isBound}
            value={meshScale}
            onChange={(e) => onApplyMeshCalibration(meshRotDeg, Number(e.target.value))}
            className="flex-1 accent-[#E5A93B]"
          />
          <span className="font-mono text-[11px] w-10 text-right">{meshScale.toFixed(2)}x</span>
        </div>

        <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-[#E5A93B]" />
              <span>Viewport &amp; Lights</span>
            </span>
            <div className="flex items-center gap-2 text-[10px] text-slate-300">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lightingConfig.showGrid}
                  onChange={(e) => onChangeLighting({ showGrid: e.target.checked })}
                  className="accent-[#E5A93B]"
                />
                <span>Grid</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lightingConfig.xrayBones}
                  onChange={(e) => onChangeLighting({ xrayBones: e.target.checked })}
                  className="accent-[#E5A93B]"
                />
                <span>X-Ray</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
            <div>
              <span>Key ({lightingConfig.keyIntensity.toFixed(1)})</span>
              <input
                type="range"
                min={0.4}
                max={4.0}
                step={0.1}
                value={lightingConfig.keyIntensity}
                onChange={(e) => onChangeLighting({ keyIntensity: Number(e.target.value) })}
                className="w-full accent-[#E5A93B]"
              />
            </div>
            <div>
              <span>Rim ({lightingConfig.rimIntensity.toFixed(1)})</span>
              <input
                type="range"
                min={0}
                max={4.0}
                step={0.1}
                value={lightingConfig.rimIntensity}
                onChange={(e) => onChangeLighting({ rimIntensity: Number(e.target.value) })}
                className="w-full accent-[#38BDF8]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ADMIN STOREFRONT PUBLISH */}
      {isAdmin && (
        <div className="bg-[#232018] border border-[#E5A93B]/30 rounded p-2.5 space-y-2 text-xs">
          <div className="font-semibold text-[#FDE68A] flex items-center gap-1.5">
            <Rocket className="w-3.5 h-3.5" />
            <span>Publish to Item Shop &amp; Lounge</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[10px] text-slate-400">Price (SC)</label>
              <input
                type="number"
                min={0}
                max={50000}
                value={shopPrice}
                onChange={(e) => onChangeShopPrice(Number(e.target.value) || 0)}
                className="w-full mt-0.5 px-2 py-1 rounded bg-[#14161B] border border-white/[0.08] font-mono text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Rarity</label>
              <select
                value={shopRarity}
                onChange={(e) => onChangeShopRarity(e.target.value as ShopRarity)}
                className="w-full mt-0.5 px-2 py-1 rounded bg-[#14161B] border border-white/[0.08] text-white capitalize"
              >
                {(['mythic', 'legendary', 'epic', 'rare', 'uncommon'] as ShopRarity[]).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            disabled={publishing}
            onClick={onPublish}
            className="w-full py-1.5 rounded bg-[#E5A93B] hover:bg-[#EEB852] text-slate-950 font-semibold disabled:opacity-40"
          >
            {publishing ? 'Publishing Rig & Binary...' : 'Configure & Publish Drop'}
          </button>
        </div>
      )}
    </aside>
  );
};
