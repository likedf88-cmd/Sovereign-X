import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  MousePointerClick,
  Plus,
  Move,
  RotateCw,
  Maximize2,
  Compass,
  AlertTriangle,
  CheckCircle2,
  X,
  Bone as BoneIcon,
  Magnet,
  Crosshair,
  Eye,
  ScanSearch,
  Upload,
  Camera,
} from 'lucide-react';
import type {
  AnimationKeyframe,
  AvatarEmote,
  BoneNode,
  FacialRigState,
  IKLimbId,
  IKLimbState,
  ModelStats,
  RigAuditReport,
  RiggedModelConfig,
  ScanCorrectionReport,
  SceneMeshInfo,
  SelectedVertexInfo,
  ShopRarity,
  ShopSection,
  SkeletonPresetType,
  StudioWorkspaceMode,
  TransformPivotMode,
  ViewportShadingMode,
} from '../types';
import {
  analyzeAndHighlightMeshIssues,
  applyHeatMapVertexColors,
  bindSkeletonToModelGroup,
  cleanupWeightsOnMesh,
  cloneScenePreservingSkeleton,
  computeHeatMapWeightsForMesh,
  createCalibratedGroupFromBackup,
  createStudioBloomComposer,
  createStudioWebGLContext,
  mirrorAllWeightsOnMesh,
  normalizeModelToUnitHeight,
  normalizeWeightsOnMesh,
  paintHeatWeightOnMesh,
  pickClosestVertexInfluence,
  setVertexSlotWeight,
  smoothAllWeightsOnMesh,
  transferBoneWeightsOnMesh,
  type StudioBloomHandle,
} from '../three/riggingEngine';
import {
  applyAvatarAnimation,
  createStarterRiggingSubject,
} from '../three/proceduralAvatars';
import {
  applyTextureFileToMesh,
  computeGroupStats,
  exportGroupWithAnimations,
  extractPreservedBoundRig,
  extractSceneMeshesInfo,
  importModelFiles,
} from '../three/modelImporter';
import {
  autoFixRigHierarchy,
  buildIntelligentHumanoidRig,
  getMirrorBoneNameStrict,
  mirrorSkeletonLR,
  runFullRigAudit,
  scanAndCorrectGLBSkeleton,
} from '../three/autoRigger';
import {
  applyBoneConstraints,
  createControlShapeGeometry,
  createDefaultIKLimbs,
  solveTwoBoneIK,
} from '../three/ikSolver';
import {
  captureCurrentPoseAsKey,
  compileClipFromKeyframes,
  compileClipFromPreset,
  parseImportedAnimationFile,
  serializeAnimationClipJSON,
} from '../three/animationSystem';
import {
  applyViewportShadingToGroup,
  buildSkeletonVisuals,
  buildStudioFloorGroup,
  computeAutoFramedCameraPose,
  type SkeletonVisualRig,
  syncSkeletonVisualsFromLiveBones,
} from '../three/skeletonVisualizer';
import { uploadDataUrlImage, uploadImageFile } from '../utils/uploadImage';
import { StudioTopToolbar } from './studio/StudioTopToolbar';
import { StudioLeftOutliner } from './studio/StudioLeftOutliner';
import {
  StudioRightInspector,
  type PaintBrushMode,
  type WeightSubTool,
} from './studio/StudioRightInspector';
import {
  StudioBottomTimeline,
  type ActiveClipSource,
} from './studio/StudioBottomTimeline';

interface RiggingStudioViewProps {
  isAdmin: boolean;
  userId: string;
  userName: string;
  onPublishRiggedAsset: (input: {
    modelId: string;
    name: string;
    description?: string;
    section?: ShopSection;
    imageUrl?: string;
    sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
    glbBuffer: ArrayBuffer | null;
    bones: BoneNode[];
    weightConfig: { radius: number; falloff: number; symmetry: boolean };
    defaultAnimation: AvatarEmote;
    price: number;
    rarity: ShopRarity;
  }) => Promise<void>;
  onSaveToLibrary?: (input: {
    modelId: string;
    name: string;
    sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
    glbBuffer: ArrayBuffer | null;
    bones: BoneNode[];
    weightConfig: { radius: number; falloff: number; symmetry: boolean };
    defaultAnimation: AvatarEmote;
  }) => Promise<void>;
  onTestLocallyInLounge: (config: RiggedModelConfig) => void;
}

type SkeletonTool = 'select-move' | 'place-bone';
type GizmoMode = 'translate' | 'rotate' | 'scale';
type GizmoSpace = 'local' | 'world';
type CameraPreset = 'perspective' | 'front' | 'back' | 'side' | 'top' | 'frame';

interface HistorySnapshot {
  bones: BoneNode[];
  keyframes: AnimationKeyframe[];
}

interface SavedRigProject {
  id: string;
  name: string;
  updatedAt: string;
  skeletonPreset: SkeletonPresetType;
  bones: BoneNode[];
  heatRadius: number;
  heatFalloff: number;
  symmetry: boolean;
  keyframes: AnimationKeyframe[];
}

const DEFAULT_FACIAL: FacialRigState = {
  jawOpen: 0,
  eyeLookX: 0,
  eyeLookY: 0,
  browTilt: 0,
  leftFistCurl: 0,
  rightFistCurl: 0,
  fingerSpread: 0,
  morphInfluences: {},
};

const SHADING_OPTIONS: Array<{ id: ViewportShadingMode; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'material', label: 'Material' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'xray', label: 'X-Ray' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'weights', label: 'Weights' },
  { id: 'unskinned', label: 'Unskinned' },
];

export const RiggingStudioView: React.FC<RiggingStudioViewProps> = ({
  isAdmin,
  userId,
  onPublishRiggedAsset,
  onSaveToLibrary,
  onTestLocallyInLounge,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const storageKey = `sovereign_rig_projects_${userId || 'guest'}`;

  // Model & Scene Meta
  const [modelName, setModelName] = useState('Sovereign Knight Rig');
  const [sourceType, setSourceType] = useState<
    'procedural-knight' | 'procedural-vanguard' | 'glb-custom'
  >('procedural-knight');
  const [stats, setStats] = useState<ModelStats>({
    vertices: 0,
    triangles: 0,
    meshes: 0,
    materials: 0,
    existingBones: 0,
    animations: 0,
    animationNames: [],
    morphTargetCount: 0,
    morphTargetNames: [],
  });
  const [sceneMeshes, setSceneMeshes] = useState<SceneMeshInfo[]>([]);
  const [selectedMeshUuid, setSelectedMeshUuid] = useState<string | null>(null);
  const [importedExistingBones, setImportedExistingBones] = useState<BoneNode[] | null>(null);
  const [usePreservedNativeRig, setUsePreservedNativeRig] = useState(false);
  const [lastDeformReport, setLastDeformReport] = useState<RigAuditReport | null>(null);

  // Studio Workspace, Shading & Transform Controls
  const [workspaceMode, setWorkspaceMode] = useState<StudioWorkspaceMode>('edit');
  const [shadingMode, setShadingMode] = useState<ViewportShadingMode>('material');
  const [skeletonPreset, setSkeletonPreset] = useState<SkeletonPresetType>('full-33');
  const [skeletonTool, setSkeletonTool] = useState<SkeletonTool>('select-move');
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [boundGizmoMode, setBoundGizmoMode] = useState<GizmoMode>('rotate');
  const [gizmoSpace, setGizmoSpace] = useState<GizmoSpace>('local');
  const [snapEnabled, setSnapEnabled] = useState<boolean>(false);
  const [pivotMode, setPivotMode] = useState<TransformPivotMode>('active');

  // Skeleton, Hover & Selection
  const [bones, setBones] = useState<BoneNode[]>([]);
  const [selectedBoneIdx, setSelectedBoneIdx] = useState<number>(0);
  const [hoveredBoneIdx, setHoveredBoneIdx] = useState<number | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [symmetry, setSymmetry] = useState(true);

  // Weight Painting & Vertex Inspection
  const [weightSubTool, setWeightSubTool] = useState<WeightSubTool>('brush');
  const [paintMode, setPaintMode] = useState<PaintBrushMode>('add');
  const [brushRadius, setBrushRadius] = useState(0.16);
  const [brushStrength, setBrushStrength] = useState(0.42);
  const [heatRadius, setHeatRadius] = useState(0.36);
  const [heatFalloff, setHeatFalloff] = useState(2.2);
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [hasCustomPainted, setHasCustomPainted] = useState(false);
  const [selectedVertex, setSelectedVertex] = useState<SelectedVertexInfo | null>(null);

  // IK / FK & Bound Posing
  const [isBound, setIsBound] = useState(false);
  const [ikLimbs, setIkLimbs] = useState<Record<IKLimbId, IKLimbState>>(() =>
    createDefaultIKLimbs([]),
  );
  const [activeIKHandle, setActiveIKHandle] = useState<{
    limbId: IKLimbId;
    role: 'target' | 'pole';
  } | null>(null);
  const [manualRot, setManualRot] = useState({ x: 0, y: 0, z: 0 });
  const [manualPosOffset, setManualPosOffset] = useState({ x: 0, y: 0, z: 0 });
  const [facialRig, setFacialRig] = useState<FacialRigState>(DEFAULT_FACIAL);

  // Animation & Keyframe Timeline
  const [activeClip, setActiveClip] = useState<ActiveClipSource>({
    kind: 'preset',
    emote: 'walk',
  });
  const [isPlayingAnim, setIsPlayingAnim] = useState(false);
  const [loopAnim, setLoopAnim] = useState(true);
  const [animSpeed, setAnimSpeed] = useState(1.0);
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelineDuration, setTimelineDuration] = useState(3.0);
  const [keyframes, setKeyframes] = useState<AnimationKeyframe[]>([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);

  // Calibration, Viewport Lighting & Modals
  const [meshRotDeg, setMeshRotDeg] = useState<[number, number, number]>([0, 0, 0]);
  const [meshScale, setMeshScale] = useState(1.0);
  const [lightingConfig, setLightingConfig] = useState({
    keyIntensity: 2.2,
    rimIntensity: 1.85,
    exposure: 1.15,
    showGrid: true,
    xrayBones: true,
  });
  const [statusMsg, setStatusMsg] = useState(
    '3D Rigging Viewport ready. Import .GLB/.GLTF + textures or manipulate any joint.',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shopPrice, setShopPrice] = useState(1500);
  const [shopRarity, setShopRarity] = useState<ShopRarity>('mythic');
  const [publishDesc, setPublishDesc] = useState(
    'Custom Sovereign character rig calibrated with volumetric weights and full humanoid IK/FK.',
  );
  const [publishSection, setPublishSection] = useState<ShopSection>('featured');
  const [publishImageUrl, setPublishImageUrl] = useState('');
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [thumbUploadError, setThumbUploadError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [scanReport, setScanReport] = useState<ScanCorrectionReport | null>(null);
  const [showMeshIssueOverlay, setShowMeshIssueOverlay] = useState(false);
  const [scanningRig, setScanningRig] = useState(false);
  const [testingInLounge, setTestingInLounge] = useState(false);

  // Live 3D Axis Triad Projection for corner widget
  const [triadAxes, setTriadAxes] = useState<{
    x: [number, number];
    y: [number, number];
    z: [number, number];
  }>({
    x: [1, 0],
    y: [0, -1],
    z: [0, 0],
  });

  // History Stack (Undo / Redo)
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historyMeta, setHistoryMeta] = useState({ index: -1, length: 0 });

  // Saved Projects
  const [savedProjects, setSavedProjects] = useState<SavedRigProject[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as SavedRigProject[]) : [];
    } catch {
      return [];
    }
  });

  // Imperative Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const bloomRef = useRef<StudioBloomHandle | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const floorGridRef = useRef<THREE.Group | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);

  // Smooth Camera Transition Goal Ref (cancelled on user OrbitControls 'start')
  const camTransitionRef = useRef<{
    active: boolean;
    targetPos: THREE.Vector3;
    targetLookAt: THREE.Vector3;
  }>({
    active: false,
    targetPos: new THREE.Vector3(),
    targetLookAt: new THREE.Vector3(),
  });

  const rawBackupGroupRef = useRef<THREE.Group | null>(null);
  const preservedSkinnedSceneRef = useRef<THREE.Group | null>(null);
  const sourceGroupRef = useRef<THREE.Group | null>(null);
  const skinnedGroupRef = useRef<THREE.Group | null>(null);
  const boundBonesMapRef = useRef<Map<string, THREE.Bone>>(new Map());
  const boundRestPosRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const boundRestRotRef = useRef<Map<string, THREE.Euler>>(new Map());
  const nativeClipsRef = useRef<THREE.AnimationClip[]>([]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const activeMixerClipKeyRef = useRef<string>('');

  const skeletonOverlayRef = useRef<THREE.Group | null>(null);
  const skeletonVisualRigRef = useRef<SkeletonVisualRig | null>(null);
  const pivotProxyRef = useRef<THREE.Object3D | null>(null);
  const pivotStartSnapshotRef = useRef<BoneNode[] | null>(null);

  const ikHandlesGroupRef = useRef<THREE.Group | null>(null);
  const ikSelectableMeshesRef = useRef<THREE.Mesh[]>([]);
  const ikHandleMeshesMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const ikPoleLinesRef = useRef<Map<IKLimbId, THREE.Line>>(new Map());
  const jointHandlesRef = useRef<THREE.Mesh[]>([]);
  const meshWireframeOverridesRef = useRef<Set<string>>(new Set());
  const vertexMarkerRef = useRef<THREE.Mesh | null>(null);
  const modelBoundsRef = useRef<THREE.Box3>(
    new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.9, 0.5)),
  );

  const animTimeRef = useRef<number>(0);

  const stateRef = useRef({
    bones,
    selectedBoneIdx,
    hoveredBoneIdx,
    selectedMeshUuid,
    workspaceMode,
    shadingMode,
    skeletonTool,
    gizmoMode,
    boundGizmoMode,
    gizmoSpace,
    snapEnabled,
    pivotMode,
    weightSubTool,
    paintMode,
    brushRadius,
    brushStrength,
    heatRadius,
    heatFalloff,
    showHeatMap,
    showMeshIssueOverlay,
    symmetry,
    hasCustomPainted,
    isBound,
    ikLimbs,
    activeIKHandle,
    activeClip,
    isPlayingAnim,
    loopAnim,
    animSpeed,
    timelineDuration,
    keyframes,
    facialRig,
    xrayBones: lightingConfig.xrayBones,
  });

  useEffect(() => {
    stateRef.current = {
      bones,
      selectedBoneIdx,
      hoveredBoneIdx,
      selectedMeshUuid,
      workspaceMode,
      shadingMode,
      skeletonTool,
      gizmoMode,
      boundGizmoMode,
      gizmoSpace,
      snapEnabled,
      pivotMode,
      weightSubTool,
      paintMode,
      brushRadius,
      brushStrength,
      heatRadius,
      heatFalloff,
      showHeatMap,
      showMeshIssueOverlay,
      symmetry,
      hasCustomPainted,
      isBound,
      ikLimbs,
      activeIKHandle,
      activeClip,
      isPlayingAnim,
      loopAnim,
      animSpeed,
      timelineDuration,
      keyframes,
      facialRig,
      xrayBones: lightingConfig.xrayBones,
    };
  });

  const selectedMeshInfo = useMemo(
    () => sceneMeshes.find((m) => m.uuid === selectedMeshUuid),
    [sceneMeshes, selectedMeshUuid],
  );

  // Live Rig Validation & Structural Audit
  const baseAuditReport = useMemo<RigAuditReport>(
    () => runFullRigAudit(sourceGroupRef.current, bones, false),
    [bones, stats, hasCustomPainted, isBound, usePreservedNativeRig],
  );
  const rigAuditReport = lastDeformReport ?? baseAuditReport;
  const validationIssues = rigAuditReport.issues;
  const errorCount = useMemo(
    () => validationIssues.filter((i) => i.severity === 'error').length,
    [validationIssues],
  );

  // History Push / Undo / Redo
  const pushHistory = (nextBones: BoneNode[], nextKeys: AnimationKeyframe[]) => {
    const snap: HistorySnapshot = {
      bones: JSON.parse(JSON.stringify(nextBones)) as BoneNode[],
      keyframes: JSON.parse(JSON.stringify(nextKeys)) as AnimationKeyframe[],
    };
    const nextStack = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextStack.push(snap);
    if (nextStack.length > 40) nextStack.shift();
    historyRef.current = nextStack;
    historyIndexRef.current = nextStack.length - 1;
    setHistoryMeta({ index: historyIndexRef.current, length: nextStack.length });
  };

  const handleUndo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = historyRef.current[historyIndexRef.current];
    if (snap) {
      setBones(JSON.parse(JSON.stringify(snap.bones)) as BoneNode[]);
      setKeyframes(JSON.parse(JSON.stringify(snap.keyframes)) as AnimationKeyframe[]);
      setHistoryMeta({ index: historyIndexRef.current, length: historyRef.current.length });
      setStatusMsg('Undid last skeleton/keyframe change.');
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snap = historyRef.current[historyIndexRef.current];
    if (snap) {
      setBones(JSON.parse(JSON.stringify(snap.bones)) as BoneNode[]);
      setKeyframes(JSON.parse(JSON.stringify(snap.keyframes)) as AnimationKeyframe[]);
      setHistoryMeta({ index: historyIndexRef.current, length: historyRef.current.length });
      setStatusMsg('Redid skeleton/keyframe change.');
    }
  };

  const refreshSceneMetadata = (
    group: THREE.Object3D,
    nativeClips: THREE.AnimationClip[],
    existingBoneCount?: number,
  ) => {
    setStats(computeGroupStats(group, nativeClips, existingBoneCount));
    setSceneMeshes(extractSceneMeshesInfo(group));
  };

  const getEffectiveShadingMode = (): ViewportShadingMode => {
    if (stateRef.current.showHeatMap || stateRef.current.workspaceMode === 'weights') {
      return 'weights';
    }
    return stateRef.current.shadingMode;
  };

  const syncShadingAcrossActiveGroup = () => {
    const mode = getEffectiveShadingMode();
    const target = stateRef.current.isBound ? skinnedGroupRef.current : sourceGroupRef.current;
    if (!stateRef.current.isBound && stateRef.current.showMeshIssueOverlay && mode !== 'weights' && target) {
      analyzeAndHighlightMeshIssues(target, true);
      return;
    }
    applyViewportShadingToGroup(
      target,
      mode,
      stateRef.current.selectedBoneIdx,
      meshWireframeOverridesRef.current,
    );
  };

  const computeAllAutoWeights = (
    targetBones: BoneNode[],
    radius: number,
    falloff: number,
    force = false,
  ) => {
    const group = sourceGroupRef.current;
    if (!group || targetBones.length === 0) return;
    if (stateRef.current.hasCustomPainted && !force) return;
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        computeHeatMapWeightsForMesh(child as THREE.Mesh, targetBones, radius, falloff);
      }
    });
    syncShadingAcrossActiveGroup();
  };

  const rebuildIKHandlesVisuals = () => {
    const ikGroup = ikHandlesGroupRef.current;
    if (!ikGroup) return;
    while (ikGroup.children.length > 0) {
      ikGroup.remove(ikGroup.children[0]);
    }
    ikSelectableMeshesRef.current = [];
    ikHandleMeshesMapRef.current.clear();
    ikPoleLinesRef.current.clear();

    if (!stateRef.current.isBound || stateRef.current.shadingMode === 'unskinned') return;

    const limbs = stateRef.current.ikLimbs;
    (Object.keys(limbs) as IKLimbId[]).forEach((limbId) => {
      const limb = limbs[limbId];
      if (!limb.enabled) return;

      const isHand = limbId === 'leftArm' || limbId === 'rightArm';
      const isTargetSel =
        stateRef.current.activeIKHandle?.limbId === limbId &&
        stateRef.current.activeIKHandle?.role === 'target';

      // Hand = compact wireframe control cube; Foot = grounded foot plate box
      const targetGeo = isHand
        ? new THREE.BoxGeometry(0.075, 0.075, 0.075)
        : new THREE.BoxGeometry(0.11, 0.036, 0.19);
      const targetMat = new THREE.MeshBasicMaterial({
        color: isTargetSel ? 0xffffff : 0xe5a93b,
        depthTest: false,
        wireframe: true,
      });
      const targetMesh = new THREE.Mesh(targetGeo, targetMat);
      targetMesh.position.set(...limb.targetPos);
      targetMesh.renderOrder = 1004;
      targetMesh.userData = { ikLimbId: limbId, ikRole: 'target' };

      // Inner solid diamond core for easy picking
      const coreMesh = new THREE.Mesh(
        createControlShapeGeometry('diamond', 0.022),
        new THREE.MeshBasicMaterial({
          color: isTargetSel ? 0xfacc15 : 0xe5a93b,
          depthTest: false,
        }),
      );
      targetMesh.add(coreMesh);

      ikGroup.add(targetMesh);
      ikSelectableMeshesRef.current.push(targetMesh);
      ikHandleMeshesMapRef.current.set(`${limbId}:target`, targetMesh);

      // Pole target cyan octahedron handle
      const isPoleSel =
        stateRef.current.activeIKHandle?.limbId === limbId &&
        stateRef.current.activeIKHandle?.role === 'pole';
      const poleGeo = createControlShapeGeometry('diamond', 0.026);
      const poleMat = new THREE.MeshBasicMaterial({
        color: isPoleSel ? 0xffffff : 0x38bdf8,
        depthTest: false,
      });
      const poleMesh = new THREE.Mesh(poleGeo, poleMat);
      poleMesh.position.set(...limb.polePos);
      poleMesh.renderOrder = 1004;
      poleMesh.userData = { ikLimbId: limbId, ikRole: 'pole' };
      ikGroup.add(poleMesh);
      ikSelectableMeshesRef.current.push(poleMesh);
      ikHandleMeshesMapRef.current.set(`${limbId}:pole`, poleMesh);

      // Dashed guide line from mid-joint to pole target
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...limb.targetPos),
        new THREE.Vector3(...limb.polePos),
      ]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.028,
        gapSize: 0.018,
        depthTest: false,
      });
      const guideLine = new THREE.Line(lineGeo, lineMat);
      guideLine.computeLineDistances();
      guideLine.renderOrder = 1001;
      ikGroup.add(guideLine);
      ikPoleLinesRef.current.set(limbId, guideLine);
    });
  };

  const rebuildSkeletonOverlay = (targetBones: BoneNode[], activeIdx: number) => {
    const overlay = skeletonOverlayRef.current;
    const tControls = transformRef.current;
    if (!overlay) return;

    const showRigOverlay = stateRef.current.shadingMode !== 'unskinned';
    overlay.visible = showRigOverlay;

    // Update TransformControls snapping & space
    tControls?.setSpace(stateRef.current.gizmoSpace);
    if (stateRef.current.snapEnabled) {
      tControls?.setTranslationSnap(0.05);
      tControls?.setRotationSnap(THREE.MathUtils.degToRad(15));
      tControls?.setScaleSnap(0.1);
    } else {
      tControls?.setTranslationSnap(null);
      tControls?.setRotationSnap(null);
      tControls?.setScaleSnap(null);
    }

    const forceXray =
      stateRef.current.xrayBones ||
      stateRef.current.shadingMode === 'xray' ||
      stateRef.current.shadingMode === 'skeleton';

    if (!showRigOverlay) {
      tControls?.detach();
      jointHandlesRef.current = [];
      rebuildIKHandlesVisuals();
      return;
    }

    // Build real 3D Octahedral Bones + Joint Controls for BOTH Rest and Bound Modes!
    const liveMap = stateRef.current.isBound ? boundBonesMapRef.current : undefined;
    const visualRig = buildSkeletonVisuals(
      overlay,
      targetBones,
      activeIdx,
      stateRef.current.hoveredBoneIdx,
      forceXray,
      liveMap,
    );
    skeletonVisualRigRef.current = visualRig;
    jointHandlesRef.current = visualRig.jointMeshes.map((j) => j.mesh);

    if (stateRef.current.isBound) {
      rebuildIKHandlesVisuals();

      if (stateRef.current.activeIKHandle && !stateRef.current.isPlayingAnim) {
        const key = `${stateRef.current.activeIKHandle.limbId}:${stateRef.current.activeIKHandle.role}`;
        const ikHandleMesh = ikHandleMeshesMapRef.current.get(key);
        if (ikHandleMesh && tControls) {
          tControls.setMode('translate');
          tControls.attach(ikHandleMesh);
          return;
        }
      }

      const activeBoneNode = targetBones[activeIdx];
      const liveBone = activeBoneNode
        ? boundBonesMapRef.current.get(activeBoneNode.name)
        : undefined;
      if (tControls && liveBone && !stateRef.current.isPlayingAnim) {
        tControls.setMode(stateRef.current.boundGizmoMode);
        tControls.attach(liveBone);
      } else {
        tControls?.detach();
      }
      return;
    }

    // Unbound Object Mode: attach TransformControls directly to the selected mesh
    rebuildIKHandlesVisuals();
    if (stateRef.current.workspaceMode === 'object') {
      tControls?.setMode(stateRef.current.gizmoMode);
      tControls?.detach();
      let targetMesh: THREE.Object3D | null = null;
      const selUuid = stateRef.current.selectedMeshUuid;
      sourceGroupRef.current?.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          if (!targetMesh || c.uuid === selUuid) targetMesh = c;
        }
      });
      if (targetMesh) tControls?.attach(targetMesh);
      return;
    }

    // Unbound Rest Edit Mode
    tControls?.setMode(stateRef.current.gizmoMode);
    tControls?.detach();

    if (
      stateRef.current.workspaceMode !== 'weights' &&
      stateRef.current.skeletonTool === 'select-move' &&
      targetBones.length > 0
    ) {
      if (stateRef.current.pivotMode !== 'active' && pivotProxyRef.current) {
        const proxy = pivotProxyRef.current;
        if (stateRef.current.pivotMode === 'origin') {
          proxy.position.set(0, 0, 0);
        } else {
          // Median point of all bones
          const sum = new THREE.Vector3();
          targetBones.forEach((b) => sum.add(new THREE.Vector3(...b.position)));
          sum.divideScalar(targetBones.length);
          proxy.position.copy(sum);
        }
        proxy.rotation.set(0, 0, 0);
        proxy.scale.set(1, 1, 1);
        proxy.userData = { isPivotProxy: true };
        tControls?.attach(proxy);
      } else {
        const activeJointMesh = visualRig.jointMeshes[activeIdx]?.mesh;
        if (activeJointMesh) {
          tControls?.attach(activeJointMesh);
        }
      }
    }
  };

  // Auto-frame Camera helper (~74% viewport height)
  const triggerCameraAutoFrame = (preset: CameraPreset, instant = false) => {
    const cam = cameraRef.current;
    const orbit = orbitRef.current;
    const obj = (stateRef.current.isBound ? skinnedGroupRef.current : sourceGroupRef.current) ||
      sourceGroupRef.current;
    if (!cam || !orbit || !obj) return;

    const { target, position } = computeAutoFramedCameraPose(
      obj,
      cam,
      preset,
      cam.position,
      orbit.target,
    );

    if (instant) {
      camTransitionRef.current.active = false;
      orbit.target.copy(target);
      cam.position.copy(position);
      orbit.update();
    } else {
      camTransitionRef.current = {
        active: true,
        targetPos: position,
        targetLookAt: target,
      };
    }
  };

  const syncNativeWeightsToSourceGroup = (
    preservedScene: THREE.Group,
    bakedGroup: THREE.Group,
    boneList: BoneNode[],
  ) => {
    const boneIdxMap = new Map<string, number>();
    boneList.forEach((b, idx) => boneIdxMap.set(b.name, idx));

    const srcMeshes: THREE.Mesh[] = [];
    preservedScene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        const pos = m.geometry?.attributes?.position;
        if (pos && pos.count > 0) srcMeshes.push(m);
      }
    });

    const dstMeshes: THREE.Mesh[] = [];
    bakedGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) dstMeshes.push(obj as THREE.Mesh);
    });

    const count = Math.min(srcMeshes.length, dstMeshes.length);
    for (let mi = 0; mi < count; mi++) {
      const src = srcMeshes[mi];
      const dst = dstMeshes[mi];
      const sm = src as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.skeleton && src.geometry.attributes.skinIndex && src.geometry.attributes.skinWeight) {
        const sIdx = src.geometry.attributes.skinIndex as THREE.BufferAttribute;
        const sWt = src.geometry.attributes.skinWeight as THREE.BufferAttribute;
        const vCount = dst.geometry.attributes.position.count;
        if (sIdx.count === vCount && sWt.count === vCount) {
          const remap = sm.skeleton.bones.map((b) => Math.max(0, boneIdxMap.get(b.name) ?? 0));
          const newIdx = new Uint16Array(vCount * 4);
          const newWt = new Float32Array(vCount * 4);
          for (let v = 0; v < vCount; v++) {
            newIdx[v * 4] = remap[sIdx.getX(v)] ?? 0;
            newIdx[v * 4 + 1] = remap[sIdx.getY(v)] ?? 0;
            newIdx[v * 4 + 2] = remap[sIdx.getZ(v)] ?? 0;
            newIdx[v * 4 + 3] = remap[sIdx.getW(v)] ?? 0;
            let w0 = sWt.getX(v);
            let w1 = sWt.getY(v);
            let w2 = sWt.getZ(v);
            let w3 = sWt.getW(v);
            const sum = w0 + w1 + w2 + w3;
            if (sum > 1e-6) {
              w0 /= sum;
              w1 /= sum;
              w2 /= sum;
              w3 /= sum;
            } else {
              w0 = 1;
              w1 = 0;
              w2 = 0;
              w3 = 0;
            }
            newWt[v * 4] = w0;
            newWt[v * 4 + 1] = w1;
            newWt[v * 4 + 2] = w2;
            newWt[v * 4 + 3] = w3;
          }
          dst.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(newIdx, 4));
          dst.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(newWt, 4));
          continue;
        }
      }
      computeHeatMapWeightsForMesh(dst, boneList, heatRadius, heatFalloff);
    }
  };

  const applyBakedMeshToScene = (
    group: THREE.Group,
    type: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom',
    name: string,
    preset: SkeletonPresetType,
    refitBones: boolean,
    nativeClips: THREE.AnimationClip[] = [],
    existingBoneCount?: number,
    autoFrame = true,
    overrideBones?: BoneNode[],
    preservedNativeScene?: THREE.Group | null,
    targetScale = 1.0,
  ) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (sourceGroupRef.current) scene.remove(sourceGroupRef.current);
    if (skinnedGroupRef.current) scene.remove(skinnedGroupRef.current);
    skinnedGroupRef.current = null;
    mixerRef.current = null;
    activeMixerClipKeyRef.current = '';
    setIsBound(false);
    setIsPlayingAnim(false);
    setHasCustomPainted(false);
    setSelectedVertex(null);
    setLastDeformReport(null);
    if (vertexMarkerRef.current) vertexMarkerRef.current.visible = false;

    const desiredH = 1.9 * targetScale;
    const preNormalizedH = Number(group.userData?.__normalizedHeight);
    if (!Number.isFinite(preNormalizedH) || Math.abs(preNormalizedH - desiredH) > 1e-3) {
      normalizeModelToUnitHeight(group, desiredH, false);
    }
    scene.add(group);
    sourceGroupRef.current = group;
    setSourceType(type);
    setModelName(name);
    nativeClipsRef.current = nativeClips;

    const bounds = new THREE.Box3().setFromObject(group);
    modelBoundsRef.current = bounds;

    const targetBones =
      overrideBones && overrideBones.length > 0
        ? overrideBones
        : refitBones
          ? buildIntelligentHumanoidRig(group, preset)
          : stateRef.current.bones.length > 0
            ? stateRef.current.bones
            : buildIntelligentHumanoidRig(group, preset);

    if ((overrideBones && overrideBones.length > 0) || refitBones || stateRef.current.bones.length === 0) {
      setBones(targetBones);
      setSelectedBoneIdx(0);
      setIkLimbs(createDefaultIKLimbs(targetBones));
      pushHistory(targetBones, []);
      setKeyframes([]);
    }

    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.userData.__origMaterial = m.material;
      }
    });

    if (preservedNativeScene) {
      syncNativeWeightsToSourceGroup(preservedNativeScene, group, targetBones);
    } else {
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          computeHeatMapWeightsForMesh(child as THREE.Mesh, targetBones, heatRadius, heatFalloff);
        }
      });
    }

    syncShadingAcrossActiveGroup();
    rebuildSkeletonOverlay(
      targetBones,
      overrideBones || refitBones ? 0 : stateRef.current.selectedBoneIdx,
    );
    refreshSceneMetadata(group, nativeClips, existingBoneCount);

    if (autoFrame) {
      triggerCameraAutoFrame('perspective', true);
    }
  };

  const loadSubjectIntoStudio = (
    group: THREE.Group,
    type: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom',
    name: string,
    nativeClips: THREE.AnimationClip[] = [],
    existingBones: BoneNode[] = [],
    preservedSkinnedScene: THREE.Group | null = null,
    hasValidNativeRig = false,
  ) => {
    setErrorMsg(null);
    if (Number(group.userData?.__normalizedHeight) !== 1.9) {
      normalizeModelToUnitHeight(group, 1.9, type === 'glb-custom');
    }
    rawBackupGroupRef.current = cloneScenePreservingSkeleton(group);
    setMeshRotDeg([0, 0, 0]);
    setMeshScale(1.0);
    setFacialRig(DEFAULT_FACIAL);
    setShowHeatMap(false);
    setShowMeshIssueOverlay(false);
    setScanReport(null);
    setShadingMode('material');
    setActiveClip({ kind: 'preset', emote: 'walk' });
    setLastDeformReport(null);

    const adoptNative = Boolean(
      preservedSkinnedScene && hasValidNativeRig && existingBones.length > 0,
    );

    if (adoptNative && preservedSkinnedScene) {
      preservedSkinnedSceneRef.current = cloneScenePreservingSkeleton(preservedSkinnedScene);
      setUsePreservedNativeRig(true);
      setImportedExistingBones(null);
    } else {
      preservedSkinnedSceneRef.current = null;
      setUsePreservedNativeRig(false);
      setImportedExistingBones(existingBones.length > 0 ? existingBones : null);
    }

    applyBakedMeshToScene(
      group,
      type,
      name,
      skeletonPreset,
      !adoptNative,
      nativeClips,
      existingBones.length,
      true,
      adoptNative ? existingBones : undefined,
      adoptNative ? preservedSkinnedSceneRef.current : null,
      1.0,
    );
    setStatusMsg(
      adoptNative
        ? `Preserved native GLB rig for "${name}" (${existingBones.length} bones, ${nativeClips.length} clips) with intact skin weights.`
        : existingBones.length > 0
          ? `Imported "${name}" (${existingBones.length} native bones, ${nativeClips.length} clips) & auto-framed.`
          : `Loaded & framed "${name}" with ${skeletonPreset} volumetric humanoid rig.`,
    );
  };

  const handleImportFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    if (files.length === 1 && /\.(png|jpe?g|webp|bmp)$/i.test(files[0].name)) {
      const targetUuid = selectedMeshUuid || sceneMeshes[0]?.uuid;
      if (targetUuid) {
        await handleAttachTextureToMesh(targetUuid, files[0]);
      }
      return;
    }

    try {
      setErrorMsg(null);
      const pkg = await importModelFiles(files);
      loadSubjectIntoStudio(
        pkg.group,
        'glb-custom',
        pkg.modelName,
        pkg.nativeClips,
        pkg.existingBones,
        pkg.preservedSkinnedScene,
        pkg.hasValidNativeRig,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse 3D asset.';
      setErrorMsg(msg);
      setStatusMsg(`Import failed: ${msg}`);
    }
  };

  const handleAttachTextureToMesh = async (uuid: string, file: File) => {
    const group = sourceGroupRef.current;
    if (!group) return;
    let targetMesh: THREE.Mesh | null = null;
    group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.uuid === uuid) targetMesh = c as THREE.Mesh;
    });
    if (!targetMesh) return;
    try {
      await applyTextureFileToMesh(targetMesh, file);
      (targetMesh as THREE.Mesh).userData.__origMaterial = (targetMesh as THREE.Mesh).material;
      setShowHeatMap(false);
      setShadingMode('material');
      syncShadingAcrossActiveGroup();
      setStatusMsg(`Applied texture "${file.name}" to ${(targetMesh as THREE.Mesh).name}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Texture failed to load.');
    }
  };

  // Sync overlay, shading mode, snapping, and workspace changes
  useEffect(() => {
    if (!isBound && !usePreservedNativeRig && bones.length > 0) {
      computeAllAutoWeights(bones, heatRadius, heatFalloff, false);
    }
    rebuildSkeletonOverlay(bones, selectedBoneIdx);
    syncShadingAcrossActiveGroup();
  }, [
    bones,
    selectedBoneIdx,
    hoveredBoneIdx,
    selectedMeshUuid,
    showHeatMap,
    showMeshIssueOverlay,
    workspaceMode,
    shadingMode,
    skeletonTool,
    gizmoMode,
    boundGizmoMode,
    gizmoSpace,
    snapEnabled,
    pivotMode,
    isBound,
    usePreservedNativeRig,
    isPlayingAnim,
    ikLimbs,
    activeIKHandle,
    lightingConfig.xrayBones,
  ]);

  const handleChangeWorkspaceMode = (mode: StudioWorkspaceMode) => {
    setWorkspaceMode(mode);
    if (mode === 'object') {
      if (isBound) handleToggleBind(false);
      setShowHeatMap(false);
      if (shadingMode === 'weights') setShadingMode('material');
    } else if (mode === 'weights') {
      if (isBound) handleToggleBind(false);
      setShowMeshIssueOverlay(false);
      setShowHeatMap(true);
      setShadingMode('weights');
    } else if (mode === 'edit') {
      if (isBound) handleToggleBind(false);
      setShowHeatMap(false);
      if (shadingMode === 'weights') setShadingMode('material');
    } else if (mode === 'pose' || mode === 'ikfk' || mode === 'animation') {
      setShowHeatMap(false);
      setShowMeshIssueOverlay(false);
      if (shadingMode === 'weights') setShadingMode('material');
      if (!isBound) {
        handleToggleBind(mode === 'animation');
      } else if (mode === 'pose') {
        setIsPlayingAnim(false);
      }
    }
  };

  const handleChangeShadingMode = (mode: ViewportShadingMode) => {
    setShadingMode(mode);
    if (mode === 'weights') {
      if (isBound) handleToggleBind(false);
      setShowHeatMap(true);
    } else {
      setShowHeatMap(false);
    }
  };

  // Sync Viewport Lighting & Grid
  useEffect(() => {
    if (floorGridRef.current) floorGridRef.current.visible = lightingConfig.showGrid;
    if (keyLightRef.current) keyLightRef.current.intensity = lightingConfig.keyIntensity;
    if (rimLightRef.current) rimLightRef.current.intensity = lightingConfig.rimIntensity;
    if (rendererRef.current) rendererRef.current.toneMappingExposure = lightingConfig.exposure;
  }, [lightingConfig]);

  // Apply manual FK sliders when bound & paused
  useEffect(() => {
    if (!isBound || isPlayingAnim || activeIKHandle) return;
    const activeBone = bones[selectedBoneIdx];
    if (!activeBone) return;
    const threeBone = boundBonesMapRef.current.get(activeBone.name);
    if (threeBone) {
      const restRot = boundRestRotRef.current.get(activeBone.name);
      threeBone.rotation.set(
        (restRot?.x ?? 0) + manualRot.x,
        (restRot?.y ?? 0) + manualRot.y,
        (restRot?.z ?? 0) + manualRot.z,
      );
      const restPos = boundRestPosRef.current.get(activeBone.name);
      if (restPos) {
        threeBone.position.set(
          restPos.x + manualPosOffset.x,
          restPos.y + manualPosOffset.y,
          restPos.z + manualPosOffset.z,
        );
      }
      applyBoneConstraints(
        boundBonesMapRef.current,
        bones,
        boundRestRotRef.current,
        boundRestPosRef.current,
      );
    }
  }, [manualRot, manualPosOffset, selectedBoneIdx, isBound, isPlayingAnim, activeIKHandle]);

  // Apply live morph targets & facial bone offsets
  useEffect(() => {
    const group = isBound ? skinnedGroupRef.current : sourceGroupRef.current;
    if (group) {
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          if (m.morphTargetDictionary && m.morphTargetInfluences) {
            for (const [mName, val] of Object.entries(facialRig.morphInfluences)) {
              const idx = m.morphTargetDictionary[mName];
              if (idx !== undefined) m.morphTargetInfluences[idx] = val;
            }
          }
        }
      });
    }

    if (!isBound || isPlayingAnim) return;
    const jaw = boundBonesMapRef.current.get('Jaw');
    if (jaw) {
      const r = boundRestRotRef.current.get('Jaw');
      jaw.rotation.set((r?.x ?? 0) + facialRig.jawOpen, r?.y ?? 0, r?.z ?? 0);
    }
    (['LeftEye', 'RightEye'] as const).forEach((eyeName) => {
      const eye = boundBonesMapRef.current.get(eyeName);
      if (eye) {
        const r = boundRestRotRef.current.get(eyeName);
        eye.rotation.set(
          (r?.x ?? 0) + facialRig.eyeLookY,
          (r?.y ?? 0) + facialRig.eyeLookX,
          r?.z ?? 0,
        );
      }
    });
    (['Left', 'Right'] as const).forEach((side) => {
      const curl = side === 'Left' ? facialRig.leftFistCurl : facialRig.rightFistCurl;
      const sign = side === 'Left' ? -1 : 1;
      ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((f, idx) => {
        const b1 = boundBonesMapRef.current.get(`${side}${f}`);
        const b2 = boundBonesMapRef.current.get(`${side}${f}2`);
        const r1 = boundRestRotRef.current.get(`${side}${f}`);
        const r2 = boundRestRotRef.current.get(`${side}${f}2`);
        if (b1) {
          b1.rotation.set(
            (r1?.x ?? 0) + (f === 'Thumb' ? curl * 0.35 : 0),
            (r1?.y ?? 0) + (idx - 2) * facialRig.fingerSpread,
            (r1?.z ?? 0) + sign * curl * (f === 'Thumb' ? 0.55 : 1.15),
          );
        }
        if (b2) {
          b2.rotation.set(
            r2?.x ?? 0,
            r2?.y ?? 0,
            (r2?.z ?? 0) + sign * curl * 1.1,
          );
        }
      });
    });
    applyBoneConstraints(
      boundBonesMapRef.current,
      bones,
      boundRestRotRef.current,
      boundRestPosRef.current,
    );
  }, [facialRig, isBound, isPlayingAnim]);

  // Keyboard shortcuts (Ctrl+Z/Y, G/R/S gizmos, F frame, X snap)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'g' || e.key === 'G') {
        if (isBound) setBoundGizmoMode('translate');
        else setGizmoMode('translate');
      } else if (e.key === 'r' || e.key === 'R') {
        if (isBound) setBoundGizmoMode('rotate');
        else setGizmoMode('rotate');
      } else if (e.key === 's' || e.key === 'S') {
        if (isBound) setBoundGizmoMode('scale');
        else setGizmoMode('scale');
      } else if (e.key === 'f' || e.key === 'F') {
        triggerCameraAutoFrame('frame', false);
      } else if (e.key === 'x' || e.key === 'X') {
        setSnapEnabled((s) => !s);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isBound]);

  // Main WebGL Lifecycle & Render Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const studio = createStudioWebGLContext(container);
    const { renderer, isSoftwareGl, setupEnvironment, afterDraw } = studio;
    rendererRef.current = renderer;

    const handleContextLost = (ev: Event) => {
      ev.preventDefault();
      setErrorMsg('WebGL context interrupted. Restoring GPU viewport...');
    };
    const handleContextRestored = () => {
      setErrorMsg(null);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181b22);
    scene.fog = new THREE.FogExp2(0x181b22, 0.032);
    setupEnvironment(scene);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      40,
      (container.clientWidth || 720) / (container.clientHeight || 540),
      0.04,
      80,
    );
    camera.position.set(1.05, 1.32, 2.55);
    cameraRef.current = camera;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.95, 0);
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.07;
    orbit.minDistance = 0.25;
    orbit.maxDistance = 14;
    orbit.addEventListener('start', () => {
      camTransitionRef.current.active = false;
    });
    orbitRef.current = orbit;

    const pivotProxy = new THREE.Object3D();
    scene.add(pivotProxy);
    pivotProxyRef.current = pivotProxy;

    const tControls = new TransformControls(camera, renderer.domElement);
    tControls.setSize(0.72);
    tControls.addEventListener('dragging-changed', (ev) => {
      orbit.enabled = !ev.value;
      if (stateRef.current.workspaceMode === 'object' && !stateRef.current.isBound) {
        if (!ev.value && sourceGroupRef.current) {
          sourceGroupRef.current.updateMatrixWorld(true);
          modelBoundsRef.current = new THREE.Box3().setFromObject(sourceGroupRef.current);
          refreshSceneMetadata(sourceGroupRef.current, nativeClipsRef.current);
        }
        return;
      }
      if (ev.value && !stateRef.current.isBound && stateRef.current.pivotMode !== 'active') {
        pivotStartSnapshotRef.current = JSON.parse(
          JSON.stringify(stateRef.current.bones),
        ) as BoneNode[];
      }
      if (!ev.value && !stateRef.current.isBound) {
        pivotStartSnapshotRef.current = null;
        setUsePreservedNativeRig(false);
        setLastDeformReport(null);
        pushHistory(stateRef.current.bones, stateRef.current.keyframes);
      }
    });

    const tmpDeltaPos = new THREE.Vector3();
    const tmpDeltaEuler = new THREE.Vector3();
    const tmpPivotAnchor = new THREE.Vector3();
    const tmpProxyQuat = new THREE.Quaternion();

    tControls.addEventListener('objectChange', () => {
      const attached = tControls.object;
      if (!attached) return;

      // Object Mode: transforming the selected Mesh directly in 3D space
      if (!stateRef.current.isBound && stateRef.current.workspaceMode === 'object') {
        return;
      }

      // Bound Mode: IK Handle Dragging
      if (stateRef.current.isBound && attached.userData?.ikLimbId) {
        const limbId = attached.userData.ikLimbId as IKLimbId;
        const role = attached.userData.ikRole as 'target' | 'pole';
        const posTuple: [number, number, number] = [
          Number(attached.position.x.toFixed(3)),
          Number(attached.position.y.toFixed(3)),
          Number(attached.position.z.toFixed(3)),
        ];
        setIkLimbs((prev) => ({
          ...prev,
          [limbId]: {
            ...prev[limbId],
            ...(role === 'target' ? { targetPos: posTuple } : { polePos: posTuple }),
          },
        }));
        return;
      }

      // Bound Mode: FK Bone Manipulation
      if (stateRef.current.isBound && (attached as THREE.Bone).isBone) {
        const b = attached as THREE.Bone;
        const restRot = boundRestRotRef.current.get(b.name);
        setManualRot({
          x: Number((b.rotation.x - (restRot?.x ?? 0)).toFixed(2)),
          y: Number((b.rotation.y - (restRot?.y ?? 0)).toFixed(2)),
          z: Number((b.rotation.z - (restRot?.z ?? 0)).toFixed(2)),
        });
        const restPos = boundRestPosRef.current.get(b.name);
        if (restPos) {
          setManualPosOffset({
            x: Number((b.position.x - restPos.x).toFixed(3)),
            y: Number((b.position.y - restPos.y).toFixed(3)),
            z: Number((b.position.z - restPos.z).toFixed(3)),
          });
        }
        return;
      }

      // Unbound Edit Mode: Median / Origin Pivot Proxy
      if (attached.userData?.isPivotProxy && pivotStartSnapshotRef.current) {
        const snap = pivotStartSnapshotRef.current;
        if (stateRef.current.pivotMode === 'origin') {
          tmpPivotAnchor.set(0, 0, 0);
        } else {
          tmpPivotAnchor.set(0, 0, 0);
          snap.forEach((b) => tmpPivotAnchor.add(new THREE.Vector3(...b.position)));
          if (snap.length > 0) tmpPivotAnchor.divideScalar(snap.length);
        }
        tmpDeltaPos.copy(attached.position).sub(tmpPivotAnchor);
        tmpProxyQuat.copy(attached.quaternion);
        const sVec = attached.scale;

        setBones(
          snap.map((b) => {
            const rel = new THREE.Vector3(...b.position).sub(tmpPivotAnchor);
            rel.multiply(sVec).applyQuaternion(tmpProxyQuat).add(tmpPivotAnchor).add(tmpDeltaPos);
            return {
              ...b,
              position: [
                Number(rel.x.toFixed(3)),
                Number(rel.y.toFixed(3)),
                Number(rel.z.toFixed(3)),
              ],
            };
          }),
        );
        return;
      }

      // Unbound Edit Mode: Active Joint Sphere/Control Drag
      const bIdx = attached.userData.boneIndex as number | undefined;
      if (bIdx === undefined) return;
      tmpDeltaEuler.set(attached.rotation.x, attached.rotation.y, attached.rotation.z);
      const newPos: [number, number, number] = [
        Number(attached.position.x.toFixed(3)),
        Number(attached.position.y.toFixed(3)),
        Number(attached.position.z.toFixed(3)),
      ];
      const newRot: [number, number, number] = [
        Number(tmpDeltaEuler.x.toFixed(3)),
        Number(tmpDeltaEuler.y.toFixed(3)),
        Number(tmpDeltaEuler.z.toFixed(3)),
      ];
      const newScale: [number, number, number] = [
        Number(attached.scale.x.toFixed(3)),
        Number(attached.scale.y.toFixed(3)),
        Number(attached.scale.z.toFixed(3)),
      ];

      setBones((prev) => {
        const next = [...prev];
        const edited = next[bIdx];
        if (!edited) return prev;
        next[bIdx] = { ...edited, position: newPos, rotation: newRot, scale: newScale };
        if (stateRef.current.symmetry) {
          const mName = getMirrorBoneNameStrict(edited.name);
          if (mName) {
            const mIdx = next.findIndex((b) => b.name === mName);
            if (mIdx !== -1) {
              next[mIdx] = {
                ...next[mIdx],
                position: [-newPos[0], newPos[1], newPos[2]],
                rotation: [newRot[0], -newRot[1], -newRot[2]],
                scale: newScale,
              };
            }
          }
        }
        return next;
      });
    });

    scene.add(tControls.getHelper());
    transformRef.current = tControls;

    // Clean Blender/Maya Studio Floor Grid & Shadow Catcher (replaces oversized pedestal)
    const studioFloor = buildStudioFloorGroup();
    scene.add(studioFloor.floorGroup);
    floorGridRef.current = studioFloor.gridObject;

    // Balanced Studio 3-Point + Hemisphere Lighting Rig
    const hemi = new THREE.HemisphereLight(0xc7dcf7, 0x1e2430, 0.95);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e4, 2.2);
    key.position.set(3.2, 5.2, 3.8);
    key.castShadow = !isSoftwareGl;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -1.2;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    keyLightRef.current = key;

    const fill = new THREE.DirectionalLight(0xc2d8ff, 0.85);
    fill.position.set(-3.4, 2.6, 3.0);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x60a5fa, 1.85);
    rim.position.set(-3.4, 4.0, -3.5);
    scene.add(rim);
    rimLightRef.current = rim;

    const overlay = new THREE.Group();
    scene.add(overlay);
    skeletonOverlayRef.current = overlay;

    const ikGroup = new THREE.Group();
    scene.add(ikGroup);
    ikHandlesGroupRef.current = ikGroup;

    const brushCursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xe5a93b,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      }),
    );
    brushCursor.visible = false;
    scene.add(brushCursor);

    const vertexMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    vertexMarker.visible = false;
    vertexMarker.renderOrder = 1005;
    scene.add(vertexMarker);
    vertexMarkerRef.current = vertexMarker;

    const starter = createStarterRiggingSubject('knight');
    loadSubjectIntoStudio(starter, 'procedural-knight', 'Sovereign Knight Rig');

    bloomRef.current = createStudioBloomComposer(
      renderer,
      scene,
      camera,
      container.clientWidth || 720,
      container.clientHeight || 540,
      isSoftwareGl,
      0.22,
      0.4,
      0.9,
    );

    // Raycasting, Hover Labels & Pointer Tools
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let isPainting = false;
    let lastHoverRaycast = 0;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return rect;
    };

    const getSourceMeshes = (): THREE.Mesh[] => {
      const list: THREE.Mesh[] = [];
      sourceGroupRef.current?.traverse((c) => {
        if ((c as THREE.Mesh).isMesh && c.visible) list.push(c as THREE.Mesh);
      });
      return list;
    };

    const resolveMirrorBoneIndex = (): number | undefined => {
      if (!stateRef.current.symmetry) return undefined;
      const activeBone = stateRef.current.bones[stateRef.current.selectedBoneIdx];
      if (!activeBone) return undefined;
      const mirrorName = getMirrorBoneNameStrict(activeBone.name);
      if (!mirrorName) return stateRef.current.selectedBoneIdx;
      const idx = stateRef.current.bones.findIndex((b) => b.name === mirrorName);
      return idx !== -1 ? idx : undefined;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      updatePointer(e);

      // Bound Mode: Pick IK Target / Pole Handles OR pick live 3D Bones directly
      if (stateRef.current.isBound) {
        if (ikSelectableMeshesRef.current.length > 0) {
          const ikHits = raycaster.intersectObjects(ikSelectableMeshesRef.current, false);
          if (ikHits.length > 0) {
            const { ikLimbId, ikRole } = ikHits[0].object.userData as {
              ikLimbId: IKLimbId;
              ikRole: 'target' | 'pole';
            };
            setIsPlayingAnim(false);
            setActiveIKHandle({ limbId: ikLimbId, role: ikRole });
            return;
          }
        }
        if (jointHandlesRef.current.length > 0 && stateRef.current.shadingMode !== 'unskinned') {
          const jHits = raycaster.intersectObjects(jointHandlesRef.current, false);
          if (jHits.length > 0) {
            const bIdx = jHits[0].object.userData.boneIndex as number;
            setIsPlayingAnim(false);
            setActiveIKHandle(null);
            setSelectedBoneIdx(bIdx);
            return;
          }
        }
        return;
      }

      // Weight Paint Mode
      if (stateRef.current.workspaceMode === 'weights' || stateRef.current.shadingMode === 'weights') {
        const meshHits = raycaster.intersectObjects(getSourceMeshes(), false);
        if (meshHits.length > 0) {
          const hit = meshHits[0];
          const hitMesh = hit.object as THREE.Mesh;

          if (stateRef.current.weightSubTool === 'inspect') {
            const info = pickClosestVertexInfluence(hitMesh, hit.point, stateRef.current.bones);
            if (info) {
              setSelectedVertex(info);
              if (vertexMarkerRef.current) {
                vertexMarkerRef.current.position.set(...info.worldPos);
                vertexMarkerRef.current.visible = true;
              }
            }
            return;
          }

          isPainting = true;
          orbit.enabled = false;
          setUsePreservedNativeRig(false);
          setLastDeformReport(null);
          setHasCustomPainted(true);
          const mirrorIdx = resolveMirrorBoneIndex();
          getSourceMeshes().forEach((m) => {
            paintHeatWeightOnMesh(
              m,
              stateRef.current.selectedBoneIdx,
              hit.point,
              stateRef.current.brushRadius,
              stateRef.current.brushStrength,
              stateRef.current.paintMode,
              mirrorIdx,
            );
            applyHeatMapVertexColors(m, stateRef.current.selectedBoneIdx);
          });
        }
        return;
      }

      // Object Mode: pick any mesh in the scene directly
      if (stateRef.current.workspaceMode === 'object') {
        const meshHits = raycaster.intersectObjects(getSourceMeshes(), false);
        if (meshHits.length > 0) {
          setSelectedMeshUuid(meshHits[0].object.uuid);
        }
        return;
      }

      // Skeleton Mode
      if (stateRef.current.skeletonTool === 'select-move') {
        const jointHits = raycaster.intersectObjects(jointHandlesRef.current, false);
        if (jointHits.length > 0) {
          const idx = jointHits[0].object.userData.boneIndex as number;
          setSelectedBoneIdx(idx);
          return;
        }
        // Also allow picking mesh objects to inspect
        const meshHits = raycaster.intersectObjects(getSourceMeshes(), false);
        if (meshHits.length > 0) {
          setSelectedMeshUuid(meshHits[0].object.uuid);
        }
      }

      if (stateRef.current.skeletonTool === 'place-bone') {
        const meshHits = raycaster.intersectObjects(getSourceMeshes(), false);
        if (meshHits.length > 0) {
          const pt = meshHits[0].point;
          const parentBone =
            stateRef.current.bones[stateRef.current.selectedBoneIdx]?.name || null;
          const newName = `Bone_${stateRef.current.bones.length + 1}`;
          const newNode: BoneNode = {
            name: newName,
            parent: parentBone,
            position: [Number(pt.x.toFixed(3)), Number(pt.y.toFixed(3)), Number(pt.z.toFixed(3))],
          };
          const next = [...stateRef.current.bones, newNode];
          setUsePreservedNativeRig(false);
          setLastDeformReport(null);
          setBones(next);
          setSelectedBoneIdx(next.length - 1);
          pushHistory(next, stateRef.current.keyframes);
          setStatusMsg(`Placed "${newName}" under "${parentBone || 'Root'}".`);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = updatePointer(e);

      // Weight brush preview & stroke painting
      if (
        !stateRef.current.isBound &&
        (stateRef.current.workspaceMode === 'weights' || stateRef.current.shadingMode === 'weights') &&
        stateRef.current.weightSubTool === 'brush'
      ) {
        const meshHits = raycaster.intersectObjects(getSourceMeshes(), false);
        if (meshHits.length > 0) {
          const pt = meshHits[0].point;
          brushCursor.visible = true;
          brushCursor.position.copy(pt);
          brushCursor.scale.setScalar(stateRef.current.brushRadius);
          if (isPainting) {
            const mirrorIdx = resolveMirrorBoneIndex();
            getSourceMeshes().forEach((m) => {
              paintHeatWeightOnMesh(
                m,
                stateRef.current.selectedBoneIdx,
                pt,
                stateRef.current.brushRadius,
                stateRef.current.brushStrength * 0.45,
                stateRef.current.paintMode,
                mirrorIdx,
              );
              applyHeatMapVertexColors(m, stateRef.current.selectedBoneIdx);
            });
          }
        } else {
          brushCursor.visible = false;
        }
        return;
      }

      brushCursor.visible = false;

      // Throttled joint/IK hover highlighting + bone name tooltip
      const now = performance.now();
      if (now - lastHoverRaycast < 45 || tControls.dragging) return;
      lastHoverRaycast = now;

      if (stateRef.current.shadingMode === 'unskinned') {
        if (stateRef.current.hoveredBoneIdx !== null) setHoveredBoneIdx(null);
        setHoveredLabel(null);
        return;
      }

      if (stateRef.current.isBound && ikSelectableMeshesRef.current.length > 0) {
        const ikHits = raycaster.intersectObjects(ikSelectableMeshesRef.current, false);
        if (ikHits.length > 0) {
          const { ikLimbId, ikRole } = ikHits[0].object.userData as {
            ikLimbId: IKLimbId;
            ikRole: string;
          };
          setHoveredLabel({
            text: `${ikLimbId} · ${ikRole === 'target' ? 'IK Target' : 'Pole Vector'}`,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          renderer.domElement.style.cursor = 'pointer';
          return;
        }
      }

      if (jointHandlesRef.current.length > 0) {
        const jHits = raycaster.intersectObjects(jointHandlesRef.current, false);
        if (jHits.length > 0) {
          const idx = jHits[0].object.userData.boneIndex as number;
          const b = stateRef.current.bones[idx];
          if (stateRef.current.hoveredBoneIdx !== idx) setHoveredBoneIdx(idx);
          if (b) {
            setHoveredLabel({
              text: b.parent ? `${b.name} ← ${b.parent}` : `${b.name} (Root)`,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
          }
          renderer.domElement.style.cursor = 'pointer';
          return;
        }
      }

      if (stateRef.current.hoveredBoneIdx !== null) setHoveredBoneIdx(null);
      setHoveredLabel(null);
      renderer.domElement.style.cursor = 'default';
    };

    const onPointerUp = () => {
      if (isPainting) {
        isPainting = false;
        orbit.enabled = true;
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 720;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      bloomRef.current?.resize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    const tmpTarget = new THREE.Vector3();
    const tmpPole = new THREE.Vector3();
    const tmpMidWorld = new THREE.Vector3();
    const tmpPoleWorld = new THREE.Vector3();
    const invCamQ = new THREE.Quaternion();
    const axX = new THREE.Vector3();
    const axY = new THREE.Vector3();
    const axZ = new THREE.Vector3();
    let uiSyncCounter = 0;
    let triadCounter = 0;
    let frameId = 0;
    let disposed = false;

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);

      // Smooth damped camera preset transitions
      if (camTransitionRef.current.active) {
        const lambda = 11;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, camTransitionRef.current.targetPos.x, lambda, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, camTransitionRef.current.targetPos.y, lambda, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, camTransitionRef.current.targetPos.z, lambda, dt);
        orbit.target.x = THREE.MathUtils.damp(orbit.target.x, camTransitionRef.current.targetLookAt.x, lambda, dt);
        orbit.target.y = THREE.MathUtils.damp(orbit.target.y, camTransitionRef.current.targetLookAt.y, lambda, dt);
        orbit.target.z = THREE.MathUtils.damp(orbit.target.z, camTransitionRef.current.targetLookAt.z, lambda, dt);
        if (
          camera.position.distanceToSquared(camTransitionRef.current.targetPos) < 1e-4 &&
          orbit.target.distanceToSquared(camTransitionRef.current.targetLookAt) < 1e-4
        ) {
          camera.position.copy(camTransitionRef.current.targetPos);
          orbit.target.copy(camTransitionRef.current.targetLookAt);
          camTransitionRef.current.active = false;
        }
      }

      orbit.update();

      // Update corner 3D Axis Orientation Triad (~15Hz)
      triadCounter += 1;
      if (triadCounter % 4 === 0) {
        invCamQ.copy(camera.quaternion).invert();
        axX.set(1, 0, 0).applyQuaternion(invCamQ);
        axY.set(0, 1, 0).applyQuaternion(invCamQ);
        axZ.set(0, 0, 1).applyQuaternion(invCamQ);
        setTriadAxes({
          x: [Number(axX.x.toFixed(2)), Number((-axX.y).toFixed(2))],
          y: [Number(axY.x.toFixed(2)), Number((-axY.y).toFixed(2))],
          z: [Number(axZ.x.toFixed(2)), Number((-axZ.y).toFixed(2))],
        });
      }

      const st = stateRef.current;

      if (st.isBound && skinnedGroupRef.current) {
        if (st.isPlayingAnim) {
          animTimeRef.current += dt * st.animSpeed;
          if (animTimeRef.current >= st.timelineDuration) {
            if (st.loopAnim) {
              animTimeRef.current %= Math.max(0.1, st.timelineDuration);
            } else {
              animTimeRef.current = st.timelineDuration;
              setIsPlayingAnim(false);
            }
          }

          uiSyncCounter += 1;
          if (uiSyncCounter % 3 === 0) {
            setTimelineTime(Number(animTimeRef.current.toFixed(2)));
          }

          if (st.activeClip.kind === 'preset') {
            applyAvatarAnimation(
              boundBonesMapRef.current,
              st.activeClip.emote,
              animTimeRef.current,
              boundRestPosRef.current,
              boundRestRotRef.current,
            );
          } else if (st.activeClip.kind === 'custom' && st.keyframes.length > 0 && mixerRef.current) {
            const sig = `custom_${st.keyframes.length}_${st.timelineDuration}`;
            if (activeMixerClipKeyRef.current !== sig) {
              mixerRef.current.stopAllAction();
              const clip = compileClipFromKeyframes(
                st.keyframes,
                st.bones.map((b) => b.name),
                boundRestPosRef.current,
                boundRestRotRef.current,
                'Custom_Pose_Sequence',
                st.timelineDuration,
              );
              mixerRef.current.clipAction(clip).play();
              activeMixerClipKeyRef.current = sig;
            }
            mixerRef.current.setTime(animTimeRef.current);
          } else if (
            st.activeClip.kind === 'native' &&
            nativeClipsRef.current[st.activeClip.index] &&
            mixerRef.current
          ) {
            const sig = `native_${st.activeClip.index}`;
            if (activeMixerClipKeyRef.current !== sig) {
              mixerRef.current.stopAllAction();
              const clip = nativeClipsRef.current[st.activeClip.index];
              mixerRef.current.clipAction(clip).play();
              activeMixerClipKeyRef.current = sig;
            }
            mixerRef.current.setTime(animTimeRef.current);
          }
        }

        // Two-Bone Analytical IK Solver
        (Object.keys(st.ikLimbs) as IKLimbId[]).forEach((limbId) => {
          const limb = st.ikLimbs[limbId];
          if (!limb.enabled) return;
          const rBone = boundBonesMapRef.current.get(limb.rootBone);
          const mBone = boundBonesMapRef.current.get(limb.midBone);
          const eBone = boundBonesMapRef.current.get(limb.endBone);
          if (rBone && mBone && eBone) {
            tmpTarget.set(...limb.targetPos);
            tmpPole.set(...limb.polePos);
            solveTwoBoneIK(rBone, mBone, eBone, tmpTarget, tmpPole, limb.blend);

            const line = ikPoleLinesRef.current.get(limbId);
            if (line) {
              mBone.getWorldPosition(tmpMidWorld);
              tmpPoleWorld.set(...limb.polePos);
              const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
              posAttr.setXYZ(0, tmpMidWorld.x, tmpMidWorld.y, tmpMidWorld.z);
              posAttr.setXYZ(1, tmpPoleWorld.x, tmpPoleWorld.y, tmpPoleWorld.z);
              posAttr.needsUpdate = true;
              line.computeLineDistances();
            }
          }
        });

        applyBoneConstraints(
          boundBonesMapRef.current,
          st.bones,
          boundRestRotRef.current,
          boundRestPosRef.current,
        );

        // Real-time Octahedral Skeleton sync in Bound Pose / Animation Mode!
        if (skeletonVisualRigRef.current && st.shadingMode !== 'unskinned') {
          skinnedGroupRef.current.updateMatrixWorld(true);
          syncSkeletonVisualsFromLiveBones(skeletonVisualRigRef.current, boundBonesMapRef.current);
        }
      }

      if (bloomRef.current) bloomRef.current.composer.render();
      else renderer.render(scene, camera);
      if (isSoftwareGl) frameId = afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      window.removeEventListener('pointerup', onPointerUp);
      bloomRef.current?.dispose();
      bloomRef.current = null;
      studioFloor.dispose();
      tControls.dispose();
      orbit.dispose();
      studio.dispose();
    };
  }, []);

  // Bind / Unbind SkinnedMesh
  const handleToggleBind = (autoPlay = false) => {
    const scene = sceneRef.current;
    const src = sourceGroupRef.current;
    if (!scene || !src || bones.length === 0) return;

    if (isBound) {
      if (skinnedGroupRef.current) {
        scene.remove(skinnedGroupRef.current);
        skinnedGroupRef.current = null;
      }
      mixerRef.current = null;
      activeMixerClipKeyRef.current = '';
      src.visible = true;
      setIsBound(false);
      setIsPlayingAnim(false);
      setActiveIKHandle(null);
      setStatusMsg('Returned to Rest Skeleton & Weight Paint workspace.');
      return;
    }

    // Ensure clean PBR materials are active before creating SkinnedMesh clones
    if (showMeshIssueOverlay) {
      analyzeAndHighlightMeshIssues(src, false);
      setShowMeshIssueOverlay(false);
    }
    applyViewportShadingToGroup(
      src,
      'material',
      selectedBoneIdx,
      meshWireframeOverridesRef.current,
    );

    const useNative = Boolean(usePreservedNativeRig && preservedSkinnedSceneRef.current);
    if (!useNative && !hasCustomPainted) {
      computeAllAutoWeights(bones, heatRadius, heatFalloff, true);
    }

    const bound =
      useNative && preservedSkinnedSceneRef.current
        ? extractPreservedBoundRig(preservedSkinnedSceneRef.current)
        : bindSkeletonToModelGroup(src, bones);
    src.visible = false;
    transformRef.current?.detach();
    if (vertexMarkerRef.current) vertexMarkerRef.current.visible = false;

    if (skinnedGroupRef.current) scene.remove(skinnedGroupRef.current);

    scene.add(bound.skinnedGroup);
    skinnedGroupRef.current = bound.skinnedGroup;
    boundBonesMapRef.current = bound.bonesByName;
    boundRestPosRef.current = bound.restPositions;
    boundRestRotRef.current = bound.restRotations;

    // Cache original PBR material on skinned meshes so all 7 shading modes work while bound
    bound.skinnedGroup.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).userData.__origMaterial = (c as THREE.Mesh).material;
      }
    });

    mixerRef.current = new THREE.AnimationMixer(bound.skinnedGroup);
    activeMixerClipKeyRef.current = '';

    setIkLimbs((prev) => {
      const defaults = createDefaultIKLimbs(bones);
      (Object.keys(defaults) as IKLimbId[]).forEach((id) => {
        defaults[id].enabled = prev[id]?.enabled ?? false;
        defaults[id].blend = prev[id]?.blend ?? 1.0;
      });
      return defaults;
    });

    setIsBound(true);
    setIsPlayingAnim(autoPlay);
    animTimeRef.current = 0;
    setTimelineTime(0);
    setManualRot({ x: 0, y: 0, z: 0 });
    setManualPosOffset({ x: 0, y: 0, z: 0 });
    setStatusMsg(
      autoPlay
        ? 'SkinnedMesh bound & playing animation. Test IK/FK or scrub the timeline.'
        : 'SkinnedMesh bound. Drag any octahedral joint or enable IK hand/foot targets.',
    );
  };

  // Timeline Scrubbing & Playback
  const handleScrubTime = (t: number) => {
    animTimeRef.current = t;
    setTimelineTime(t);
    setIsPlayingAnim(false);
    if (!isBound) {
      handleToggleBind(false);
      return;
    }
    if (activeClip.kind === 'preset') {
      applyAvatarAnimation(
        boundBonesMapRef.current,
        activeClip.emote,
        t,
        boundRestPosRef.current,
        boundRestRotRef.current,
      );
    } else if (activeClip.kind === 'custom' && keyframes.length > 0 && mixerRef.current) {
      const clip = compileClipFromKeyframes(
        keyframes,
        bones.map((b) => b.name),
        boundRestPosRef.current,
        boundRestRotRef.current,
        'Custom_Pose_Sequence',
        timelineDuration,
      );
      mixerRef.current.stopAllAction();
      mixerRef.current.clipAction(clip).play();
      mixerRef.current.setTime(t);
    } else if (
      activeClip.kind === 'native' &&
      nativeClipsRef.current[activeClip.index] &&
      mixerRef.current
    ) {
      mixerRef.current.stopAllAction();
      mixerRef.current.clipAction(nativeClipsRef.current[activeClip.index]).play();
      mixerRef.current.setTime(t);
    }
  };

  const handleStopAndResetPose = () => {
    setIsPlayingAnim(false);
    animTimeRef.current = 0;
    setTimelineTime(0);
    if (!isBound) return;
    for (const [name, bone] of boundBonesMapRef.current.entries()) {
      const rp = boundRestPosRef.current.get(name);
      const rr = boundRestRotRef.current.get(name);
      if (rp) bone.position.copy(rp);
      if (rr) bone.rotation.copy(rr);
      else bone.rotation.set(0, 0, 0);
      bone.scale.set(1, 1, 1);
    }
    setManualRot({ x: 0, y: 0, z: 0 });
    setManualPosOffset({ x: 0, y: 0, z: 0 });
    setFacialRig((f) => ({
      ...f,
      jawOpen: 0,
      eyeLookX: 0,
      eyeLookY: 0,
      leftFistCurl: 0,
      rightFistCurl: 0,
      fingerSpread: 0,
    }));
    setIkLimbs((prev) => {
      const fresh = createDefaultIKLimbs(bones);
      (Object.keys(fresh) as IKLimbId[]).forEach((id) => {
        fresh[id].enabled = prev[id].enabled;
        fresh[id].blend = prev[id].blend;
      });
      return fresh;
    });
  };

  const handleInsertKeyframe = () => {
    if (!isBound) {
      handleToggleBind(false);
      setStatusMsg('Bound SkinnedMesh first. Pose any bone or IK limb, then click + Keyframe again.');
      return;
    }
    setIsPlayingAnim(false);
    const snapshot = captureCurrentPoseAsKey(
      boundBonesMapRef.current,
      boundRestPosRef.current,
      boundRestRotRef.current,
    );
    const roundedTime = Number(timelineTime.toFixed(2));
    const existing = keyframes.find((k) => Math.abs(k.time - roundedTime) < 0.04);
    let nextKeys: AnimationKeyframe[];
    let selId: string;
    if (existing) {
      selId = existing.id;
      nextKeys = keyframes.map((k) =>
        k.id === existing.id ? { ...k, boneTransforms: snapshot } : k,
      );
    } else {
      selId = `kf_${Date.now().toString(36)}`;
      nextKeys = [...keyframes, { id: selId, time: roundedTime, boneTransforms: snapshot }].sort(
        (a, b) => a.time - b.time,
      );
    }
    setKeyframes(nextKeys);
    setSelectedKeyframeId(selId);
    setActiveClip({ kind: 'custom' });
    activeMixerClipKeyRef.current = '';
    pushHistory(bones, nextKeys);
    setStatusMsg(`Recorded keyframe at ${roundedTime.toFixed(2)}s (${Object.keys(snapshot).length} bones).`);
  };

  const handleDeleteSelectedKeyframe = () => {
    if (!selectedKeyframeId) return;
    const nextKeys = keyframes.filter((k) => k.id !== selectedKeyframeId);
    setKeyframes(nextKeys);
    setSelectedKeyframeId(nextKeys[0]?.id ?? null);
    activeMixerClipKeyRef.current = '';
    pushHistory(bones, nextKeys);
  };

  const handleExportAnimationJSON = () => {
    const clipName = modelName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'sovereign_anim';
    const json = serializeAnimationClipJSON(clipName, timelineDuration, keyframes);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clipName}_clip.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`Exported ${keyframes.length} animation keyframe(s) to ${a.download}.`);
  };

  const handleImportAnimationFile = async (file: File) => {
    setErrorMsg(null);
    try {
      const parsed = await parseImportedAnimationFile(file, boundRestRotRef.current);
      if (!isBound) handleToggleBind(false);
      setKeyframes(parsed.keyframes);
      setTimelineDuration(parsed.duration);
      setSelectedKeyframeId(parsed.keyframes[0]?.id ?? null);
      setActiveClip({ kind: 'custom' });
      activeMixerClipKeyRef.current = '';
      pushHistory(bones, parsed.keyframes);
      setStatusMsg(
        `Imported clip "${parsed.name}" (${parsed.keyframes.length} keyframes, ${parsed.duration.toFixed(1)}s).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import animation clip.');
    }
  };

  // Mesh Outliner Visibility & Wireframe
  const handleToggleMeshVisible = (uuid: string) => {
    const group = sourceGroupRef.current;
    if (!group) return;
    group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.uuid === uuid) c.visible = !c.visible;
    });
    setSceneMeshes(extractSceneMeshesInfo(group));
  };

  const handleToggleMeshWireframe = (uuid: string) => {
    if (meshWireframeOverridesRef.current.has(uuid)) {
      meshWireframeOverridesRef.current.delete(uuid);
    } else {
      meshWireframeOverridesRef.current.add(uuid);
    }
    syncShadingAcrossActiveGroup();
    if (sourceGroupRef.current) setSceneMeshes(extractSceneMeshesInfo(sourceGroupRef.current));
  };

  // Weight Utility Operations
  const withWeightRefresh = (fn: (m: THREE.Mesh) => void, msg: string) => {
    const group = sourceGroupRef.current;
    if (!group || isBound) return;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(true);
    group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) fn(c as THREE.Mesh);
    });
    syncShadingAcrossActiveGroup();
    setStatusMsg(msg);
  };

  const handleEditVertexSlotWeight = (slot: number, boneIndex: number, weight: number) => {
    if (!selectedVertex || isBound || !sourceGroupRef.current) return;
    let targetMesh: THREE.Mesh | null = null;
    sourceGroupRef.current.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.uuid === selectedVertex.meshUuid) {
        targetMesh = c as THREE.Mesh;
      }
    });
    if (!targetMesh) return;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(true);
    setVertexSlotWeight(targetMesh, selectedVertex.vertexIndex, slot, boneIndex, weight);
    applyHeatMapVertexColors(targetMesh, selectedBoneIdx);
    const updated = pickClosestVertexInfluence(
      targetMesh,
      new THREE.Vector3(...selectedVertex.worldPos),
      bones,
    );
    if (updated) setSelectedVertex(updated);
  };

  // Bone Editing Handlers
  const handleAddChildBone = () => {
    const parent = bones[selectedBoneIdx]?.name || null;
    const base = bones[selectedBoneIdx]?.position || [0, 1.0, 0];
    const newName = `Bone_${bones.length + 1}`;
    const next = [
      ...bones,
      {
        name: newName,
        parent,
        position: [base[0], Number((base[1] + 0.12).toFixed(3)), base[2]] as [number, number, number],
      },
    ];
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(false);
    setBones(next);
    setSelectedBoneIdx(next.length - 1);
    pushHistory(next, keyframes);
  };

  const handleAddBoneChain = () => {
    const parentBone = bones[selectedBoneIdx];
    const parentName = parentBone?.name || null;
    const base = parentBone?.position || [0, 1.0, 0];
    const idxOffset = bones.length + 1;
    const seg1: BoneNode = {
      name: `Chain_${idxOffset}_1`,
      parent: parentName,
      position: [base[0], Number((base[1] + 0.1).toFixed(3)), Number((base[2] - 0.04).toFixed(3))],
      connected: true,
    };
    const seg2: BoneNode = {
      name: `Chain_${idxOffset}_2`,
      parent: seg1.name,
      position: [base[0], Number((base[1] + 0.21).toFixed(3)), Number((base[2] - 0.09).toFixed(3))],
      connected: true,
    };
    const seg3: BoneNode = {
      name: `Chain_${idxOffset}_3`,
      parent: seg2.name,
      position: [base[0], Number((base[1] + 0.32).toFixed(3)), Number((base[2] - 0.14).toFixed(3))],
      connected: true,
    };
    const next = [...bones, seg1, seg2, seg3];
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(false);
    setBones(next);
    setSelectedBoneIdx(next.length - 1);
    pushHistory(next, keyframes);
    setStatusMsg(`Added connected 3-bone chain from "${parentName || 'Root'}".`);
  };

  const handleAddSymmetryPair = () => {
    const base = bones[selectedBoneIdx]?.position || [0.25, 1.2, 0];
    const parent = bones[selectedBoneIdx]?.name || 'Chest';
    const baseNum = bones.length + 1;
    const absX = Math.max(0.08, Math.abs(base[0]));
    const rightParent = getMirrorBoneNameStrict(parent);
    const rightParentValid =
      rightParent && bones.some((b) => b.name === rightParent) ? rightParent : parent;
    const next: BoneNode[] = [
      ...bones,
      {
        name: `LeftCustom_${baseNum}`,
        parent,
        position: [Number(absX.toFixed(3)), Number((base[1] + 0.08).toFixed(3)), base[2]],
      },
      {
        name: `RightCustom_${baseNum}`,
        parent: rightParentValid,
        position: [Number((-absX).toFixed(3)), Number((base[1] + 0.08).toFixed(3)), base[2]],
      },
    ];
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(false);
    setBones(next);
    setSelectedBoneIdx(next.length - 2);
    pushHistory(next, keyframes);
  };

  const handleDuplicateBone = () => {
    const src = bones[selectedBoneIdx];
    if (!src) return;
    const next: BoneNode[] = [
      ...bones,
      {
        ...src,
        name: `${src.name}_Copy_${bones.length + 1}`.slice(0, 38),
        position: [src.position[0], Number((src.position[1] + 0.08).toFixed(3)), src.position[2]],
      },
    ];
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(false);
    setBones(next);
    setSelectedBoneIdx(next.length - 1);
    pushHistory(next, keyframes);
  };

  const handleDeleteBone = () => {
    if (bones.length <= 1) return;
    const target = bones[selectedBoneIdx];
    if (!target) return;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setHasCustomPainted(false);
    const next = bones
      .filter((_, idx) => idx !== selectedBoneIdx)
      .map((b) => (b.parent === target.name ? { ...b, parent: target.parent } : b));
    setBones(next);
    setSelectedBoneIdx(Math.max(0, selectedBoneIdx - 1));
    pushHistory(next, keyframes);
  };

  const handleRenameBone = (newNameRaw: string) => {
    const oldBone = bones[selectedBoneIdx];
    if (!oldBone) return;
    const clean = newNameRaw.trim();
    if (!clean || clean === oldBone.name || bones.some((b) => b.name === clean)) return;
    const oldName = oldBone.name;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    const next = bones.map((b, idx) => ({
      ...b,
      name: idx === selectedBoneIdx ? clean : b.name,
      parent: b.parent === oldName ? clean : b.parent,
    }));
    setBones(next);
    pushHistory(next, keyframes);
  };

  const handleUpdateBoneProp = (patch: Partial<BoneNode>) => {
    const edited = bones[selectedBoneIdx];
    if (!edited) return;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setBones((prev) => {
      const next = [...prev];
      next[selectedBoneIdx] = { ...edited, ...patch };
      if (
        symmetry &&
        (patch.position ||
          patch.rotation ||
          patch.scale ||
          patch.roll !== undefined ||
          patch.connected !== undefined ||
          patch.weightScale !== undefined)
      ) {
        const mName = getMirrorBoneNameStrict(edited.name);
        if (mName) {
          const mIdx = next.findIndex((b) => b.name === mName);
          if (mIdx !== -1) {
            next[mIdx] = {
              ...next[mIdx],
              ...(patch.position
                ? { position: [-patch.position[0], patch.position[1], patch.position[2]] }
                : {}),
              ...(patch.rotation
                ? { rotation: [patch.rotation[0], -patch.rotation[1], -patch.rotation[2]] }
                : {}),
              ...(patch.scale ? { scale: patch.scale } : {}),
              ...(patch.roll !== undefined ? { roll: -patch.roll } : {}),
              ...(patch.connected !== undefined ? { connected: patch.connected } : {}),
              ...(patch.weightScale !== undefined ? { weightScale: patch.weightScale } : {}),
            };
          }
        }
      }
      return next;
    });
  };

  const handleApplyPreset = (preset: SkeletonPresetType) => {
    if (isBound || !sourceGroupRef.current) return;
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setSkeletonPreset(preset);
    setHasCustomPainted(false);
    const auto = buildIntelligentHumanoidRig(sourceGroupRef.current, preset);
    setBones(auto);
    setSelectedBoneIdx(0);
    setIkLimbs(createDefaultIKLimbs(auto));
    pushHistory(auto, keyframes);
    setStatusMsg(`Auto-rigged ${auto.length} volumetric bones (${preset}).`);
  };

  const handleUseImportedSkeleton = () => {
    if (!importedExistingBones || importedExistingBones.length === 0 || isBound) return;
    setLastDeformReport(null);
    setHasCustomPainted(false);
    setBones(importedExistingBones);
    setSelectedBoneIdx(0);
    setIkLimbs(createDefaultIKLimbs(importedExistingBones));
    pushHistory(importedExistingBones, keyframes);
    setImportedExistingBones(null);
    setStatusMsg(`Adopted ${importedExistingBones.length} native bones from imported 3D file.`);
  };

  const handleRunDeformationAudit = () => {
    const target =
      usePreservedNativeRig && preservedSkinnedSceneRef.current
        ? preservedSkinnedSceneRef.current
        : sourceGroupRef.current;
    const report = runFullRigAudit(target, bones, true);
    setLastDeformReport(report);
    setStatusMsg(
      report.overallPassed
        ? `Deformation test passed across ${report.deformationResults.length} anatomical joints.`
        : 'Rig audit found structural or deformation issues. Inspect details in Rig Audit.',
    );
  };

  const handleAutoFixValidation = () => {
    if (isBound) handleToggleBind(false);
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    let fixedBones = autoFixRigHierarchy(bones);
    if (fixedBones.length === 0 && sourceGroupRef.current) {
      fixedBones = buildIntelligentHumanoidRig(sourceGroupRef.current, skeletonPreset);
    }
    setBones(fixedBones);
    if (sourceGroupRef.current) {
      sourceGroupRef.current.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = c as THREE.Mesh;
          if (!m.geometry.attributes.skinIndex || !m.geometry.attributes.skinWeight) {
            computeHeatMapWeightsForMesh(m, fixedBones, heatRadius, heatFalloff);
          } else {
            normalizeWeightsOnMesh(m, fixedBones.length);
          }
        }
      });
    }
    pushHistory(fixedBones, keyframes);
    setStatusMsg('Auto-fixed skeleton hierarchy links, scales & skin weight normalization.');
  };

  const handleFocusBone = () => {
    const b = bones[selectedBoneIdx];
    const orbit = orbitRef.current;
    const cam = cameraRef.current;
    if (!b || !orbit || !cam) return;
    const target = new THREE.Vector3(...b.position);
    const isFine = /Thumb|Index|Middle|Ring|Pinky|Hand|Foot|Toe|Jaw|Eye|Head/i.test(b.name);
    const offset = isFine ? new THREE.Vector3(0.24, 0.1, 0.34) : new THREE.Vector3(0.28, 0.2, 0.95);
    camTransitionRef.current = {
      active: true,
      targetLookAt: target,
      targetPos: target.clone().add(offset),
    };
  };

  // Scan & Repair Rig: validates GLB skeleton, repairs missing bones, rescales to 1.9m humanoid base & paints topology issue heat map
  const handleScanAndRepairRig = () => {
    const src = sourceGroupRef.current;
    if (!src) return;
    if (isBound) handleToggleBind(false);

    setScanningRig(true);
    setErrorMsg(null);
    setShowHeatMap(false);
    if (shadingMode === 'weights') setShadingMode('material');

    try {
      // Restore clean materials prior to scan so __origMaterial stays accurate
      analyzeAndHighlightMeshIssues(src, false);
      applyViewportShadingToGroup(
        src,
        'material',
        selectedBoneIdx,
        meshWireframeOverridesRef.current,
      );

      const report = scanAndCorrectGLBSkeleton(
        src,
        bones,
        skeletonPreset,
        heatRadius,
        heatFalloff,
        true,
      );

      setUsePreservedNativeRig(false);
      setImportedExistingBones(null);
      setHasCustomPainted(false);
      setBones(report.bones);
      setSelectedBoneIdx(0);
      setIkLimbs(createDefaultIKLimbs(report.bones));
      setLastDeformReport(report.auditReport);
      setScanReport(report);
      setShowMeshIssueOverlay(true);
      pushHistory(report.bones, keyframes);

      modelBoundsRef.current = new THREE.Box3().setFromObject(src);
      refreshSceneMetadata(src, nativeClipsRef.current, report.bones.length);
      triggerCameraAutoFrame('perspective', false);

      const issueCount =
        report.meshIssues.nonManifoldEdges +
        report.meshIssues.boundaryEdges +
        report.meshIssues.degenerateTriangles;
      setStatusMsg(
        `Scan & Repair complete (${report.bones.length} bones${report.missingRolesDetected.length > 0 ? `, patched ${report.missingRolesDetected.length} missing` : ''}${report.rescaledToBase ? ', rescaled 1.9m' : ''}). Mesh heat map: ${issueCount} topology flag(s).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Scan & Repair failed.');
    } finally {
      setScanningRig(false);
    }
  };

  const handleToggleMeshIssueOverlay = (show: boolean) => {
    setShowMeshIssueOverlay(show);
    if (sourceGroupRef.current) {
      analyzeAndHighlightMeshIssues(sourceGroupRef.current, show);
    }
    if (!show) {
      syncShadingAcrossActiveGroup();
    }
  };

  // Export .GLB & .GLTF including Skeleton, Weights & Compiled AnimationClips
  const handleExport = async (binary: boolean) => {
    const src = sourceGroupRef.current;
    if (!src || bones.length === 0) return;

    const audit = runFullRigAudit(src, bones, false);
    if (!audit.overallPassed) {
      const firstErr = audit.issues.find((i) => i.severity === 'error');
      setErrorMsg(
        firstErr
          ? `Rig audit warning: ${firstErr.title} — ${firstErr.detail}`
          : 'Rig audit detected errors; review Rig Audit before production export.',
      );
    }

    const hadIssueOverlay = showMeshIssueOverlay;
    if (hadIssueOverlay) analyzeAndHighlightMeshIssues(src, false);
    applyViewportShadingToGroup(src, 'material', selectedBoneIdx, meshWireframeOverridesRef.current);

    const useNative = Boolean(usePreservedNativeRig && preservedSkinnedSceneRef.current);
    const bound =
      useNative && preservedSkinnedSceneRef.current
        ? extractPreservedBoundRig(preservedSkinnedSceneRef.current)
        : bindSkeletonToModelGroup(src, bones);

    if (hadIssueOverlay) analyzeAndHighlightMeshIssues(src, true);

    const clips: THREE.AnimationClip[] = [...nativeClipsRef.current];
    const existingNames = new Set(clips.map((c) => c.name));

    (['idle', 'walk', 'run', 'combat'] as AvatarEmote[]).forEach((em) => {
      const c = compileClipFromPreset(
        bound.bonesByName,
        bound.restPositions,
        bound.restRotations,
        em,
        2.0,
        20,
      );
      if (!existingNames.has(c.name)) {
        clips.push(c);
        existingNames.add(c.name);
      }
    });
    if (keyframes.length > 0) {
      clips.push(
        compileClipFromKeyframes(
          keyframes,
          bones.map((b) => b.name),
          bound.restPositions,
          bound.restRotations,
          'Custom_Timeline_Clip',
          timelineDuration,
        ),
      );
    }

    const result = await exportGroupWithAnimations(bound.skinnedGroup, clips, binary);
    const blob =
      result instanceof ArrayBuffer
        ? new Blob([result], { type: 'model/gltf-binary' })
        : new Blob([result], { type: 'model/gltf+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const clean = modelName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Sovereign_Rig';
    a.download = `${clean}_rigged.${binary ? 'glb' : 'gltf'}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`Exported "${a.download}" (${bones.length} bones · ${clips.length} AnimationClips).`);
  };

  const handleSaveProject = () => {
    const id = `proj_${modelName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const nextProj: SavedRigProject = {
      id,
      name: modelName,
      updatedAt: new Date().toLocaleTimeString(),
      skeletonPreset,
      bones,
      heatRadius,
      heatFalloff,
      symmetry,
      keyframes,
    };
    const nextList = [nextProj, ...savedProjects.filter((p) => p.id !== id)].slice(0, 12);
    setSavedProjects(nextList);
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextList));
    } catch {
      // ignore storage quota errors
    }
    setStatusMsg(`Saved rig project "${modelName}" (${bones.length} bones, ${keyframes.length} keyframes).`);
  };

  const handleLoadSavedProject = (id: string) => {
    const proj = savedProjects.find((p) => p.id === id);
    if (!proj) return;
    if (isBound) handleToggleBind(false);
    setUsePreservedNativeRig(false);
    setLastDeformReport(null);
    setModelName(proj.name);
    setSkeletonPreset(proj.skeletonPreset);
    setBones(proj.bones);
    setHeatRadius(proj.heatRadius);
    setHeatFalloff(proj.heatFalloff);
    setSymmetry(proj.symmetry);
    setKeyframes(proj.keyframes);
    setIkLimbs(createDefaultIKLimbs(proj.bones));
    pushHistory(proj.bones, proj.keyframes);
    setStatusMsg(`Loaded saved rig project "${proj.name}".`);
  };

  const handleUploadPublishThumb = async (file: File) => {
    setUploadingThumb(true);
    setThumbUploadError(null);
    try {
      const endpoint = await uploadImageFile(file);
      setPublishImageUrl(endpoint);
    } catch (err) {
      setThumbUploadError(err instanceof Error ? err.message : 'Thumbnail upload failed.');
    } finally {
      setUploadingThumb(false);
    }
  };

  const handleCaptureViewportThumb = async () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    setUploadingThumb(true);
    setThumbUploadError(null);
    try {
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.86);
      const endpoint = await uploadDataUrlImage(dataUrl);
      setPublishImageUrl(endpoint);
    } catch (err) {
      setThumbUploadError(err instanceof Error ? err.message : 'Viewport capture failed.');
    } finally {
      setUploadingThumb(false);
    }
  };

  const handleTestInLounge = async () => {
    if (testingInLounge) return;
    const activeEmote: AvatarEmote = activeClip.kind === 'preset' ? activeClip.emote : 'hero';
    if (sourceType !== 'glb-custom' || !sourceGroupRef.current) {
      onTestLocallyInLounge({
        id: `sandbox_${Date.now().toString(36)}`,
        name: modelName,
        creatorId: userId,
        sourceType,
        bones,
        weightConfig: { radius: heatRadius, falloff: heatFalloff, symmetry },
        defaultAnimation: activeEmote,
      });
      return;
    }

    setTestingInLounge(true);
    try {
      const src = sourceGroupRef.current;
      const hadOverlay = showMeshIssueOverlay;
      if (hadOverlay) analyzeAndHighlightMeshIssues(src, false);
      applyViewportShadingToGroup(src, 'material', selectedBoneIdx, meshWireframeOverridesRef.current);

      const useNative = Boolean(usePreservedNativeRig && preservedSkinnedSceneRef.current);
      if (!useNative && !hasCustomPainted) {
        computeAllAutoWeights(bones, heatRadius, heatFalloff, true);
      }
      const bound =
        useNative && preservedSkinnedSceneRef.current
          ? extractPreservedBoundRig(preservedSkinnedSceneRef.current)
          : bindSkeletonToModelGroup(src, bones);

      if (hadOverlay) analyzeAndHighlightMeshIssues(src, true);
      else syncShadingAcrossActiveGroup();

      const clip = compileClipFromPreset(
        bound.bonesByName,
        bound.restPositions,
        bound.restRotations,
        activeEmote,
        2.0,
        20,
      );
      const res = await exportGroupWithAnimations(bound.skinnedGroup, [clip], true);
      if (!(res instanceof ArrayBuffer)) {
        throw new Error('Failed to serialize custom GLB binary for Lounge preview.');
      }
      const blob = new Blob([res], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(blob);

      onTestLocallyInLounge({
        id: `sandbox_${Date.now().toString(36)}`,
        name: modelName,
        creatorId: userId,
        sourceType: 'glb-custom',
        modelEndpoint: blobUrl,
        bones,
        weightConfig: { radius: heatRadius, falloff: heatFalloff, symmetry },
        defaultAnimation: activeEmote,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to prepare custom GLB for Lounge.');
    } finally {
      setTestingInLounge(false);
    }
  };

  const handlePublish = async () => {
    if (!isAdmin || publishing || bones.length === 0 || !sourceGroupRef.current) return;
    const src = sourceGroupRef.current;
    const hadOverlay = showMeshIssueOverlay;
    if (hadOverlay) analyzeAndHighlightMeshIssues(src, false);
    applyViewportShadingToGroup(src, 'material', selectedBoneIdx, meshWireframeOverridesRef.current);

    const audit = runFullRigAudit(src, bones, true);
    setLastDeformReport(audit);
    if (!audit.overallPassed) {
      if (hadOverlay) analyzeAndHighlightMeshIssues(src, true);
      const firstErr = audit.issues.find((i) => i.severity === 'error');
      setErrorMsg(
        firstErr
          ? `Cannot publish broken rig (${firstErr.title}): ${firstErr.detail}`
          : 'Rig failed structural or deformation validation. Open Rig Audit to resolve errors.',
      );
      setValidationOpen(true);
      return;
    }

    setPublishing(true);
    try {
      const modelId = `rig_${Date.now().toString(36)}`;
      let exportBuffer: ArrayBuffer | null = null;
      if (sourceType === 'glb-custom') {
        const useNative = Boolean(usePreservedNativeRig && preservedSkinnedSceneRef.current);
        if (!useNative && !hasCustomPainted) {
          computeAllAutoWeights(bones, heatRadius, heatFalloff, true);
        }
        const bound =
          useNative && preservedSkinnedSceneRef.current
            ? extractPreservedBoundRig(preservedSkinnedSceneRef.current)
            : bindSkeletonToModelGroup(src, bones);
        const clip = compileClipFromPreset(
          bound.bonesByName,
          bound.restPositions,
          bound.restRotations,
          activeClip.kind === 'preset' ? activeClip.emote : 'idle',
          2.0,
          20,
        );
        const res = await exportGroupWithAnimations(bound.skinnedGroup, [clip], true);
        exportBuffer = res instanceof ArrayBuffer ? res : null;
      }

      if (hadOverlay) analyzeAndHighlightMeshIssues(src, true);

      await onPublishRiggedAsset({
        modelId,
        name: modelName.trim() || 'Custom Rigged Avatar',
        description:
          publishDesc.trim() ||
          'Custom Sovereign character rig calibrated with volumetric weights and humanoid IK/FK.',
        section: publishSection,
        imageUrl: publishImageUrl.trim() || undefined,
        sourceType,
        glbBuffer: exportBuffer,
        bones,
        weightConfig: { radius: heatRadius, falloff: heatFalloff, symmetry },
        defaultAnimation: activeClip.kind === 'preset' ? activeClip.emote : 'hero',
        price: Math.max(0, Number(shopPrice) || 1500),
        rarity: shopRarity,
      });
      setPublishOpen(false);
      setStatusMsg(`Published "${modelName}" to Sovereign Item Shop & 3D Lounge!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!isAdmin || !onSaveToLibrary || savingLibrary || bones.length === 0 || !sourceGroupRef.current) {
      return;
    }
    const src = sourceGroupRef.current;
    const hadOverlay = showMeshIssueOverlay;
    if (hadOverlay) analyzeAndHighlightMeshIssues(src, false);
    applyViewportShadingToGroup(src, 'material', selectedBoneIdx, meshWireframeOverridesRef.current);

    setSavingLibrary(true);
    setErrorMsg(null);
    try {
      const modelId = `rig_${Date.now().toString(36)}`;
      let exportBuffer: ArrayBuffer | null = null;
      if (sourceType === 'glb-custom') {
        const useNative = Boolean(usePreservedNativeRig && preservedSkinnedSceneRef.current);
        if (!useNative && !hasCustomPainted) {
          computeAllAutoWeights(bones, heatRadius, heatFalloff, true);
        }
        const bound =
          useNative && preservedSkinnedSceneRef.current
            ? extractPreservedBoundRig(preservedSkinnedSceneRef.current)
            : bindSkeletonToModelGroup(src, bones);
        const clip = compileClipFromPreset(
          bound.bonesByName,
          bound.restPositions,
          bound.restRotations,
          activeClip.kind === 'preset' ? activeClip.emote : 'idle',
          2.0,
          20,
        );
        const res = await exportGroupWithAnimations(bound.skinnedGroup, [clip], true);
        exportBuffer = res instanceof ArrayBuffer ? res : null;
      }

      if (hadOverlay) analyzeAndHighlightMeshIssues(src, true);

      await onSaveToLibrary({
        modelId,
        name: modelName.trim() || 'Custom Rigged Avatar',
        sourceType,
        glbBuffer: exportBuffer,
        bones,
        weightConfig: { radius: heatRadius, falloff: heatFalloff, symmetry },
        defaultAnimation: activeClip.kind === 'preset' ? activeClip.emote : 'hero',
      });
      setStatusMsg(`Saved "${modelName}" directly to Sovereign Character Library (/riggedModels/${modelId}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save to Character Library.');
    } finally {
      setSavingLibrary(false);
    }
  };

  return (
    <div
      className={`flex flex-col min-h-[calc(100vh-64px)] lg:h-[calc(100vh-64px)] bg-[#16181D] text-slate-100 ${
        dragOver ? 'ring-2 ring-[#E5A93B] ring-inset' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
          void handleImportFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* TOP TOOLBAR */}
      <StudioTopToolbar
        modelName={modelName}
        onChangeModelName={setModelName}
        workspaceMode={workspaceMode}
        onChangeWorkspaceMode={handleChangeWorkspaceMode}
        skeletonPreset={skeletonPreset}
        onApplyPreset={handleApplyPreset}
        onScanAndRepairRig={handleScanAndRepairRig}
        scanningRig={scanningRig}
        onImportFiles={(files) => void handleImportFiles(files)}
        onLoadStarter={(variant) =>
          loadSubjectIntoStudio(
            createStarterRiggingSubject(variant),
            variant === 'knight' ? 'procedural-knight' : 'procedural-vanguard',
            variant === 'knight' ? 'Sovereign Knight Rig' : 'Vanguard Mech Rig',
          )
        }
        onExportGLB={() => void handleExport(true)}
        onExportGLTF={() => void handleExport(false)}
        canUndo={historyMeta.index > 0}
        canRedo={historyMeta.index < historyMeta.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        validationIssueCount={validationIssues.length}
        validationErrorCount={errorCount}
        onOpenValidation={() => setValidationOpen(true)}
        onSaveProject={handleSaveProject}
        savedProjects={savedProjects}
        onLoadSavedProject={handleLoadSavedProject}
        isBound={isBound}
        onToggleBind={() => handleToggleBind(false)}
        onTestInLounge={() => void handleTestInLounge()}
        isAdmin={isAdmin}
        publishing={publishing}
        onOpenPublishModal={() => setPublishOpen(true)}
        savingLibrary={savingLibrary}
        onSaveToLibrary={onSaveToLibrary ? () => void handleSaveToLibrary() : undefined}
      />

      {/* MAIN 3-COLUMN WORKBENCH */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* LEFT OUTLINER */}
        <StudioLeftOutliner
          stats={stats}
          meshes={sceneMeshes}
          selectedMeshUuid={selectedMeshUuid}
          onSelectMesh={setSelectedMeshUuid}
          onToggleMeshVisible={handleToggleMeshVisible}
          onToggleMeshWireframe={handleToggleMeshWireframe}
          onAttachTextureToMesh={(uuid, file) => void handleAttachTextureToMesh(uuid, file)}
          bones={bones}
          selectedBoneIdx={selectedBoneIdx}
          onSelectBone={(idx) => {
            setActiveIKHandle(null);
            setSelectedBoneIdx(idx);
          }}
          isBound={isBound}
          onAddChildBone={handleAddChildBone}
          onAddSymmetryPair={handleAddSymmetryPair}
          onAddBoneChain={handleAddBoneChain}
          onDuplicateBone={handleDuplicateBone}
          onDeleteBone={handleDeleteBone}
          onMirrorSkeletonLR={(dir) => {
            if (isBound) return;
            setUsePreservedNativeRig(false);
            setLastDeformReport(null);
            const next = mirrorSkeletonLR(bones, dir);
            setBones(next);
            pushHistory(next, keyframes);
            setStatusMsg(`Mirrored skeleton transforms (${dir}).`);
          }}
          onClearSkeleton={() => {
            if (isBound) return;
            setUsePreservedNativeRig(false);
            setLastDeformReport(null);
            const c = modelBoundsRef.current.getCenter(new THREE.Vector3());
            const next: BoneNode[] = [
              {
                name: 'Root',
                parent: null,
                position: [Number(c.x.toFixed(3)), 0.95, Number(c.z.toFixed(3))],
              },
            ];
            setBones(next);
            setSelectedBoneIdx(0);
            pushHistory(next, keyframes);
          }}
        />

        {/* CENTER 3D VIEWPORT */}
        <div className="flex-1 relative min-h-[440px] bg-[#181B22] flex flex-col">
          {/* Viewport Overlay Controls (Zero backdrop-blur over WebGL) */}
          <div className="absolute top-2.5 left-2.5 right-2.5 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2">
            {/* Left Viewport Strip: Transform Gizmos, Space, Snapping, Pivot */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 bg-[#1D2026]/95 border border-white/10 rounded p-1">
              {!isBound && workspaceMode === 'edit' && (
                <>
                  <button
                    type="button"
                    onClick={() => setSkeletonTool('select-move')}
                    className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 ${
                      skeletonTool === 'select-move'
                        ? 'bg-[#3B82F6] text-white'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <MousePointerClick className="w-3.5 h-3.5" />
                    <span>Select</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkeletonTool('place-bone')}
                    className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 ${
                      skeletonTool === 'place-bone'
                        ? 'bg-[#E5A93B] text-slate-950 font-semibold'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Place Bone</span>
                  </button>
                  <span className="w-px h-4 bg-white/10 mx-0.5" />
                </>
              )}

              {(
                [
                  { id: 'translate', icon: Move, label: 'Move (G)' },
                  { id: 'rotate', icon: RotateCw, label: 'Rotate (R)' },
                  { id: 'scale', icon: Maximize2, label: 'Scale (S)' },
                ] as const
              ).map((g) => {
                const Icon = g.icon;
                const active = (isBound ? boundGizmoMode : gizmoMode) === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    title={g.label}
                    onClick={() => (isBound ? setBoundGizmoMode(g.id) : setGizmoMode(g.id))}
                    className={`p-1 rounded ${
                      active ? 'bg-[#E5A93B] text-slate-950' : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setGizmoSpace((s) => (s === 'local' ? 'world' : 'local'))}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase text-slate-300 hover:bg-white/5 border-l border-white/10 ml-0.5"
                title="Toggle Local / World Space"
              >
                {gizmoSpace}
              </button>

              <button
                type="button"
                onClick={() => setSnapEnabled((s) => !s)}
                title="Toggle Transform Snap (X)"
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 ${
                  snapEnabled ? 'bg-[#3B82F6] text-white' : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                <Magnet className="w-3 h-3" />
                <span>Snap</span>
              </button>

              {!isBound && (
                <select
                  value={pivotMode}
                  onChange={(e) => setPivotMode(e.target.value as TransformPivotMode)}
                  title="Transform Pivot Point"
                  className="bg-[#14161B] border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none"
                >
                  <option value="active">Pivot: Joint</option>
                  <option value="median">Pivot: Median</option>
                  <option value="origin">Pivot: Origin</option>
                </select>
              )}
            </div>

            {/* Right Viewport Strip: 7 Display/Shading Modes & Camera Views */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
              {/* 7 Shading Display Modes */}
              <div className="flex items-center gap-0.5 bg-[#1D2026]/95 border border-white/10 rounded p-0.5 text-[11px]">
                <Eye className="w-3.5 h-3.5 text-slate-400 mx-1 shrink-0" />
                {SHADING_OPTIONS.map((opt) => {
                  const active = shadingMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleChangeShadingMode(opt.id)}
                      className={`px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                        active
                          ? 'bg-[#E5A93B] text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Camera Views */}
              <div className="flex items-center gap-0.5 bg-[#1D2026]/95 border border-white/10 rounded p-0.5 text-[11px]">
                <Compass className="w-3.5 h-3.5 text-slate-400 mx-1 shrink-0" />
                {(
                  [
                    { id: 'perspective', label: 'Persp' },
                    { id: 'front', label: 'Front' },
                    { id: 'back', label: 'Back' },
                    { id: 'side', label: 'Side' },
                    { id: 'top', label: 'Top' },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => triggerCameraAutoFrame(v.id, false)}
                    className="px-1.5 py-0.5 rounded text-slate-300 hover:text-white hover:bg-white/5"
                  >
                    {v.label}
                  </button>
                ))}
                <button
                  type="button"
                  title="Auto-Frame Character (F)"
                  onClick={() => triggerCameraAutoFrame('frame', false)}
                  className="px-1.5 py-0.5 rounded text-[#E5A93B] hover:bg-white/5 flex items-center gap-0.5"
                >
                  <Crosshair className="w-3 h-3" />
                  <span>Fit</span>
                </button>
              </div>
            </div>
          </div>

          {/* Scan & Repair Rig Diagnostic + Mesh Issue Heat Map Banner */}
          {scanReport && !isBound && (
            <div className="absolute top-14 right-3 z-20 max-w-md bg-[#16181D]/95 border border-[#E5A93B]/45 rounded-lg p-3 space-y-2 text-xs shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-[#FDE68A]">
                  <ScanSearch className="w-4 h-4 text-[#E5A93B]" />
                  <span>GLB Scan &amp; Rig Repair ({scanReport.scannedAt})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setScanReport(null)}
                  className="text-slate-400 hover:text-white"
                  title="Dismiss Scan Summary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px] tabular-nums">
                <div className="rounded bg-[#111317] border border-white/10 px-2 py-1">
                  <div className="text-[10px] text-slate-400">Non-Manifold</div>
                  <div className={`font-mono font-semibold ${scanReport.meshIssues.nonManifoldEdges > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {scanReport.meshIssues.nonManifoldEdges}
                  </div>
                </div>
                <div className="rounded bg-[#111317] border border-white/10 px-2 py-1">
                  <div className="text-[10px] text-slate-400">Open Edges</div>
                  <div className={`font-mono font-semibold ${scanReport.meshIssues.boundaryEdges > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                    {scanReport.meshIssues.boundaryEdges}
                  </div>
                </div>
                <div className="rounded bg-[#111317] border border-white/10 px-2 py-1">
                  <div className="text-[10px] text-slate-400">Degenerate</div>
                  <div className={`font-mono font-semibold ${scanReport.meshIssues.degenerateTriangles > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {scanReport.meshIssues.degenerateTriangles}
                  </div>
                </div>
              </div>
              <ul className="space-y-0.5 text-[11px] text-slate-300 max-h-24 overflow-y-auto pr-1">
                {scanReport.fixesApplied.slice(0, 5).map((fix, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10 text-[10px] text-slate-400">
                <span>Red = Non-manifold/Degenerate · Amber = Open edge · Teal = Clean</span>
                <button
                  type="button"
                  onClick={() => handleToggleMeshIssueOverlay(!showMeshIssueOverlay)}
                  className={`px-2 py-1 rounded font-semibold whitespace-nowrap border ${
                    showMeshIssueOverlay
                      ? 'bg-red-950/60 border-red-400/40 text-red-200 hover:bg-red-900/60'
                      : 'bg-[#2B2518] border-[#E5A93B]/40 text-[#FDE68A]'
                  }`}
                >
                  {showMeshIssueOverlay ? 'Clear Issue Heat Map' : 'Show Issue Heat Map'}
                </button>
              </div>
            </div>
          )}

          {/* Native Skeleton Adoption / Preservation Notice */}
          {usePreservedNativeRig && !isBound && (
            <div className="absolute top-14 left-3 z-10 bg-[#1D2026]/95 border border-emerald-500/40 rounded px-3 py-1.5 flex items-center gap-3 text-xs">
              <BoneIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-200">
                Using native GLB skeleton &amp; skin weights (<strong className="tabular-nums">{bones.length}</strong> bones).
              </span>
              <button
                type="button"
                onClick={() => handleApplyPreset(skeletonPreset)}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-slate-100 font-medium whitespace-nowrap"
              >
                Rebuild Auto-Rig
              </button>
            </div>
          )}
          {!usePreservedNativeRig && importedExistingBones && importedExistingBones.length > 0 && !isBound && (
            <div className="absolute top-14 left-3 z-10 bg-[#1D2026]/95 border border-sky-500/40 rounded px-3 py-1.5 flex items-center gap-3 text-xs">
              <BoneIcon className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-slate-200">
                File includes <strong className="tabular-nums">{importedExistingBones.length}</strong> native bones.
              </span>
              <button
                type="button"
                onClick={handleUseImportedSkeleton}
                className="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold whitespace-nowrap"
              >
                Use Imported Skeleton
              </button>
              <button
                type="button"
                onClick={() => setImportedExistingBones(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Hovered Bone / IK Handle Tooltip */}
          {hoveredLabel && (
            <div
              style={{
                left: Math.max(12, hoveredLabel.x + 14),
                top: Math.max(48, hoveredLabel.y - 10),
              }}
              className="absolute z-20 pointer-events-none px-2 py-0.5 rounded bg-[#14161B]/95 border border-white/15 text-[11px] font-medium text-white shadow-lg whitespace-nowrap"
            >
              {hoveredLabel.text}
            </div>
          )}

          {/* Live 3D Orientation Axis Triad (Bottom-Right Corner) */}
          <div className="absolute bottom-10 right-3 z-10 pointer-events-none bg-[#16181D]/90 border border-white/[0.08] rounded p-1.5">
            <svg width="52" height="52" viewBox="-26 -26 52 52" aria-label="Viewport Axis Triad">
              <line
                x1="0"
                y1="0"
                x2={triadAxes.z[0] * 18}
                y2={triadAxes.z[1] * 18}
                stroke="#3B82F6"
                strokeWidth="2"
              />
              <text
                x={triadAxes.z[0] * 22}
                y={triadAxes.z[1] * 22 + 3}
                fill="#60A5FA"
                fontSize="8"
                textAnchor="middle"
                fontFamily="monospace"
              >
                Z
              </text>
              <line
                x1="0"
                y1="0"
                x2={triadAxes.y[0] * 18}
                y2={triadAxes.y[1] * 18}
                stroke="#22C55E"
                strokeWidth="2"
              />
              <text
                x={triadAxes.y[0] * 22}
                y={triadAxes.y[1] * 22 + 3}
                fill="#4ADE80"
                fontSize="8"
                textAnchor="middle"
                fontFamily="monospace"
              >
                Y
              </text>
              <line
                x1="0"
                y1="0"
                x2={triadAxes.x[0] * 18}
                y2={triadAxes.x[1] * 18}
                stroke="#EF4444"
                strokeWidth="2"
              />
              <text
                x={triadAxes.x[0] * 22}
                y={triadAxes.x[1] * 22 + 3}
                fill="#F87171"
                fontSize="8"
                textAnchor="middle"
                fontFamily="monospace"
              >
                X
              </text>
            </svg>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="absolute bottom-10 left-3 right-16 z-20 bg-red-950/95 border border-red-500/50 rounded px-3 py-2 flex items-center justify-between gap-2 text-xs text-red-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button type="button" onClick={() => setErrorMsg(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Drag Drop Overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-30 bg-[#16181D]/90 border-2 border-dashed border-[#E5A93B] flex flex-col items-center justify-center pointer-events-none">
              <div className="text-base font-semibold text-[#FDE68A]">
                Drop .GLB, .GLTF + .BIN + Texture Assets
              </div>
              <div className="text-xs text-slate-300 mt-1">
                Preserves materials, UVs, morph targets, and existing skeletons
              </div>
            </div>
          )}

          {/* WebGL Mount Container */}
          <div ref={mountRef} className="w-full h-full flex-1 min-h-[400px]" />

          {/* Concise Viewport Status Footer */}
          <div className="px-3 py-1 bg-[#16181D] border-t border-white/[0.08] text-[11px] text-slate-400 flex items-center justify-between gap-4">
            <span className="truncate">{statusMsg}</span>
            <span className="hidden sm:inline font-mono text-[10px] text-slate-500 shrink-0">
              LMB: Select/Paint · RMB: Orbit · Wheel: Zoom · G/R/S: Gizmo · X: Snap · F: Fit
            </span>
          </div>
        </div>

        {/* RIGHT INSPECTOR */}
        <StudioRightInspector
          workspaceMode={workspaceMode}
          isBound={isBound}
          bones={bones}
          selectedBoneIdx={selectedBoneIdx}
          selectedBone={bones[selectedBoneIdx]}
          selectedMesh={selectedMeshInfo}
          symmetry={symmetry}
          onToggleSymmetry={setSymmetry}
          onUpdateBoneProp={handleUpdateBoneProp}
          onRenameBone={handleRenameBone}
          onFocusBone={handleFocusBone}
          manualRot={manualRot}
          manualPosOffset={manualPosOffset}
          onChangeManualRot={setManualRot}
          onChangeManualPosOffset={setManualPosOffset}
          onResetAllBoundBones={handleStopAndResetPose}
          weightSubTool={weightSubTool}
          onChangeWeightSubTool={(t) => {
            setWeightSubTool(t);
            if (t === 'brush' && vertexMarkerRef.current) vertexMarkerRef.current.visible = false;
          }}
          paintMode={paintMode}
          onChangePaintMode={setPaintMode}
          brushRadius={brushRadius}
          onChangeBrushRadius={setBrushRadius}
          brushStrength={brushStrength}
          onChangeBrushStrength={setBrushStrength}
          showHeatMap={showHeatMap}
          onToggleHeatMap={(v) => {
            setShowHeatMap(v);
            if (!v && shadingMode === 'weights') setShadingMode('material');
          }}
          heatRadius={heatRadius}
          heatFalloff={heatFalloff}
          onChangeHeatRadius={setHeatRadius}
          onChangeHeatFalloff={setHeatFalloff}
          onRecomputeAutoWeights={() => {
            setHasCustomPainted(false);
            computeAllAutoWeights(bones, heatRadius, heatFalloff, true);
            setStatusMsg('Recomputed volumetric Gaussian heat weights across all meshes.');
          }}
          onNormalizeWeights={() =>
            withWeightRefresh(
              (m) => normalizeWeightsOnMesh(m, bones.length),
              'Normalized all vertex weights to sum cleanly to 1.0.',
            )
          }
          onSmoothAllWeights={() =>
            withWeightRefresh(
              (m) => smoothAllWeightsOnMesh(m, bones.length, 0.45),
              'Applied topological Laplacian weight smoothing across mesh edges.',
            )
          }
          onMirrorAllWeights={(dir) =>
            withWeightRefresh(
              (m) => mirrorAllWeightsOnMesh(m, bones, dir),
              `Mirrored skin weights symmetrically (${dir}).`,
            )
          }
          onCleanupWeights={(thresh) =>
            withWeightRefresh(
              (m) => cleanupWeightsOnMesh(m, thresh, bones.length),
              `Pruned weights below ${thresh} and renormalized vertices.`,
            )
          }
          onTransferWeights={(fromIdx, toIdx) =>
            withWeightRefresh(
              (m) => transferBoneWeightsOnMesh(m, fromIdx, toIdx, 1.0),
              `Transferred skin weights from ${bones[fromIdx]?.name} to ${bones[toIdx]?.name}.`,
            )
          }
          selectedVertex={selectedVertex}
          onEditVertexSlotWeight={handleEditVertexSlotWeight}
          ikLimbs={ikLimbs}
          onToggleLimbIK={(id, enabled) => {
            if (enabled && !isBound) {
              handleToggleBind(false);
            }
            setIkLimbs((prev) => ({
              ...prev,
              [id]: { ...prev[id], enabled },
            }));
            if (enabled) setActiveIKHandle({ limbId: id, role: 'target' });
            else if (activeIKHandle?.limbId === id) setActiveIKHandle(null);
          }}
          onChangeLimbIKBlend={(id, blend) =>
            setIkLimbs((prev) => ({ ...prev, [id]: { ...prev[id], blend } }))
          }
          onResetIKTargets={() => {
            setIkLimbs((prev) => {
              const fresh = createDefaultIKLimbs(bones);
              (Object.keys(fresh) as IKLimbId[]).forEach((id) => {
                fresh[id].enabled = prev[id].enabled;
                fresh[id].blend = prev[id].blend;
              });
              return fresh;
            });
          }}
          facialRig={facialRig}
          morphTargetNames={stats.morphTargetNames}
          onChangeFacialRig={(patch) => setFacialRig((prev) => ({ ...prev, ...patch }))}
          onChangeMorphInfluence={(name, value) =>
            setFacialRig((prev) => ({
              ...prev,
              morphInfluences: { ...prev.morphInfluences, [name]: value },
            }))
          }
          meshRotDeg={meshRotDeg}
          meshScale={meshScale}
          onApplyMeshCalibration={(nextRot, nextScale) => {
            if (isBound || !rawBackupGroupRef.current) return;
            setUsePreservedNativeRig(false);
            setLastDeformReport(null);
            setMeshRotDeg(nextRot);
            setMeshScale(nextScale);
            const calibrated = createCalibratedGroupFromBackup(
              rawBackupGroupRef.current,
              nextRot,
              nextScale,
            );
            applyBakedMeshToScene(
              calibrated,
              sourceType,
              modelName,
              skeletonPreset,
              true,
              nativeClipsRef.current,
              undefined,
              true,
              undefined,
              null,
              nextScale,
            );
          }}
          lightingConfig={lightingConfig}
          onChangeLighting={(patch) => setLightingConfig((prev) => ({ ...prev, ...patch }))}
          isAdmin={isAdmin}
          shopPrice={shopPrice}
          shopRarity={shopRarity}
          publishing={publishing}
          onChangeShopPrice={setShopPrice}
          onChangeShopRarity={setShopRarity}
          onPublish={() => setPublishOpen(true)}
        />
      </div>

      {/* BOTTOM ANIMATION TIMELINE */}
      <StudioBottomTimeline
        isBound={isBound}
        isPlaying={isPlayingAnim}
        onTogglePlay={() => {
          if (!isBound) {
            handleToggleBind(true);
          } else {
            setIsPlayingAnim((v) => !v);
          }
        }}
        onStopAndReset={handleStopAndResetPose}
        loop={loopAnim}
        onToggleLoop={() => setLoopAnim((v) => !v)}
        speed={animSpeed}
        onChangeSpeed={setAnimSpeed}
        currentTime={timelineTime}
        duration={timelineDuration}
        onScrubTime={handleScrubTime}
        onChangeDuration={setTimelineDuration}
        activeClip={activeClip}
        onSelectClip={(clip) => {
          setActiveClip(clip);
          activeMixerClipKeyRef.current = '';
          if (!isBound) handleToggleBind(true);
          else setIsPlayingAnim(true);
        }}
        nativeClipNames={stats.animationNames}
        keyframes={keyframes}
        selectedKeyframeId={selectedKeyframeId}
        onSelectKeyframe={setSelectedKeyframeId}
        onInsertKeyframe={handleInsertKeyframe}
        onDeleteSelectedKeyframe={handleDeleteSelectedKeyframe}
        onExportAnimationJSON={handleExportAnimationJSON}
        onImportAnimationFile={(file) => void handleImportAnimationFile(file)}
      />

      {/* RIG VALIDATION & DEFORMATION AUDIT MODAL */}
      {validationOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-lg bg-[#1D2026] border border-white/15 p-5 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Rig Structural &amp; Weight Audit</h2>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {usePreservedNativeRig
                    ? 'Active pipeline: Preserved Native GLB Skeleton & Skin Weights'
                    : 'Active pipeline: Studio Volumetric Auto-Rig & Skin Binding'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setValidationOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto pr-1">
              {rigAuditReport.overallPassed && validationIssues.length === 0 ? (
                <div className="p-3.5 rounded bg-emerald-950/30 border border-emerald-500/30 flex items-center gap-3 text-xs text-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>
                    All structural, hierarchy, bind-matrix, and skin weight checks passed.
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {validationIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className={`p-3 rounded border text-xs ${
                        issue.severity === 'error'
                          ? 'bg-red-950/30 border-red-500/40 text-red-200'
                          : issue.severity === 'warning'
                            ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                            : 'bg-sky-950/30 border-sky-500/40 text-sky-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{issue.title}</span>
                        {(issue.boneName || issue.meshName) && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/30">
                            {issue.boneName || issue.meshName}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-300 mt-0.5">{issue.detail}</div>
                      {issue.suggestion && (
                        <div className="text-[11px] text-slate-400 mt-1">
                          Fix: {issue.suggestion}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {rigAuditReport.passedChecks.length > 0 && (
                <div className="p-3 rounded bg-[#14161B] border border-white/[0.08] space-y-1">
                  <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                    Verified Checks
                  </div>
                  {rigAuditReport.passedChecks.map((chk, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                      <span>{chk}</span>
                    </div>
                  ))}
                </div>
              )}

              {(rigAuditReport.problematicBones.length > 0 ||
                rigAuditReport.problematicMeshes.length > 0) && (
                <div className="p-3 rounded bg-[#14161B] border border-white/[0.08] space-y-2 text-xs">
                  {rigAuditReport.problematicBones.length > 0 && (
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Flagged Bones (click to focus):</div>
                      <div className="flex flex-wrap gap-1.5">
                        {rigAuditReport.problematicBones.map((bn) => (
                          <button
                            key={bn}
                            type="button"
                            onClick={() => {
                              const idx = bones.findIndex((b) => b.name === bn);
                              if (idx !== -1) setSelectedBoneIdx(idx);
                            }}
                            className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-200 font-mono text-[11px] hover:bg-red-500/30"
                          >
                            {bn}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {rigAuditReport.problematicMeshes.length > 0 && (
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Flagged Meshes:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {rigAuditReport.problematicMeshes.map((mn) => (
                          <span
                            key={mn}
                            className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 font-mono text-[11px]"
                          >
                            {mn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rigAuditReport.deformationResults.length > 0 && (
                <div className="p-3 rounded bg-[#14161B] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-300 uppercase tracking-wider">
                      LBS Deformation Stress Test ({rigAuditReport.deformationResults.length} Joints)
                    </span>
                    {rigAuditReport.testedAt && (
                      <span className="text-slate-500 font-mono">{rigAuditReport.testedAt}</span>
                    )}
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {rigAuditReport.deformationResults.map((res) => (
                      <div
                        key={res.boneName}
                        className={`px-2.5 py-1.5 rounded border text-[11px] flex items-center justify-between gap-2 ${
                          res.passed
                            ? 'bg-emerald-950/20 border-emerald-500/25 text-emerald-200'
                            : 'bg-red-950/30 border-red-500/40 text-red-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {res.jointRole} ({res.boneName} · {res.testAngleDeg}°)
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">{res.detail}</div>
                        </div>
                        <span className="font-mono text-[10px] shrink-0">
                          {res.maxEdgeStretchRatio}x
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={handleRunDeformationAudit}
                className="px-3.5 py-2 rounded bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold"
              >
                Run Deformation Test
              </button>
              {isBound && (
                <button
                  type="button"
                  onClick={handleStopAndResetPose}
                  className="px-3.5 py-2 rounded bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
                >
                  Reset Bind Pose
                </button>
              )}
              {validationIssues.some((i) => i.autoFixable) && (
                <button
                  type="button"
                  onClick={handleAutoFixValidation}
                  className="px-3.5 py-2 rounded bg-[#E5A93B] hover:bg-[#EEB852] text-slate-950 text-xs font-semibold"
                >
                  Auto-Fix Fixable Issues
                </button>
              )}
              <button
                type="button"
                onClick={() => setValidationOpen(false)}
                className="px-3.5 py-2 rounded bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN PUBLISH MODAL */}
      {publishOpen && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-lg bg-[#1D2026] border border-[#E5A93B]/40 p-5 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#FDE68A]">Publish to Item Shop &amp; Lounge</h2>
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400">Item Name</label>
                <input
                  type="text"
                  maxLength={80}
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded bg-[#14161B] border border-white/10 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400">Description</label>
                <textarea
                  rows={2}
                  maxLength={280}
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="Describe this character rig, materials, and animation style..."
                  className="w-full mt-1 px-3 py-2 rounded bg-[#14161B] border border-white/10 text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-slate-400">Section</label>
                  <select
                    value={publishSection}
                    onChange={(e) => setPublishSection(e.target.value as ShopSection)}
                    className="w-full mt-1 px-2.5 py-2 rounded bg-[#14161B] border border-white/10 text-white"
                  >
                    <option value="featured">Featured</option>
                    <option value="daily">Daily</option>
                    <option value="royal-vault">Royal Vault</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400">Price (SC)</label>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    value={shopPrice}
                    onChange={(e) => setShopPrice(Number(e.target.value) || 0)}
                    className="w-full mt-1 px-2.5 py-2 rounded bg-[#14161B] border border-white/10 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400">Rarity</label>
                  <select
                    value={shopRarity}
                    onChange={(e) => setShopRarity(e.target.value as ShopRarity)}
                    className="w-full mt-1 px-2.5 py-2 rounded bg-[#14161B] border border-white/10 text-white capitalize"
                  >
                    {(['mythic', 'legendary', 'epic', 'rare', 'uncommon'] as ShopRarity[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Thumbnail Upload & 3D Viewport Snapshot */}
              <div className="rounded bg-[#14161B] border border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-300 font-medium">Shop Thumbnail Artwork</span>
                  {publishImageUrl && (
                    <button
                      type="button"
                      onClick={() => setPublishImageUrl('')}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer px-3 py-1.5 rounded bg-[#23272F] hover:bg-[#2E343F] border border-white/10 text-slate-100 font-medium flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-sky-400" />
                    <span>{uploadingThumb ? 'Uploading...' : 'Upload Thumbnail'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={uploadingThumb}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleUploadPublishThumb(file);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={uploadingThumb}
                    onClick={() => void handleCaptureViewportThumb()}
                    className="px-3 py-1.5 rounded bg-[#2B2518] hover:bg-[#3A311D] border border-[#E5A93B]/40 text-[#FDE68A] font-medium flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Camera className="w-3.5 h-3.5 text-[#E5A93B]" />
                    <span>Capture 3D Viewport</span>
                  </button>
                </div>

                {thumbUploadError && (
                  <div className="text-[11px] text-red-300">{thumbUploadError}</div>
                )}

                {publishImageUrl && (
                  <div className="flex items-center gap-3 pt-1">
                    <img
                      src={publishImageUrl}
                      alt="Shop drop thumbnail preview"
                      className="w-16 h-16 rounded object-cover border border-white/15 bg-black"
                    />
                    <div className="text-[11px] text-emerald-300 truncate">
                      Uploaded: {publishImageUrl}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="px-3.5 py-2 rounded bg-white/10 text-xs font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={publishing || uploadingThumb}
                onClick={() => void handlePublish()}
                className="px-4 py-2 rounded bg-[#E5A93B] hover:bg-[#EEB852] text-slate-950 text-xs font-semibold disabled:opacity-40"
              >
                {publishing ? 'Publishing...' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
