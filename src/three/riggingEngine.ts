import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { BoneNode, MeshIssueAnalysis, SelectedVertexInfo, SkeletonPresetType } from '../types';

export type { SkeletonPresetType };

export type CanonicalHumanoidRole =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'headTop'
  | 'jaw'
  | 'leftEye'
  | 'rightEye'
  | 'leftShoulder'
  | 'leftArm'
  | 'leftForearm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightArm'
  | 'rightForearm'
  | 'rightHand'
  | 'leftUpLeg'
  | 'leftLeg'
  | 'leftFoot'
  | 'leftToe'
  | 'rightUpLeg'
  | 'rightLeg'
  | 'rightFoot'
  | 'rightToe'
  | 'leftFinger'
  | 'rightFinger'
  | 'other';

/**
 * Resolves standard, Mixamo, Unreal, Rigify, and VRM bone names to canonical humanoid roles.
 */
export function resolveHumanoidRole(rawName: string): CanonicalHumanoidRole {
  const n = rawName.toLowerCase().replace(/^mixamorig\d*:?/, '').replace(/^bip\d+[\s_]?/, '');
  const isLeft = /^(left|l_|l\.)|(_l|\.l|_left|\bleft\b)/i.test(n);
  const isRight = /^(right|r_|r\.)|(_r|\.r|_right|\bright\b)/i.test(n);

  if (/hips|pelvis|root_hips/.test(n) && !isLeft && !isRight) return 'hips';
  if (/headtop|head_top|head_end/.test(n)) return 'headTop';
  if (/jaw/.test(n)) return 'jaw';
  if (/eye/.test(n)) return isLeft ? 'leftEye' : isRight ? 'rightEye' : 'head';
  if (/head/.test(n)) return 'head';
  if (/neck/.test(n)) return 'neck';
  if (/chest|upperchest|spine2|spine_02|spine_03|torso/.test(n)) return 'chest';
  if (/spine/.test(n)) return 'spine';

  if (/thumb|index|middle|ring|pinky|little|finger/.test(n)) {
    return isLeft ? 'leftFinger' : isRight ? 'rightFinger' : 'other';
  }
  if (/shoulder|clavicle/.test(n)) {
    return isLeft ? 'leftShoulder' : isRight ? 'rightShoulder' : 'other';
  }
  if (/forearm|lowerarm|lower_arm|elbow/.test(n)) {
    return isLeft ? 'leftForearm' : isRight ? 'rightForearm' : 'other';
  }
  if (/hand|wrist/.test(n)) {
    return isLeft ? 'leftHand' : isRight ? 'rightHand' : 'other';
  }
  if (/upperarm|upper_arm|arm/.test(n) && !/forearm|lower/.test(n)) {
    return isLeft ? 'leftArm' : isRight ? 'rightArm' : 'other';
  }
  if (/upleg|upperleg|upper_leg|thigh/.test(n)) {
    return isLeft ? 'leftUpLeg' : isRight ? 'rightUpLeg' : 'other';
  }
  if (/lowerleg|lower_leg|calf|shin|knee|leg/.test(n) && !/up/.test(n)) {
    return isLeft ? 'leftLeg' : isRight ? 'rightLeg' : 'other';
  }
  if (/toe|ball/.test(n)) {
    return isLeft ? 'leftToe' : isRight ? 'rightToe' : 'other';
  }
  if (/foot|ankle/.test(n)) {
    return isLeft ? 'leftFoot' : isRight ? 'rightFoot' : 'other';
  }
  return 'other';
}

export interface GLBMeshDiagnostic {
  name: string;
  uuid: string;
  isSkinned: boolean;
  vertexCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  isOutlier: boolean;
}

export interface GLBSceneAnalysis {
  meshCount: number;
  skinnedMeshCount: number;
  boneCount: number;
  rawBounds: THREE.Box3;
  coreBounds: THREE.Box3;
  coreCenter: THREE.Vector3;
  coreSize: THREE.Vector3;
  outlierMeshUuids: Set<string>;
  orientationEulerRad: [number, number, number];
  orientationReason: string;
  meshDiagnostics: GLBMeshDiagnostic[];
}

function getMeshWorldVerticesSample(
  mesh: THREE.Mesh,
  maxSamples: number,
  outPoints: THREE.Vector3[],
): void {
  const pos = mesh.geometry?.attributes?.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return;

  const sm = mesh as THREE.SkinnedMesh;
  const useSkinned = Boolean(
    sm.isSkinnedMesh &&
      sm.skeleton &&
      sm.skeleton.bones.length > 0 &&
      mesh.geometry.attributes.skinIndex &&
      mesh.geometry.attributes.skinWeight,
  );

  const stride = Math.max(1, Math.floor(pos.count / maxSamples));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += stride) {
    if (useSkinned) {
      sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld);
    } else {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    }
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
      outPoints.push(v.clone());
    }
  }
}

function computeExactMeshWorldBounds(mesh: THREE.Mesh): THREE.Box3 {
  const box = new THREE.Box3();
  const pos = mesh.geometry?.attributes?.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return box;

  const sm = mesh as THREE.SkinnedMesh;
  const useSkinned = Boolean(
    sm.isSkinnedMesh &&
      sm.skeleton &&
      sm.skeleton.bones.length > 0 &&
      mesh.geometry.attributes.skinIndex &&
      mesh.geometry.attributes.skinWeight,
  );

  const v = new THREE.Vector3();
  const stride = pos.count > 18000 ? Math.floor(pos.count / 12000) : 1;
  for (let i = 0; i < pos.count; i += stride) {
    if (useSkinned) {
      sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld);
    } else {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    }
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
      box.expandByPoint(v);
    }
  }
  return box;
}

/**
 * Inspects full GLB scene hierarchy, world transforms, SkinnedMesh bind poses,
 * outlier floor/backdrop slabs, and orientation (Z-up / X-up / upside-down / -Z facing)
 * BEFORE any scaling or skeleton placement occurs.
 */
export function analyzeImportedGLBScene(root: THREE.Object3D): GLBSceneAnalysis {
  root.updateMatrixWorld(true);
  const rawBounds = new THREE.Box3().setFromObject(root);

  const meshes: Array<{ mesh: THREE.Mesh; box: THREE.Box3; size: THREE.Vector3; center: THREE.Vector3; verts: number; isSkinned: boolean }> = [];
  let boneCount = 0;
  let skinnedMeshCount = 0;

  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) boneCount += 1;
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      const pos = m.geometry?.attributes?.position;
      if (!pos || pos.count === 0) return;
      const isSkinned = Boolean((m as THREE.SkinnedMesh).isSkinnedMesh);
      if (isSkinned) {
        skinnedMeshCount += 1;
        const sm = m as THREE.SkinnedMesh;
        if (sm.skeleton) sm.skeleton.update();
      }
      const box = computeExactMeshWorldBounds(m);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      meshes.push({ mesh: m, box, size, center, verts: pos.count, isSkinned });
    }
  });

  const outlierMeshUuids = new Set<string>();
  const totalVerts = meshes.reduce((acc, m) => acc + m.verts, 0);

  if (meshes.length > 1 && totalVerts > 0) {
    // Vertex-weighted median center & non-slab reference span
    const sortedX = [...meshes].sort((a, b) => a.center.x - b.center.x);
    const sortedY = [...meshes].sort((a, b) => a.center.y - b.center.y);
    const sortedZ = [...meshes].sort((a, b) => a.center.z - b.center.z);
    const pickWeightedMedian = (arr: typeof meshes, coord: 'x' | 'y' | 'z') => {
      let acc = 0;
      const half = totalVerts * 0.5;
      for (const item of arr) {
        acc += item.verts;
        if (acc >= half) return item.center[coord];
      }
      return arr[0].center[coord];
    };
    const medCenter = new THREE.Vector3(
      pickWeightedMedian(sortedX, 'x'),
      pickWeightedMedian(sortedY, 'y'),
      pickWeightedMedian(sortedZ, 'z'),
    );

    const nonSlabMeshes = meshes.filter((m) => {
      const maxD = Math.max(m.size.x, m.size.y, m.size.z, 1e-5);
      const minD = Math.min(m.size.x, m.size.y, m.size.z);
      const isThinSlab = minD < maxD * 0.035;
      return !isThinSlab;
    });
    const refSpan = nonSlabMeshes.reduce(
      (mx, m) => Math.max(mx, m.size.x, m.size.y, m.size.z),
      0.001,
    );

    for (const m of meshes) {
      const maxD = Math.max(m.size.x, m.size.y, m.size.z, 1e-5);
      const minD = Math.min(m.size.x, m.size.y, m.size.z);
      const isHugeSlab = minD < maxD * 0.035 && maxD > refSpan * 2.2 && !m.isSkinned;
      const isDistantMicroProp =
        m.verts < totalVerts * 0.03 &&
        m.center.distanceTo(medCenter) > refSpan * 1.85 &&
        !m.isSkinned;
      if (isHugeSlab || isDistantMicroProp) {
        outlierMeshUuids.add(m.mesh.uuid);
      }
    }

    const keptVerts = meshes
      .filter((m) => !outlierMeshUuids.has(m.mesh.uuid))
      .reduce((acc, m) => acc + m.verts, 0);
    if (keptVerts < totalVerts * 0.45) {
      outlierMeshUuids.clear();
    }
  }

  const coreMeshes = meshes.filter((m) => !outlierMeshUuids.has(m.mesh.uuid));
  const activeMeshes = coreMeshes.length > 0 ? coreMeshes : meshes;

  const coreBounds = new THREE.Box3();
  const samplePts: THREE.Vector3[] = [];
  const perMeshQuota = Math.max(180, Math.floor(8000 / Math.max(1, activeMeshes.length)));

  for (const m of activeMeshes) {
    coreBounds.union(m.box);
    getMeshWorldVerticesSample(m.mesh, perMeshQuota, samplePts);
  }
  if (coreBounds.isEmpty()) coreBounds.copy(rawBounds);

  const coreSize = coreBounds.getSize(new THREE.Vector3());
  const coreCenter = coreBounds.getCenter(new THREE.Vector3());

  // Detect orientation correction so Z-up / X-up / upside-down / backwards (-Z) models align upright facing +Z
  const orientationEulerRad = detectCharacterOrientationEuler(samplePts, coreBounds);
  const reasons: string[] = [];
  if (Math.abs(orientationEulerRad[0]) > 0.01) {
    reasons.push(`upright X ${Math.round(THREE.MathUtils.radToDeg(orientationEulerRad[0]))}°`);
  }
  if (Math.abs(orientationEulerRad[2]) > 0.01) {
    reasons.push(`upright Z ${Math.round(THREE.MathUtils.radToDeg(orientationEulerRad[2]))}°`);
  }
  if (Math.abs(orientationEulerRad[1]) > 0.01) {
    reasons.push(`facing Y ${Math.round(THREE.MathUtils.radToDeg(orientationEulerRad[1]))}°`);
  }

  return {
    meshCount: meshes.length,
    skinnedMeshCount,
    boneCount,
    rawBounds,
    coreBounds,
    coreCenter,
    coreSize,
    outlierMeshUuids,
    orientationEulerRad,
    orientationReason: reasons.length > 0 ? `Auto-oriented (${reasons.join(', ')})` : 'Standard +Y up / +Z forward',
    meshDiagnostics: meshes.map((m) => ({
      name: m.mesh.name || 'Mesh',
      uuid: m.mesh.uuid,
      isSkinned: m.isSkinned,
      vertexCount: m.verts,
      boundsMin: [Number(m.box.min.x.toFixed(3)), Number(m.box.min.y.toFixed(3)), Number(m.box.min.z.toFixed(3))],
      boundsMax: [Number(m.box.max.x.toFixed(3)), Number(m.box.max.y.toFixed(3)), Number(m.box.max.z.toFixed(3))],
      size: [Number(m.size.x.toFixed(3)), Number(m.size.y.toFixed(3)), Number(m.size.z.toFixed(3))],
      center: [Number(m.center.x.toFixed(3)), Number(m.center.y.toFixed(3)), Number(m.center.z.toFixed(3))],
      isOutlier: outlierMeshUuids.has(m.mesh.uuid),
    })),
  };
}

function measureTwoClusterSplitScore(
  pts: THREE.Vector3[],
  axisPrimary: 'x' | 'y' | 'z',
  axisLateral: 'x' | 'y' | 'z',
  minVal: number,
  span: number,
  end: 'low' | 'high',
): number {
  const lo = end === 'low' ? minVal + span * 0.04 : minVal + span * 0.78;
  const hi = end === 'low' ? minVal + span * 0.22 : minVal + span * 0.96;
  const band = pts.filter((p) => p[axisPrimary] >= lo && p[axisPrimary] <= hi);
  if (band.length < 12) return 0;

  let meanLat = 0;
  for (const p of band) meanLat += p[axisLateral];
  meanLat /= band.length;

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of band) {
    if (p[axisLateral] < minLat) minLat = p[axisLateral];
    if (p[axisLateral] > maxLat) maxLat = p[axisLateral];
  }
  const latSpan = maxLat - minLat;
  if (latSpan < 1e-4) return 0;

  let centerCount = 0;
  let posCount = 0;
  let negCount = 0;
  const gapThresh = latSpan * 0.085;
  for (const p of band) {
    const d = p[axisLateral] - meanLat;
    if (Math.abs(d) <= gapThresh) centerCount += 1;
    else if (d > 0) posCount += 1;
    else negCount += 1;
  }

  const sideBalance = Math.min(posCount, negCount) / Math.max(1, band.length * 0.5);
  const centerVoid = 1 - centerCount / band.length;
  return sideBalance * centerVoid;
}

function measureWidestBandPosition(
  pts: THREE.Vector3[],
  axisPrimary: 'x' | 'y' | 'z',
  axisLateral: 'x' | 'y' | 'z',
  minVal: number,
  span: number,
): number {
  const BINS = 24;
  const mins = new Float32Array(BINS).fill(Infinity);
  const maxs = new Float32Array(BINS).fill(-Infinity);
  const counts = new Uint32Array(BINS);
  for (const p of pts) {
    const t = THREE.MathUtils.clamp((p[axisPrimary] - minVal) / Math.max(span, 1e-5), 0, 0.9999);
    const b = Math.floor(t * BINS);
    if (p[axisLateral] < mins[b]) mins[b] = p[axisLateral];
    if (p[axisLateral] > maxs[b]) maxs[b] = p[axisLateral];
    counts[b] += 1;
  }
  let bestBin = Math.floor(BINS * 0.7);
  let bestSpan = 0;
  for (let b = 2; b < BINS - 2; b++) {
    if (counts[b] < 4) continue;
    const w = maxs[b] - mins[b];
    if (w > bestSpan) {
      bestSpan = w;
      bestBin = b;
    }
  }
  return (bestBin + 0.5) / BINS;
}

function detectCharacterOrientationEuler(
  rawPts: THREE.Vector3[],
  box: THREE.Box3,
): [number, number, number] {
  if (rawPts.length < 24 || box.isEmpty()) return [0, 0, 0];
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const sx = Math.max(size.x, 1e-5);
  const sy = Math.max(size.y, 1e-5);
  const sz = Math.max(size.z, 1e-5);

  const qTotal = new THREE.Quaternion();
  const qStep = new THREE.Quaternion();

  const pts = rawPts.map((p) => p.clone().sub(center));
  const applyQ = (q: THREE.Quaternion) => {
    for (const p of pts) p.applyQuaternion(q);
    qTotal.premultiply(q);
  };

  // Step 1: Detect lying Z-up or X-up vs upright Y-up (distinguishing wide T-pose along X!)
  if (sz > sy * 1.48 && sy < Math.max(sx, sz) * 0.68) {
    // Model is lying along Z (classic Blender Z-up export)
    const latAxis: 'x' | 'y' = sx >= sy ? 'x' : 'y';
    const lowSplit = measureTwoClusterSplitScore(pts, 'z', latAxis, -sz * 0.5, sz, 'low');
    const highSplit = measureTwoClusterSplitScore(pts, 'z', latAxis, -sz * 0.5, sz, 'high');
    const wideFracZ = measureWidestBandPosition(pts, 'z', latAxis, -sz * 0.5, sz);
    // If wide shoulder band sits toward +Z (wideFracZ > 0.52) or -Z has leg split -> +Z is head (+Y after rotX -90)
    const headAtPosZ = wideFracZ >= 0.5 || lowSplit > highSplit + 0.12;
    qStep.setFromAxisAngle(new THREE.Vector3(1, 0, 0), headAtPosZ ? -Math.PI / 2 : Math.PI / 2);
    applyQ(qStep);
  } else if (sx > sy * 1.48 && sy < sz * 0.72) {
    // Model is lying sideways along X
    const lowSplit = measureTwoClusterSplitScore(pts, 'x', 'z', -sx * 0.5, sx, 'low');
    const highSplit = measureTwoClusterSplitScore(pts, 'x', 'z', -sx * 0.5, sx, 'high');
    const wideFracX = measureWidestBandPosition(pts, 'x', 'z', -sx * 0.5, sx);
    const headAtPosX = wideFracX >= 0.5 || lowSplit > highSplit + 0.12;
    qStep.setFromAxisAngle(new THREE.Vector3(0, 0, 1), headAtPosX ? Math.PI / 2 : -Math.PI / 2);
    applyQ(qStep);
  }

  // Recompute current bounds along Y
  const curBox = new THREE.Box3();
  for (const p of pts) curBox.expandByPoint(p);
  const curSize = curBox.getSize(new THREE.Vector3());

  // Step 2: Check upside-down (-Y up) polarity conservatively (works for A-pose, T-pose, and I-pose)
  const latY: 'x' | 'z' = curSize.x >= curSize.z ? 'x' : 'z';
  const botSplit = measureTwoClusterSplitScore(pts, 'y', latY, curBox.min.y, curSize.y, 'low');
  const topSplit = measureTwoClusterSplitScore(pts, 'y', latY, curBox.min.y, curSize.y, 'high');
  const wideFracY = measureWidestBandPosition(pts, 'y', latY, curBox.min.y, curSize.y);
  if (wideFracY < 0.56 && topSplit > botSplit + 0.22 && topSplit > 0.42) {
    qStep.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    applyQ(qStep);
    curBox.makeEmpty();
    for (const p of pts) curBox.expandByPoint(p);
    curBox.getSize(curSize);
  }

  // Step 3: Check horizontal yaw (+X / -X / -Z -> +Z facing)
  const h = Math.max(curSize.y, 1e-5);
  const upperBand = pts.filter(
    (p) => p.y >= curBox.min.y + h * 0.58 && p.y <= curBox.min.y + h * 0.88,
  );
  if (upperBand.length >= 16) {
    let minUX = Infinity, maxUX = -Infinity, minUZ = Infinity, maxUZ = -Infinity;
    for (const p of upperBand) {
      if (p.x < minUX) minUX = p.x;
      if (p.x > maxUX) maxUX = p.x;
      if (p.z < minUZ) minUZ = p.z;
      if (p.z > maxUZ) maxUZ = p.z;
    }
    const uSpanX = maxUX - minUX;
    const uSpanZ = maxUZ - minUZ;
    if (uSpanZ > uSpanX * 1.38) {
      // Character lateral shoulder axis is aligned along Z -> rotate +/-90° around Y
      const footPts = pts.filter((p) => p.y <= curBox.min.y + h * 0.11);
      const shinPts = pts.filter((p) => p.y >= curBox.min.y + h * 0.13 && p.y <= curBox.min.y + h * 0.25);
      const shinX = shinPts.length > 0 ? shinPts.reduce((a, p) => a + p.x, 0) / shinPts.length : 0;
      const footMeanX = footPts.length > 0 ? footPts.reduce((a, p) => a + p.x, 0) / footPts.length : 0;
      const facingPosX = footMeanX >= shinX;
      qStep.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingPosX ? -Math.PI / 2 : Math.PI / 2);
      applyQ(qStep);
    }
  }

  // Recompute bounds for -Z vs +Z facing test via foot/toe protrusion
  curBox.makeEmpty();
  for (const p of pts) curBox.expandByPoint(p);
  curBox.getSize(curSize);
  const hFinal = Math.max(curSize.y, 1e-5);

  const footBand = pts.filter((p) => p.y <= curBox.min.y + hFinal * 0.11);
  const ankleBand = pts.filter(
    (p) => p.y >= curBox.min.y + hFinal * 0.13 && p.y <= curBox.min.y + hFinal * 0.26,
  );
  if (footBand.length >= 10 && ankleBand.length >= 8) {
    const ankleZs = ankleBand.map((p) => p.z).sort((a, b) => a - b);
    const ankleZ = ankleZs[Math.floor(ankleZs.length * 0.5)];
    const footZs = footBand.map((p) => p.z).sort((a, b) => a - b);
    const footP92 = footZs[Math.min(footZs.length - 1, Math.floor(footZs.length * 0.92))];
    const footP08 = footZs[Math.max(0, Math.floor(footZs.length * 0.08))];
    const posToe = footP92 - ankleZ;
    const negToe = ankleZ - footP08;

    if (negToe > posToe * 1.55 && negToe - posToe > hFinal * 0.038) {
      qStep.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      applyQ(qStep);
    }
  }

  const euler = new THREE.Euler().setFromQuaternion(qTotal, 'XYZ');
  const snapZero = (v: number) => (Math.abs(v) < 1e-3 ? 0 : v);
  return [snapZero(euler.x), snapZero(euler.y), snapZero(euler.z)];
}

/**
 * Applies a rigid+uniform normalization transform (orientation + scale + foot-grounding)
 * to any Group/Object3D while algebraically preserving SkinnedMesh bindMatrices and boneInverses.
 */
export function applyTransformToPreservedScene(
  root: THREE.Object3D,
  normMatrix: THREE.Matrix4,
): void {
  root.updateMatrixWorld(true);
  const parentInv = root.parent
    ? root.parent.matrixWorld.clone().invert()
    : new THREE.Matrix4().identity();
  const nextWorld = new THREE.Matrix4().multiplyMatrices(normMatrix, root.matrixWorld);
  const nextLocal = new THREE.Matrix4().multiplyMatrices(parentInv, nextWorld);
  nextLocal.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrixWorld(true);

  const normInv = normMatrix.clone().invert();
  const updatedSkeletons = new Set<THREE.Skeleton>();

  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      sm.frustumCulled = false;
      sm.castShadow = true;
      sm.receiveShadow = true;
      if (sm.skeleton) {
        const bindIsIdentity =
          Math.abs(sm.bindMatrix.elements[0] - 1) < 1e-4 &&
          Math.abs(sm.bindMatrix.elements[5] - 1) < 1e-4 &&
          Math.abs(sm.bindMatrix.elements[10] - 1) < 1e-4 &&
          Math.abs(sm.bindMatrix.elements[12]) < 1e-4 &&
          Math.abs(sm.bindMatrix.elements[13]) < 1e-4 &&
          Math.abs(sm.bindMatrix.elements[14]) < 1e-4;

        if (sm.bindMode === THREE.DetachedBindMode || !bindIsIdentity) {
          sm.bindMatrix.premultiply(normMatrix);
          sm.bindMatrixInverse.copy(sm.bindMatrix).invert();
          if (!updatedSkeletons.has(sm.skeleton)) {
            for (const inv of sm.skeleton.boneInverses) {
              inv.multiply(normInv);
            }
            updatedSkeletons.add(sm.skeleton);
          }
        }
        sm.updateMatrixWorld(true);
        sm.skeleton.bones.forEach((b) => b.updateMatrixWorld(true));
        sm.skeleton.update();
      }
    }
  });
}

/**
 * Computes the exact world-space normalization Matrix4 (orientation -> uniform scale -> ground at Y=0, X/Z centered)
 * from a pre-analyzed GLBSceneAnalysis.
 */
export function computeNormalizationMatrixFromAnalysis(
  analysis: GLBSceneAnalysis,
  targetHeight = 1.9,
  applyAutoOrientation = true,
): THREE.Matrix4 {
  const [rx, ry, rz] = applyAutoOrientation ? analysis.orientationEulerRad : [0, 0, 0];
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));

  // Rotate core bounding corners to measure upright height accurately
  const min = analysis.coreBounds.min;
  const max = analysis.coreBounds.max;
  const rotBox = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? max.x : min.x,
      i & 2 ? max.y : min.y,
      i & 4 ? max.z : min.z,
    );
    corner.applyMatrix4(rotMat);
    rotBox.expandByPoint(corner);
  }
  const rotSize = rotBox.getSize(new THREE.Vector3());
  const effectiveSpan = Math.max(rotSize.y, Math.max(rotSize.x, rotSize.z) * 0.35, 0.001);
  const scale = targetHeight / effectiveSpan;

  const scaleMat = new THREE.Matrix4().makeScale(scale, scale, scale);
  const scaledRot = new THREE.Matrix4().multiplyMatrices(scaleMat, rotMat);

  const scaledBox = new THREE.Box3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? max.x : min.x,
      i & 2 ? max.y : min.y,
      i & 4 ? max.z : min.z,
    );
    corner.applyMatrix4(scaledRot);
    scaledBox.expandByPoint(corner);
  }
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  const transMat = new THREE.Matrix4().makeTranslation(
    -scaledCenter.x,
    -scaledBox.min.y,
    -scaledCenter.z,
  );
  return new THREE.Matrix4().multiplyMatrices(transMat, scaledRot);
}

/**
 * Normalizes any loaded scene containing native SkinnedMeshes + Skeletons
 * cleanly without overwriting original inverseBindMatrices or bindMatrix offsets.
 */
export function normalizePreservedSkinnedScene(
  root: THREE.Object3D,
  targetHeight = 1.9,
  applyAutoOrientation = true,
): THREE.Box3 {
  const analysis = analyzeImportedGLBScene(root);
  const normMatrix = computeNormalizationMatrixFromAnalysis(
    analysis,
    targetHeight,
    applyAutoOrientation,
  );
  applyTransformToPreservedScene(root, normMatrix);
  root.userData.__normalizedHeight = targetHeight;
  root.userData.__glbAnalysis = analysis;
  return new THREE.Box3().setFromObject(root);
}

export function cloneScenePreservingSkeleton(root: THREE.Object3D): THREE.Group {
  return SkeletonUtils.clone(root) as THREE.Group;
}

export interface StudioRendererHandle {
  renderer: THREE.WebGLRenderer;
  isSoftwareGl: boolean;
  setupEnvironment: (scene: THREE.Scene) => void;
  afterDraw: (cb: () => void) => number;
  dispose: () => void;
}

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createStudioWebGLContext(container: HTMLElement): StudioRendererHandle {
  const isSoftwareGl = detectSoftwareWebGL();
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const setupEnvironment = (scene: THREE.Scene) => {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();
  };

  const afterDraw = (cb: () => void): number => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        window.setTimeout(cb, 80);
      }
    };
    return window.setTimeout(poll, 5);
  };

  const dispose = () => {
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    renderer.dispose();
  };

  return { renderer, isSoftwareGl, setupEnvironment, afterDraw, dispose };
}

export interface StudioBloomHandle {
  composer: EffectComposer;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Creates a GPU-guarded EffectComposer + UnrealBloomPass + OutputPass pipeline.
 * Automatically returns null when running on Software WebGL to guarantee responsive framerates.
 */
export function createStudioBloomComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  isSoftwareGl: boolean,
  strength = 0.28,
  radius = 0.45,
  threshold = 0.88,
): StudioBloomHandle | null {
  if (isSoftwareGl) return null;
  try {
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(safeW, safeH);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(safeW, safeH),
      strength,
      radius,
      threshold,
    );
    const outputPass = new OutputPass();

    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    return {
      composer,
      resize: (w: number, h: number) => {
        const nw = Math.max(1, Math.floor(w));
        const nh = Math.max(1, Math.floor(h));
        composer.setSize(nw, nh);
        bloomPass.resolution.set(nw, nh);
      },
      dispose: () => {
        bloomPass.dispose();
        composer.dispose();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Generates a luxury obsidian stone & gold-veined procedural CanvasTexture for Sanctuary floors.
 */
export function createLuxuryObsidianFloorTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#070a12';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.14)';
  ctx.lineWidth = 1.5;
  const step = 128;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(212, 175, 55, 0.08)';
  ctx.lineWidth = 1;
  for (let v = 0; v < 14; v++) {
    ctx.beginPath();
    let x = (v * 97) % size;
    let y = 0;
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += Math.sin(v + s * 1.4) * 32;
      y += size / 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bakes any Mesh or SkinnedMesh (respecting its Skeleton + bindMatrix + world transform)
 * into a clean static BufferGeometry in current world coordinates.
 */
export function bakeMeshWorldGeometry(srcMesh: THREE.Mesh): THREE.BufferGeometry {
  srcMesh.updateMatrixWorld(true);
  const geo = srcMesh.geometry.clone();
  const sm = srcMesh as THREE.SkinnedMesh;
  const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;

  let bakedViaSkinning = false;
  if (
    posAttr &&
    sm.isSkinnedMesh &&
    sm.skeleton &&
    sm.skeleton.bones.length > 0 &&
    geo.attributes.skinIndex &&
    geo.attributes.skinWeight
  ) {
    sm.skeleton.bones.forEach((b) => b.updateMatrixWorld(true));
    sm.skeleton.update();

    const v = new THREE.Vector3();
    let maxSkinDeltaSq = 0;
    const rawV = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      rawV.fromBufferAttribute(posAttr, i).applyMatrix4(sm.matrixWorld);
      sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld);
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
        const dSq = v.distanceToSquared(rawV);
        if (dSq > maxSkinDeltaSq) maxSkinDeltaSq = dSq;
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
    }
    posAttr.needsUpdate = true;
    bakedViaSkinning = true;

    if (maxSkinDeltaSq > 1e-6 || !geo.attributes.normal) {
      geo.computeVertexNormals();
    } else {
      const normalAttr = geo.attributes.normal as THREE.BufferAttribute;
      const normalMat = new THREE.Matrix3().getNormalMatrix(sm.matrixWorld);
      for (let i = 0; i < normalAttr.count; i++) {
        v.fromBufferAttribute(normalAttr, i).applyMatrix3(normalMat).normalize();
        normalAttr.setXYZ(i, v.x, v.y, v.z);
      }
      normalAttr.needsUpdate = true;
    }
  }

  if (geo.attributes.skinIndex) geo.deleteAttribute('skinIndex');
  if (geo.attributes.skinWeight) geo.deleteAttribute('skinWeight');

  if (!bakedViaSkinning) {
    geo.applyMatrix4(srcMesh.matrixWorld);
    if (!geo.attributes.normal) {
      geo.computeVertexNormals();
    }
  }

  if (srcMesh.matrixWorld.determinant() < 0) {
    const index = geo.index;
    if (index) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        index.setX(i + 1, c);
        index.setX(i + 2, b);
      }
      index.needsUpdate = true;
    }
    geo.computeVertexNormals();
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function normalizeModelToUnitHeight(
  model: THREE.Object3D,
  targetHeight = 1.9,
  applyAutoOrientation = false,
): THREE.Box3 {
  const analysis = analyzeImportedGLBScene(model);
  const normMatrix = computeNormalizationMatrixFromAnalysis(
    analysis,
    targetHeight,
    applyAutoOrientation,
  );
  applyTransformToPreservedScene(model, normMatrix);
  model.userData.__normalizedHeight = targetHeight;
  model.userData.__glbAnalysis = analysis;
  return new THREE.Box3().setFromObject(model);
}

/**
 * Applies user-chosen orientation (degrees) & scale factor to a clean backup Group
 * and bakes vertices into normalized ground-origin coordinates so imported GLBs
 * that arrive sideways, upside down, or oversized fit skeletons cleanly.
 */
export function createCalibratedGroupFromBackup(
  backupGroup: THREE.Group,
  rotDeg: [number, number, number],
  scaleMultiplier = 1.0,
): THREE.Group {
  const temp = new THREE.Group();
  temp.name = backupGroup.name || 'Calibrated_Subject';

  backupGroup.updateMatrixWorld(true);
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(rotDeg[0]),
      THREE.MathUtils.degToRad(rotDeg[1]),
      THREE.MathUtils.degToRad(rotDeg[2]),
      'XYZ',
    ),
  );

  backupGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      const geo = bakeMeshWorldGeometry(srcMesh);
      geo.applyMatrix4(rotMat);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const mat = Array.isArray(srcMesh.material)
        ? srcMesh.material.map((m) => m.clone())
        : srcMesh.material.clone();

      const cleanMesh = new THREE.Mesh(geo, mat);
      cleanMesh.name = srcMesh.name;
      cleanMesh.castShadow = true;
      cleanMesh.receiveShadow = true;
      if (srcMesh.morphTargetDictionary) {
        cleanMesh.morphTargetDictionary = { ...srcMesh.morphTargetDictionary };
      }
      if (srcMesh.morphTargetInfluences) {
        cleanMesh.morphTargetInfluences = [...srcMesh.morphTargetInfluences];
      }
      temp.add(cleanMesh);
    }
  });

  const targetH = 1.9 * Math.max(0.25, Math.min(2.5, scaleMultiplier));
  normalizeModelToUnitHeight(temp, targetH, false);
  // Re-bake normalized scale & ground offset directly into vertices so world == local
  const baked = new THREE.Group();
  baked.name = temp.name;
  temp.updateMatrixWorld(true);
  temp.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      const geo = bakeMeshWorldGeometry(srcMesh);
      const mesh = new THREE.Mesh(geo, srcMesh.material);
      mesh.name = srcMesh.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (srcMesh.morphTargetDictionary) {
        mesh.morphTargetDictionary = { ...srcMesh.morphTargetDictionary };
      }
      if (srcMesh.morphTargetInfluences) {
        mesh.morphTargetInfluences = [...srcMesh.morphTargetInfluences];
      }
      baked.add(mesh);
    }
  });
  baked.updateMatrixWorld(true);
  baked.userData.__normalizedHeight = targetH;
  baked.userData.__glbAnalysis = analyzeImportedGLBScene(baked);
  return baked;
}

/**
 * Flattens any loaded GLB hierarchy (including nested armatures/rotations or old SkinnedMeshes)
 * into clean world-baked Mesh children normalized upright to 1.9m tall at origin so raycasting,
 * bone placement, heat-map painting, and fresh SkinnedMesh binding share 1:1 coordinates.
 */
export function flattenAndBakeGLBForRigging(rawScene: THREE.Object3D): THREE.Group {
  const analysis = analyzeImportedGLBScene(rawScene);
  const normMatrix = computeNormalizationMatrixFromAnalysis(analysis, 1.9, true);
  applyTransformToPreservedScene(rawScene, normMatrix);
  rawScene.updateMatrixWorld(true);

  const bakedGroup = new THREE.Group();
  bakedGroup.name = rawScene.name || 'Custom_GLB_Subject';

  rawScene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      const pos = srcMesh.geometry?.attributes?.position;
      if (!pos || pos.count === 0) return;

      const geo = bakeMeshWorldGeometry(srcMesh);

      const mat = Array.isArray(srcMesh.material)
        ? srcMesh.material.map((m) => m.clone())
        : srcMesh.material
          ? srcMesh.material.clone()
          : new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.5 });

      const cleanMesh = new THREE.Mesh(geo, mat);
      cleanMesh.name = srcMesh.name || `Mesh_${bakedGroup.children.length + 1}`;
      cleanMesh.castShadow = true;
      cleanMesh.receiveShadow = true;
      if (srcMesh.morphTargetDictionary) {
        cleanMesh.morphTargetDictionary = { ...srcMesh.morphTargetDictionary };
      }
      if (srcMesh.morphTargetInfluences) {
        cleanMesh.morphTargetInfluences = [...srcMesh.morphTargetInfluences];
      }
      bakedGroup.add(cleanMesh);
    }
  });

  bakedGroup.updateMatrixWorld(true);
  bakedGroup.userData.__normalizedHeight = 1.9;
  bakedGroup.userData.__glbAnalysis = analyzeImportedGLBScene(bakedGroup);
  return bakedGroup;
}

function createConfiguredGLTFLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  try {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
  } catch {
    // Non-draco GLBs still load seamlessly
  }
  return loader;
}

export function parseGLBArrayBuffer(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = createConfiguredGLTFLoader();
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const raw = gltf.scene || new THREE.Group();
        const baked = flattenAndBakeGLBForRigging(raw);
        resolve(baked);
      },
      (err) => reject(err),
    );
  });
}

export function loadRawGLTF(
  url: string,
): Promise<{ scene: THREE.Group; hasSkeleton: boolean; animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    const loader = createConfiguredGLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene || new THREE.Group();
        let hasSkeleton = false;
        root.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkeleton = true;
            obj.frustumCulled = false;
          }
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        if (hasSkeleton) {
          normalizePreservedSkinnedScene(root, 1.9);
        } else {
          normalizeModelToUnitHeight(root, 1.9);
        }
        resolve({ scene: root, hasSkeleton, animations: gltf.animations || [] });
      },
      undefined,
      (err) => reject(err),
    );
  });
}

export function exportGroupToGLBBuffer(group: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          const json = JSON.stringify(result);
          const encoder = new TextEncoder();
          resolve(encoder.encode(json).buffer);
        }
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}

const r3 = (n: number) => Number(n.toFixed(3));

/**
 * Generates proportional humanoid skeletons ranging from a lightweight 15-bone rig
 * up to full-body 33-bone & 45-bone articulated skeletons (Head, Jaw, Hands,
 * 5 individual Fingers per hand, Feet, and Toes).
 */
export function buildHumanoidBoneNodes(
  bounds: THREE.Box3,
  preset: SkeletonPresetType = 'full-33',
): BoneNode[] {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, 0.5);
  const w = Math.max(size.x * 0.5, 0.28);
  const d = Math.max(size.z * 0.5, 0.14);
  const minY = bounds.min.y;
  const cx = center.x;
  const cz = center.z;

  if (preset === 'simple-15') {
    return [
      { name: 'Hips', parent: null, position: [r3(cx), r3(minY + h * 0.52), r3(cz)] },
      { name: 'Spine', parent: 'Hips', position: [r3(cx), r3(minY + h * 0.62), r3(cz)] },
      { name: 'Chest', parent: 'Spine', position: [r3(cx), r3(minY + h * 0.74), r3(cz)] },
      { name: 'Neck', parent: 'Chest', position: [r3(cx), r3(minY + h * 0.84), r3(cz)] },
      { name: 'Head', parent: 'Neck', position: [r3(cx), r3(minY + h * 0.91), r3(cz)] },

      { name: 'LeftShoulder', parent: 'Chest', position: [r3(cx + w * 0.26), r3(minY + h * 0.8), r3(cz)] },
      { name: 'LeftArm', parent: 'LeftShoulder', position: [r3(cx + w * 0.45), r3(minY + h * 0.77), r3(cz)] },
      { name: 'LeftForearm', parent: 'LeftArm', position: [r3(cx + w * 0.68), r3(minY + h * 0.63), r3(cz)] },

      { name: 'RightShoulder', parent: 'Chest', position: [r3(cx - w * 0.26), r3(minY + h * 0.8), r3(cz)] },
      { name: 'RightArm', parent: 'RightShoulder', position: [r3(cx - w * 0.45), r3(minY + h * 0.77), r3(cz)] },
      { name: 'RightForearm', parent: 'RightArm', position: [r3(cx - w * 0.68), r3(minY + h * 0.63), r3(cz)] },

      { name: 'LeftUpLeg', parent: 'Hips', position: [r3(cx + w * 0.22), r3(minY + h * 0.48), r3(cz)] },
      { name: 'LeftLeg', parent: 'LeftUpLeg', position: [r3(cx + w * 0.22), r3(minY + h * 0.22), r3(cz)] },

      { name: 'RightUpLeg', parent: 'Hips', position: [r3(cx - w * 0.22), r3(minY + h * 0.48), r3(cz)] },
      { name: 'RightLeg', parent: 'RightUpLeg', position: [r3(cx - w * 0.22), r3(minY + h * 0.22), r3(cz)] },
    ];
  }

  // Hand base coordinates aligned to natural A-pose wrist
  const lHandX = cx + w * 0.82;
  const lHandY = minY + h * 0.51;
  const rHandX = cx - w * 0.82;
  const rHandY = minY + h * 0.51;

  const baseNodes: BoneNode[] = [
    { name: 'Hips', parent: null, position: [r3(cx), r3(minY + h * 0.51), r3(cz)] },
    { name: 'Spine', parent: 'Hips', position: [r3(cx), r3(minY + h * 0.61), r3(cz)] },
    { name: 'Chest', parent: 'Spine', position: [r3(cx), r3(minY + h * 0.73), r3(cz)] },
    { name: 'Neck', parent: 'Chest', position: [r3(cx), r3(minY + h * 0.84), r3(cz)] },
    { name: 'Head', parent: 'Neck', position: [r3(cx), r3(minY + h * 0.91), r3(cz)] },
    { name: 'Jaw', parent: 'Head', position: [r3(cx), r3(minY + h * 0.88), r3(cz + d * 0.34)], weightScale: 0.7 },

    // Left Arm + Hand + 5 Fingers
    { name: 'LeftShoulder', parent: 'Chest', position: [r3(cx + w * 0.24), r3(minY + h * 0.8), r3(cz)] },
    { name: 'LeftArm', parent: 'LeftShoulder', position: [r3(cx + w * 0.44), r3(minY + h * 0.77), r3(cz)] },
    { name: 'LeftForearm', parent: 'LeftArm', position: [r3(cx + w * 0.66), r3(minY + h * 0.63), r3(cz)] },
    { name: 'LeftHand', parent: 'LeftForearm', position: [r3(lHandX), r3(lHandY), r3(cz)], weightScale: 0.85 },
    { name: 'LeftThumb', parent: 'LeftHand', position: [r3(lHandX + w * 0.03), r3(lHandY - h * 0.015), r3(cz + d * 0.28)], weightScale: 0.75 },
    { name: 'LeftIndex', parent: 'LeftHand', position: [r3(lHandX + w * 0.065), r3(lHandY - h * 0.048), r3(cz + d * 0.14)], weightScale: 0.7 },
    { name: 'LeftMiddle', parent: 'LeftHand', position: [r3(lHandX + w * 0.072), r3(lHandY - h * 0.052), r3(cz + d * 0.04)], weightScale: 0.7 },
    { name: 'LeftRing', parent: 'LeftHand', position: [r3(lHandX + w * 0.068), r3(lHandY - h * 0.05), r3(cz - d * 0.06)], weightScale: 0.7 },
    { name: 'LeftPinky', parent: 'LeftHand', position: [r3(lHandX + w * 0.06), r3(lHandY - h * 0.045), r3(cz - d * 0.15)], weightScale: 0.7 },

    // Right Arm + Hand + 5 Fingers
    { name: 'RightShoulder', parent: 'Chest', position: [r3(cx - w * 0.24), r3(minY + h * 0.8), r3(cz)] },
    { name: 'RightArm', parent: 'RightShoulder', position: [r3(cx - w * 0.44), r3(minY + h * 0.77), r3(cz)] },
    { name: 'RightForearm', parent: 'RightArm', position: [r3(cx - w * 0.66), r3(minY + h * 0.63), r3(cz)] },
    { name: 'RightHand', parent: 'RightForearm', position: [r3(rHandX), r3(rHandY), r3(cz)], weightScale: 0.85 },
    { name: 'RightThumb', parent: 'RightHand', position: [r3(rHandX - w * 0.03), r3(rHandY - h * 0.015), r3(cz + d * 0.28)], weightScale: 0.75 },
    { name: 'RightIndex', parent: 'RightHand', position: [r3(rHandX - w * 0.065), r3(rHandY - h * 0.048), r3(cz + d * 0.14)], weightScale: 0.7 },
    { name: 'RightMiddle', parent: 'RightHand', position: [r3(rHandX - w * 0.072), r3(rHandY - h * 0.052), r3(cz + d * 0.04)], weightScale: 0.7 },
    { name: 'RightRing', parent: 'RightHand', position: [r3(rHandX - w * 0.068), r3(rHandY - h * 0.05), r3(cz - d * 0.06)], weightScale: 0.7 },
    { name: 'RightPinky', parent: 'RightHand', position: [r3(rHandX - w * 0.06), r3(rHandY - h * 0.045), r3(cz - d * 0.15)], weightScale: 0.7 },

    // Left Leg + Foot + Toe
    { name: 'LeftUpLeg', parent: 'Hips', position: [r3(cx + w * 0.23), r3(minY + h * 0.46), r3(cz)] },
    { name: 'LeftLeg', parent: 'LeftUpLeg', position: [r3(cx + w * 0.23), r3(minY + h * 0.23), r3(cz)] },
    { name: 'LeftFoot', parent: 'LeftLeg', position: [r3(cx + w * 0.23), r3(minY + h * 0.045), r3(cz + d * 0.08)], weightScale: 0.85 },
    { name: 'LeftToe', parent: 'LeftFoot', position: [r3(cx + w * 0.23), r3(minY + h * 0.025), r3(cz + d * 0.55)], weightScale: 0.7 },

    // Right Leg + Foot + Toe
    { name: 'RightUpLeg', parent: 'Hips', position: [r3(cx - w * 0.23), r3(minY + h * 0.46), r3(cz)] },
    { name: 'RightLeg', parent: 'RightUpLeg', position: [r3(cx - w * 0.23), r3(minY + h * 0.23), r3(cz)] },
    { name: 'RightFoot', parent: 'RightLeg', position: [r3(cx - w * 0.23), r3(minY + h * 0.045), r3(cz + d * 0.08)], weightScale: 0.85 },
    { name: 'RightToe', parent: 'RightFoot', position: [r3(cx - w * 0.23), r3(minY + h * 0.025), r3(cz + d * 0.55)], weightScale: 0.7 },
  ];

  if (preset === 'ultra-45') {
    baseNodes.push(
      { name: 'HeadTop', parent: 'Head', position: [r3(cx), r3(minY + h * 0.99), r3(cz)], weightScale: 0.8 },
      { name: 'LeftThumb2', parent: 'LeftThumb', position: [r3(lHandX + w * 0.045), r3(lHandY - h * 0.03), r3(cz + d * 0.36)], weightScale: 0.6 },
      { name: 'LeftIndex2', parent: 'LeftIndex', position: [r3(lHandX + w * 0.09), r3(lHandY - h * 0.078), r3(cz + d * 0.16)], weightScale: 0.6 },
      { name: 'LeftMiddle2', parent: 'LeftMiddle', position: [r3(lHandX + w * 0.098), r3(lHandY - h * 0.084), r3(cz + d * 0.04)], weightScale: 0.6 },
      { name: 'LeftRing2', parent: 'LeftRing', position: [r3(lHandX + w * 0.092), r3(lHandY - h * 0.08), r3(cz - d * 0.07)], weightScale: 0.6 },
      { name: 'LeftPinky2', parent: 'LeftPinky', position: [r3(lHandX + w * 0.082), r3(lHandY - h * 0.072), r3(cz - d * 0.17)], weightScale: 0.6 },

      { name: 'RightThumb2', parent: 'RightThumb', position: [r3(rHandX - w * 0.045), r3(rHandY - h * 0.03), r3(cz + d * 0.36)], weightScale: 0.6 },
      { name: 'RightIndex2', parent: 'RightIndex', position: [r3(rHandX - w * 0.09), r3(rHandY - h * 0.078), r3(cz + d * 0.16)], weightScale: 0.6 },
      { name: 'RightMiddle2', parent: 'RightMiddle', position: [r3(rHandX - w * 0.098), r3(rHandY - h * 0.084), r3(cz + d * 0.04)], weightScale: 0.6 },
      { name: 'RightRing2', parent: 'RightRing', position: [r3(rHandX - w * 0.092), r3(rHandY - h * 0.08), r3(cz - d * 0.07)], weightScale: 0.6 },
      { name: 'RightPinky2', parent: 'RightPinky', position: [r3(rHandX - w * 0.082), r3(rHandY - h * 0.072), r3(cz - d * 0.17)], weightScale: 0.6 },
    );
  }

  return baseNodes;
}

const _v = new THREE.Vector3();
const _segAB = new THREE.Vector3();
const _segAP = new THREE.Vector3();

type AnatomicalZone = 'axial' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

function classifyBoneAnatomicalZone(boneName: string): AnatomicalZone {
  const role = resolveHumanoidRole(boneName);
  if (role === 'head' || role === 'headTop' || role === 'jaw' || role === 'leftEye' || role === 'rightEye') {
    return 'head';
  }
  if (role === 'leftShoulder' || role === 'leftArm' || role === 'leftForearm' || role === 'leftHand' || role === 'leftFinger') {
    return 'leftArm';
  }
  if (role === 'rightShoulder' || role === 'rightArm' || role === 'rightForearm' || role === 'rightHand' || role === 'rightFinger') {
    return 'rightArm';
  }
  if (role === 'leftUpLeg' || role === 'leftLeg' || role === 'leftFoot' || role === 'leftToe') {
    return 'leftLeg';
  }
  if (role === 'rightUpLeg' || role === 'rightLeg' || role === 'rightFoot' || role === 'rightToe') {
    return 'rightLeg';
  }
  // Fallback for custom Left/Right limbs
  const lower = boneName.toLowerCase();
  if (/left|_l$|\.l$/.test(lower)) {
    return /leg|foot|toe|thigh|calf|knee|hip/.test(lower) ? 'leftLeg' : 'leftArm';
  }
  if (/right|_r$|\.r$/.test(lower)) {
    return /leg|foot|toe|thigh|calf|knee|hip/.test(lower) ? 'rightLeg' : 'rightArm';
  }
  return 'axial';
}

function distSqAndT(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): { distSq: number; t: number } {
  _segAB.copy(b).sub(a);
  const lenSq = _segAB.lengthSq();
  if (lenSq < 1e-6) return { distSq: p.distanceToSquared(a), t: 0 };
  _segAP.copy(p).sub(a);
  const t = THREE.MathUtils.clamp(_segAP.dot(_segAB) / lenSq, 0, 1);
  _segAB.multiplyScalar(t).add(a);
  return { distSq: p.distanceToSquared(_segAB), t };
}

/**
 * Computes anatomically accurate skinIndex & skinWeight BufferAttributes using
 * OUTWARD child-segment capsules (so rotating joint B moves segment B->child around pivot B,
 * never detaching parent geometry) plus L/R, Arm/Torso, and Head/Chest anatomical boundaries
 * and a gentle edge-preserving Laplacian blend pass.
 */
export function computeHeatMapWeightsForMesh(
  mesh: THREE.Mesh,
  boneNodes: BoneNode[],
  radius = 0.36,
  falloff = 2.2,
): void {
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position;
  if (!posAttr || boneNodes.length === 0) return;

  const posMap = new Map<string, THREE.Vector3>();
  const childrenByName = new Map<string, BoneNode[]>();
  boneNodes.forEach((b) => {
    posMap.set(b.name, new THREE.Vector3(...b.position));
    childrenByName.set(b.name, []);
  });
  boneNodes.forEach((b) => {
    if (b.parent && childrenByName.has(b.parent)) {
      childrenByName.get(b.parent)!.push(b);
    }
  });

  const getRolePos = (r: CanonicalHumanoidRole): THREE.Vector3 | null => {
    const found = boneNodes.find((b) => resolveHumanoidRole(b.name) === r);
    return found ? posMap.get(found.name)! : null;
  };
  const hipsPos = getRolePos('hips') ?? posMap.get(boneNodes[0].name)!;
  const neckPos = getRolePos('neck');
  const centerX = hipsPos.x;
  const neckY = neckPos ? neckPos.y : hipsPos.y + 0.45;

  interface BoneCapsule {
    start: THREE.Vector3;
    end: THREE.Vector3;
    sigmaSq: number;
    gain: number;
  }

  // Each bone B owns OUTWARD segments (B -> Child) so bending pivot B deforms its own limb/part
  const boneCapsules: Array<{
    zone: AnatomicalZone;
    role: CanonicalHumanoidRole;
    capsules: BoneCapsule[];
  }> = boneNodes.map((b) => {
    const origin = posMap.get(b.name)!;
    const role = resolveHumanoidRole(b.name);
    const zone = classifyBoneAnatomicalZone(b.name);
    const children = childrenByName.get(b.name) ?? [];
    const localScale = b.weightScale ?? 1.0;
    const isFine =
      role === 'leftFinger' ||
      role === 'rightFinger' ||
      role === 'jaw' ||
      role === 'leftEye' ||
      role === 'rightEye' ||
      role === 'leftToe' ||
      role === 'rightToe';
    const isLimb =
      zone === 'leftArm' || zone === 'rightArm' || zone === 'leftLeg' || zone === 'rightLeg';

    const capsules: BoneCapsule[] = [];

    if (children.length > 0) {
      for (const ch of children) {
        const chPos = posMap.get(ch.name)!;
        const chRole = resolveHumanoidRole(ch.name);

        const isClavicleBranch =
          role === 'chest' && (chRole === 'leftShoulder' || chRole === 'rightShoulder');
        const isHipBranch =
          role === 'hips' && (chRole === 'leftUpLeg' || chRole === 'rightUpLeg');

        const capEnd = chPos.clone();
        if (isHipBranch || isClavicleBranch) {
          capEnd.lerpVectors(origin, chPos, 0.5);
        } else if (role === 'head' && chRole === 'jaw') {
          capEnd.lerpVectors(origin, chPos, 0.6);
        }

        const effectiveLen = origin.distanceTo(capEnd);
        const maxZoneR = isFine
          ? 0.048
          : isLimb
            ? Math.min(radius * 0.48, 0.14)
            : Math.min(radius * 0.78, 0.24);
        const minZoneR = isFine ? 0.026 : isLimb ? 0.055 : 0.095;
        const factor = isFine ? 0.9 : isLimb ? 0.72 : 1.05;
        const adaptiveR =
          (effectiveLen > 0.005
            ? THREE.MathUtils.clamp(effectiveLen * factor, minZoneR, maxZoneR)
            : (minZoneR + maxZoneR) * 0.5) * localScale;

        capsules.push({
          start: origin,
          end: capEnd,
          sigmaSq: Math.max(0.0006, adaptiveR * adaptiveR),
          gain: isClavicleBranch ? 0.55 : isHipBranch ? 0.75 : 1.0,
        });
      }

      if (role === 'head' && !children.some((c) => resolveHumanoidRole(c.name) === 'headTop')) {
        const upEnd = origin.clone().add(new THREE.Vector3(0, 0.16, 0));
        capsules.push({
          start: origin,
          end: upEnd,
          sigmaSq: Math.max(0.016, (0.19 * localScale) ** 2),
          gain: 1.15,
        });
      }
    } else {
      const pPos = b.parent && posMap.has(b.parent) ? posMap.get(b.parent)! : null;
      const outDir = pPos ? origin.clone().sub(pPos) : new THREE.Vector3(0, 0.08, 0);
      const outLen = outDir.length();
      if (outLen > 0.004) outDir.normalize();
      else outDir.set(0, 1, 0);

      let extDist = isFine ? 0.045 : 0.095;
      if (role === 'head' || role === 'headTop') extDist = 0.14;
      else if (role === 'leftHand' || role === 'rightHand') extDist = 0.085;
      else if (
        role === 'leftToe' ||
        role === 'rightToe' ||
        role === 'leftFoot' ||
        role === 'rightFoot'
      ) {
        extDist = 0.095;
      }

      const end = origin.clone().addScaledVector(outDir, extDist);
      const adaptiveR =
        (role === 'head' || role === 'headTop' ? 0.18 : isFine ? 0.042 : 0.078) * localScale;
      capsules.push({
        start: origin,
        end,
        sigmaSq: Math.max(0.0007, adaptiveR * adaptiveR),
        gain: 1.0,
      });
    }

    return { zone, role, capsules };
  });

  mesh.updateMatrixWorld(true);
  const count = posAttr.count;
  const worldVerts = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    worldVerts[i * 3] = _v.x;
    worldVerts[i * 3 + 1] = _v.y;
    worldVerts[i * 3 + 2] = _v.z;
  }

  // Build topological connected islands (welding coincident UV-seam vertices)
  const parentDsu = new Int32Array(count);
  for (let i = 0; i < count; i++) parentDsu[i] = i;
  const findDsu = (x: number): number => {
    let root = x;
    while (parentDsu[root] !== root) root = parentDsu[root];
    let cur = x;
    while (cur !== root) {
      const nxt = parentDsu[cur];
      parentDsu[cur] = root;
      cur = nxt;
    }
    return root;
  };
  const unionDsu = (a: number, b: number) => {
    const ra = findDsu(a);
    const rb = findDsu(b);
    if (ra !== rb) parentDsu[rb] = ra;
  };

  const posWeldMap = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(worldVerts[i * 3] * 1000)}|${Math.round(worldVerts[i * 3 + 1] * 1000)}|${Math.round(worldVerts[i * 3 + 2] * 1000)}`;
    const prev = posWeldMap.get(k);
    if (prev !== undefined) unionDsu(prev, i);
    else posWeldMap.set(k, i);
  }

  const indexAttr = geometry.index;
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(count / 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    if (i0 < count && i1 < count && i2 < count) {
      unionDsu(i0, i1);
      unionDsu(i1, i2);
    }
  }

  const islandBoxes = new Map<number, THREE.Box3>();
  const vertIsland = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const r = findDsu(i);
    vertIsland[i] = r;
    let box = islandBoxes.get(r);
    if (!box) {
      box = new THREE.Box3();
      islandBoxes.set(r, box);
    }
    _v.set(worldVerts[i * 3], worldVerts[i * 3 + 1], worldVerts[i * 3 + 2]);
    box.expandByPoint(_v);
  }

  // Determine which anatomical zones genuinely have bone segments inside each topological island
  const islandInteriorZones = new Map<number, Set<AnatomicalZone>>();
  const _midPt = new THREE.Vector3();
  for (const [r, box] of islandBoxes.entries()) {
    const expanded = box.clone().expandByScalar(0.012);
    const zSet = new Set<AnatomicalZone>();
    for (const bc of boneCapsules) {
      for (const cap of bc.capsules) {
        _midPt.lerpVectors(cap.start, cap.end, 0.5);
        if (expanded.containsPoint(_midPt)) {
          zSet.add(bc.zone);
        }
      }
    }
    islandInteriorZones.set(r, zSet);
  }

  // Optional 6-zone surface geodesic distance map when multiple anatomical zones share 1 welded island
  const ALL_ZONES: AnatomicalZone[] = ['axial', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  const zoneGeoDist = new Map<AnatomicalZone, Float32Array>();
  let hasMultiZoneIsland = false;
  for (const zSet of islandInteriorZones.values()) {
    if (zSet.size >= 2) {
      hasMultiZoneIsland = true;
      break;
    }
  }

  if (hasMultiZoneIsland && count <= 30000) {
    // Build welded-root adjacency graph for topological surface waves
    const adj = new Map<number, Array<{ to: number; len: number }>>();
    const addEdge = (u: number, v: number) => {
      const ru = posWeldMap.get(
        `${Math.round(worldVerts[u * 3] * 1000)}|${Math.round(worldVerts[u * 3 + 1] * 1000)}|${Math.round(worldVerts[u * 3 + 2] * 1000)}`,
      )!;
      const rv = posWeldMap.get(
        `${Math.round(worldVerts[v * 3] * 1000)}|${Math.round(worldVerts[v * 3 + 1] * 1000)}|${Math.round(worldVerts[v * 3 + 2] * 1000)}`,
      )!;
      if (ru === rv) return;
      const dx = worldVerts[ru * 3] - worldVerts[rv * 3];
      const dy = worldVerts[ru * 3 + 1] - worldVerts[rv * 3 + 1];
      const dz = worldVerts[ru * 3 + 2] - worldVerts[rv * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let listU = adj.get(ru);
      if (!listU) { listU = []; adj.set(ru, listU); }
      listU.push({ to: rv, len: d });
      let listV = adj.get(rv);
      if (!listV) { listV = []; adj.set(rv, listV); }
      listV.push({ to: ru, len: d });
    };
    for (let t = 0; t < triCount; t++) {
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      if (i0 < count && i1 < count && i2 < count) {
        addEdge(i0, i1);
        addEdge(i1, i2);
        addEdge(i2, i0);
      }
    }

    const repVerts = Array.from(new Set(posWeldMap.values()));
    for (const z of ALL_ZONES) {
      const zBones = boneCapsules.filter((bc) => bc.zone === z);
      if (zBones.length === 0) continue;

      const distArr = new Float32Array(count).fill(Infinity);
      // Seed each bone in this zone using its closest surface vertices (within 1.35 * minDist + 0.015)
      const queue: number[] = [];
      for (const bc of zBones) {
        let minCapD = Infinity;
        const repD = new Float32Array(repVerts.length);
        for (let rIdx = 0; rIdx < repVerts.length; rIdx++) {
          const rv = repVerts[rIdx];
          const zSet = islandInteriorZones.get(vertIsland[rv]);
          if (zSet && zSet.size > 0 && !zSet.has(z)) {
            repD[rIdx] = Infinity;
            continue;
          }
          _v.set(worldVerts[rv * 3], worldVerts[rv * 3 + 1], worldVerts[rv * 3 + 2]);
          let bestD = Infinity;
          for (const cap of bc.capsules) {
            const { distSq } = distSqAndT(_v, cap.start, cap.end);
            if (distSq < bestD) bestD = distSq;
          }
          const d = Math.sqrt(bestD);
          repD[rIdx] = d;
          if (d < minCapD) minCapD = d;
        }
        const seedCut = minCapD * 1.35 + 0.015;
        for (let rIdx = 0; rIdx < repVerts.length; rIdx++) {
          if (repD[rIdx] <= seedCut) {
            const rv = repVerts[rIdx];
            if (repD[rIdx] < distArr[rv]) {
              distArr[rv] = repD[rIdx];
              queue.push(rv);
            }
          }
        }
      }

      // Run bounded Bellman-Ford / SPFA surface wave
      let qHead = 0;
      const inQueue = new Uint8Array(count);
      for (const q of queue) inQueue[q] = 1;
      while (qHead < queue.length) {
        const u = queue[qHead++];
        inQueue[u] = 0;
        const nbrs = adj.get(u);
        if (!nbrs) continue;
        const du = distArr[u];
        if (du > 0.75) continue;
        for (const e of nbrs) {
          const nd = du + e.len;
          if (nd < distArr[e.to]) {
            distArr[e.to] = nd;
            if (!inQueue[e.to]) {
              inQueue[e.to] = 1;
              queue.push(e.to);
            }
          }
        }
      }

      // Copy rep geodesic distances back to coincident UV-split vertices
      for (let i = 0; i < count; i++) {
        const rep = posWeldMap.get(
          `${Math.round(worldVerts[i * 3] * 1000)}|${Math.round(worldVerts[i * 3 + 1] * 1000)}|${Math.round(worldVerts[i * 3 + 2] * 1000)}`,
        )!;
        distArr[i] = distArr[rep];
      }
      zoneGeoDist.set(z, distArr);
    }
  }

  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const boneMinDistSq = new Float32Array(boneCapsules.length);

  for (let i = 0; i < count; i++) {
    _v.set(worldVerts[i * 3], worldVerts[i * 3 + 1], worldVerts[i * 3 + 2]);

    const dx = _v.x - centerX;
    const isStrongRightVert = dx < -0.025;
    const isStrongLeftVert = dx > 0.025;
    const isAboveNeck = _v.y > neckY + 0.015;
    const myIslandZones = islandInteriorZones.get(vertIsland[i]);

    // Pass 1: Measure vertex's exact shortest distance to each bone & each anatomical zone
    const zoneMinDistSq: Record<AnatomicalZone, number> = {
      axial: Infinity,
      head: Infinity,
      leftArm: Infinity,
      rightArm: Infinity,
      leftLeg: Infinity,
      rightLeg: Infinity,
    };

    for (let b = 0; b < boneCapsules.length; b++) {
      const bc = boneCapsules[b];
      let minD = Infinity;
      for (let c = 0; c < bc.capsules.length; c++) {
        const cap = bc.capsules[c];
        const { distSq } = distSqAndT(_v, cap.start, cap.end);
        if (distSq < minD) minD = distSq;
      }
      boneMinDistSq[b] = minD;
      if (minD < zoneMinDistSq[bc.zone]) {
        zoneMinDistSq[bc.zone] = minD;
      }
    }

    // Identify primary anatomical zone using island containment + surface geodesic distance
    let primaryZone: AnatomicalZone = 'axial';
    let primaryZoneScore = Infinity;
    for (const z of ALL_ZONES) {
      let score = zoneMinDistSq[z];
      const geoArr = zoneGeoDist.get(z);
      if (geoArr && Number.isFinite(geoArr[i])) {
        score = Math.max(score, geoArr[i] * geoArr[i] * 0.85);
      }
      if (myIslandZones && myIslandZones.size > 0 && !myIslandZones.has(z)) {
        score += 0.12;
      }
      if (score < primaryZoneScore) {
        primaryZoneScore = score;
        primaryZone = z;
      }
    }
    const primaryZoneDistSq = zoneMinDistSq[primaryZone];

    const isAdjacentConnectedPair = (zA: AnatomicalZone, zB: AnatomicalZone): boolean => {
      if (zA === zB) return true;
      return zA === 'axial' || zB === 'axial';
    };

    const candidates: Array<{ idx: number; w: number }> = [];

    for (let b = 0; b < boneCapsules.length; b++) {
      const bc = boneCapsules[b];
      let bestW = 0;

      for (let c = 0; c < bc.capsules.length; c++) {
        const cap = bc.capsules[c];
        const { distSq } = distSqAndT(_v, cap.start, cap.end);
        const w = cap.gain * Math.exp(-Math.pow(distSq / cap.sigmaSq, falloff * 0.5));
        if (w > bestW) bestW = w;
      }

      // 0. If this vertex belongs to an isolated mesh island containing specific interior bones,
      // prevent external air-gap limbs/axial bones from stealing vertices across empty space
      if (myIslandZones && myIslandZones.size > 0 && !myIslandZones.has(bc.zone)) {
        bestW *= 0.0001;
      }

      // 1. Strict Left/Right midline guard
      if (isStrongLeftVert && (bc.zone === 'rightArm' || bc.zone === 'rightLeg')) {
        bestW *= 0.0001;
      } else if (isStrongRightVert && (bc.zone === 'leftArm' || bc.zone === 'leftLeg')) {
        bestW *= 0.0001;
      }

      // 2. Non-adjacent limb-to-limb / limb-to-head isolation (Hands NEVER bleed to Thighs/Hips!)
      if (!isAdjacentConnectedPair(primaryZone, bc.zone)) {
        bestW *= 0.0001;
      } else if (primaryZone !== bc.zone) {
        // Adjacent axial <-> limb/head boundary: only allow blending right at the anatomical socket
        const distDiff = zoneMinDistSq[bc.zone] - primaryZoneDistSq;
        const isArmDistal =
          bc.role === 'leftForearm' ||
          bc.role === 'leftHand' ||
          bc.role === 'leftFinger' ||
          bc.role === 'rightForearm' ||
          bc.role === 'rightHand' ||
          bc.role === 'rightFinger';
        const isLegDistal =
          bc.role === 'leftLeg' ||
          bc.role === 'leftFoot' ||
          bc.role === 'leftToe' ||
          bc.role === 'rightLeg' ||
          bc.role === 'rightFoot' ||
          bc.role === 'rightToe';

        if (primaryZone === 'axial' && (isArmDistal || isLegDistal)) {
          bestW *= 0.0001;
        } else if (
          (primaryZone === 'leftArm' || primaryZone === 'rightArm') &&
          bc.zone === 'axial' &&
          bc.role !== 'chest'
        ) {
          bestW *= 0.001;
        } else if (
          (primaryZone === 'leftLeg' || primaryZone === 'rightLeg') &&
          bc.zone === 'axial' &&
          bc.role !== 'hips'
        ) {
          bestW *= 0.001;
        } else {
          // Smooth C1 ramp across the anatomical socket (no hard step discontinuity!)
          const socketFade = THREE.MathUtils.clamp(1.0 - (distDiff - 0.002) / 0.036, 0.02, 1.0);
          bestW *= socketFade * socketFade;
        }
      }

      if (isAboveNeck && (bc.zone === 'leftArm' || bc.zone === 'rightArm' || bc.zone === 'leftLeg' || bc.zone === 'rightLeg')) {
        bestW *= 0.0001;
      }

      candidates.push({ idx: b, w: bestW });
    }

    candidates.sort((a, b) => b.w - a.w);
    const top4 = candidates.slice(0, 4);
    let sum = 0;
    for (let k = 0; k < top4.length; k++) sum += top4[k].w;

    if (sum <= 1e-6) {
      // Closest bone within the vertex's primary anatomical zone
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let b = 0; b < boneCapsules.length; b++) {
        if (boneCapsules[b].zone !== primaryZone) continue;
        if (boneMinDistSq[b] < bestDist) {
          bestDist = boneMinDistSq[b];
          bestIdx = b;
        }
      }
      skinIndices[i * 4] = bestIdx;
      skinWeights[i * 4] = 1;
    } else {
      for (let k = 0; k < 4; k++) {
        const entry = top4[k];
        if (entry && entry.w / sum >= 0.002) {
          skinIndices[i * 4 + k] = entry.idx;
          skinWeights[i * 4 + k] = entry.w / sum;
        } else {
          skinIndices[i * 4 + k] = top4[0]?.idx ?? 0;
          skinWeights[i * 4 + k] = 0;
        }
      }
      const cleanSum =
        skinWeights[i * 4] +
        skinWeights[i * 4 + 1] +
        skinWeights[i * 4 + 2] +
        skinWeights[i * 4 + 3];
      if (cleanSum > 1e-6) {
        for (let k = 0; k < 4; k++) skinWeights[i * 4 + k] /= cleanSum;
      } else {
        skinWeights[i * 4] = 1;
      }
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  // Two gentle topological Laplacian smoothing passes (0.24) give silky-smooth C1 socket seams
  smoothAllWeightsOnMesh(mesh, boneNodes.length, 0.24);
  smoothAllWeightsOnMesh(mesh, boneNodes.length, 0.18);
}

function applyPaintStrokeAtPoint(
  posAttr: THREE.BufferAttribute,
  skinIdxAttr: THREE.BufferAttribute,
  skinWtAttr: THREE.BufferAttribute,
  matrixWorld: THREE.Matrix4,
  targetBoneIndex: number,
  worldPoint: THREE.Vector3,
  brushRadius: number,
  strength: number,
  mode: 'add' | 'subtract' | 'smooth' | 'replace',
): boolean {
  const radiusSq = brushRadius * brushRadius;
  let modified = false;

  for (let i = 0; i < posAttr.count; i++) {
    _v.fromBufferAttribute(posAttr, i).applyMatrix4(matrixWorld);
    const dSq = _v.distanceToSquared(worldPoint);
    if (dSq > radiusSq) continue;

    const falloff = 1 - Math.sqrt(dSq) / brushRadius;
    const delta = strength * falloff;

    const indices = [
      skinIdxAttr.getX(i),
      skinIdxAttr.getY(i),
      skinIdxAttr.getZ(i),
      skinIdxAttr.getW(i),
    ];
    const weights = [
      skinWtAttr.getX(i),
      skinWtAttr.getY(i),
      skinWtAttr.getZ(i),
      skinWtAttr.getW(i),
    ];

    let slot = indices.indexOf(targetBoneIndex);
    if (slot === -1 && (mode === 'add' || mode === 'replace')) {
      let minSlot = 0;
      for (let k = 1; k < 4; k++) {
        if (weights[k] < weights[minSlot]) minSlot = k;
      }
      slot = minSlot;
      indices[slot] = targetBoneIndex;
      weights[slot] = 0;
    }

    if (slot !== -1) {
      if (mode === 'add') {
        weights[slot] = Math.min(1, weights[slot] + delta);
      } else if (mode === 'subtract') {
        weights[slot] = Math.max(0, weights[slot] - delta);
      } else if (mode === 'replace') {
        weights[slot] = THREE.MathUtils.lerp(weights[slot], strength, falloff);
      } else {
        weights[slot] = THREE.MathUtils.lerp(weights[slot], 0.5, delta * 0.6);
      }
    }

    const total = weights[0] + weights[1] + weights[2] + weights[3];
    if (total > 0.0001) {
      for (let k = 0; k < 4; k++) weights[k] /= total;
    } else {
      weights[0] = 1;
      weights[1] = 0;
      weights[2] = 0;
      weights[3] = 0;
    }

    skinIdxAttr.setXYZW(i, indices[0], indices[1], indices[2], indices[3]);
    skinWtAttr.setXYZW(i, weights[0], weights[1], weights[2], weights[3]);
    modified = true;
  }

  return modified;
}

/**
 * Interactive 3D Heat Map Brush Painting with optional L/R symmetry mirror stroke.
 */
export function paintHeatWeightOnMesh(
  mesh: THREE.Mesh,
  boneIndex: number,
  worldHitPoint: THREE.Vector3,
  brushRadius: number,
  strength: number,
  mode: 'add' | 'subtract' | 'smooth' | 'replace',
  mirrorBoneIndex?: number,
): boolean {
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const skinIdxAttr = geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWtAttr = geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr || !skinIdxAttr || !skinWtAttr) return false;

  mesh.updateMatrixWorld(true);
  let modified = applyPaintStrokeAtPoint(
    posAttr,
    skinIdxAttr,
    skinWtAttr,
    mesh.matrixWorld,
    boneIndex,
    worldHitPoint,
    brushRadius,
    strength,
    mode,
  );

  if (mirrorBoneIndex !== undefined && mirrorBoneIndex >= 0 && Math.abs(worldHitPoint.x) > 0.02) {
    const mirrorPoint = new THREE.Vector3(-worldHitPoint.x, worldHitPoint.y, worldHitPoint.z);
    const mirrorMod = applyPaintStrokeAtPoint(
      posAttr,
      skinIdxAttr,
      skinWtAttr,
      mesh.matrixWorld,
      mirrorBoneIndex,
      mirrorPoint,
      brushRadius,
      strength,
      mode,
    );
    modified = modified || mirrorMod;
  }

  if (modified) {
    skinIdxAttr.needsUpdate = true;
    skinWtAttr.needsUpdate = true;
  }
  return modified;
}

/**
 * Normalizes all 4 vertex weights on a mesh so every vertex sums strictly to 1.0.
 */
export function normalizeWeightsOnMesh(mesh: THREE.Mesh, boneCount: number): void {
  sanitizeSkinAttributes(mesh.geometry, boneCount);
}

/**
 * Prunes tiny noisy weights below `threshold` and renormalizes remaining influences.
 */
export function cleanupWeightsOnMesh(mesh: THREE.Mesh, threshold = 0.025, boneCount = 64): number {
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr || !skinIdx || !skinWt) return 0;

  let pruned = 0;
  for (let i = 0; i < posAttr.count; i++) {
    const idx = [skinIdx.getX(i), skinIdx.getY(i), skinIdx.getZ(i), skinIdx.getW(i)];
    const wt = [skinWt.getX(i), skinWt.getY(i), skinWt.getZ(i), skinWt.getW(i)];
    let maxK = 0;
    for (let k = 1; k < 4; k++) {
      if (wt[k] > wt[maxK]) maxK = k;
    }
    for (let k = 0; k < 4; k++) {
      if (k !== maxK && wt[k] > 0 && wt[k] < threshold) {
        wt[k] = 0;
        pruned += 1;
      }
      idx[k] = Math.min(boneCount - 1, Math.max(0, Math.round(idx[k])));
    }
    const sum = wt[0] + wt[1] + wt[2] + wt[3];
    if (sum > 0.0001) {
      for (let k = 0; k < 4; k++) wt[k] /= sum;
    } else {
      wt[0] = 1;
      wt[1] = 0;
      wt[2] = 0;
      wt[3] = 0;
    }
    skinIdx.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
    skinWt.setXYZW(i, wt[0], wt[1], wt[2], wt[3]);
  }
  skinIdx.needsUpdate = true;
  skinWt.needsUpdate = true;
  return pruned;
}

/**
 * Laplacian topological weight smoothing using triangle adjacency on a mesh.
 */
export function smoothAllWeightsOnMesh(mesh: THREE.Mesh, boneCount: number, blend = 0.42): void {
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr || !skinIdx || !skinWt) return;

  mesh.updateMatrixWorld(true);
  const count = posAttr.count;
  const worldPos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    worldPos[i * 3] = _v.x;
    worldPos[i * 3 + 1] = _v.y;
    worldPos[i * 3 + 2] = _v.z;
  }

  const neighbors: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  const indexAttr = geo.index;
  if (indexAttr) {
    for (let t = 0; t + 2 < indexAttr.count; t += 3) {
      const a = indexAttr.getX(t);
      const b = indexAttr.getX(t + 1);
      const c = indexAttr.getX(t + 2);
      if (a < count && b < count && c < count) {
        neighbors[a].add(b).add(c);
        neighbors[b].add(a).add(c);
        neighbors[c].add(a).add(b);
      }
    }
  } else {
    for (let t = 0; t + 2 < count; t += 3) {
      neighbors[t].add(t + 1).add(t + 2);
      neighbors[t + 1].add(t).add(t + 2);
      neighbors[t + 2].add(t).add(t + 1);
    }
  }

  const nextIdx = new Uint16Array(count * 4);
  const nextWt = new Float32Array(count * 4);
  const accum = new Map<number, number>();
  const MAX_SMOOTH_EDGE_SQ = 0.14 * 0.14;

  for (let i = 0; i < count; i++) {
    accum.clear();
    const ix = worldPos[i * 3];
    const iy = worldPos[i * 3 + 1];
    const iz = worldPos[i * 3 + 2];

    const nbrs = neighbors[i];
    const edgeWeights: Array<{ n: number; ew: number }> = [];
    let totalEw = 0;

    for (const n of nbrs) {
      const dx = worldPos[n * 3] - ix;
      const dy = worldPos[n * 3 + 1] - iy;
      const dz = worldPos[n * 3 + 2] - iz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > MAX_SMOOTH_EDGE_SQ) continue;
      const ew = 1 / Math.max(0.0001, dSq);
      edgeWeights.push({ n, ew });
      totalEw += ew;
    }

    const effectiveBlend = totalEw > 0 ? blend : 0;
    const selfScale = 1 - effectiveBlend;
    for (let k = 0; k < 4; k++) {
      const b = k === 0 ? skinIdx.getX(i) : k === 1 ? skinIdx.getY(i) : k === 2 ? skinIdx.getZ(i) : skinIdx.getW(i);
      const w = k === 0 ? skinWt.getX(i) : k === 1 ? skinWt.getY(i) : k === 2 ? skinWt.getZ(i) : skinWt.getW(i);
      if (w > 0) accum.set(b, (accum.get(b) || 0) + w * selfScale);
    }

    if (totalEw > 0) {
      for (const { n, ew } of edgeWeights) {
        const nbrShare = (effectiveBlend * ew) / totalEw;
        for (let k = 0; k < 4; k++) {
          const b = k === 0 ? skinIdx.getX(n) : k === 1 ? skinIdx.getY(n) : k === 2 ? skinIdx.getZ(n) : skinIdx.getW(n);
          const w = k === 0 ? skinWt.getX(n) : k === 1 ? skinWt.getY(n) : k === 2 ? skinWt.getZ(n) : skinWt.getW(n);
          if (w > 0) accum.set(b, (accum.get(b) || 0) + w * nbrShare);
        }
      }
    }

    const sorted = Array.from(accum.entries())
      .filter(([b, w]) => b >= 0 && b < boneCount && w > 0.0001)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    let sum = sorted.reduce((acc, e) => acc + e[1], 0);
    if (sum <= 0.0001) sum = 1;
    for (let k = 0; k < 4; k++) {
      nextIdx[i * 4 + k] = sorted[k]?.[0] ?? 0;
      nextWt[i * 4 + k] = sorted[k] ? sorted[k][1] / sum : 0;
    }
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(nextIdx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(nextWt, 4));
}

/**
 * Mirrors vertex skin weights from Left (+X) to Right (-X) (or R -> L) across X=0 plane,
 * remapping Left / Right bone indices cleanly to their symmetrical counterpart.
 */
export function mirrorAllWeightsOnMesh(
  mesh: THREE.Mesh,
  bones: BoneNode[],
  direction: 'LtoR' | 'RtoL' = 'LtoR',
): number {
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr || !skinIdx || !skinWt || bones.length === 0) return 0;

  mesh.updateMatrixWorld(true);
  const nameToIdx = new Map<string, number>();
  bones.forEach((b, i) => nameToIdx.set(b.name, i));

  const mirrorIndexMap = bones.map((b, i) => {
    let mName: string | null = null;
    if (b.name.startsWith('Left')) mName = b.name.replace(/^Left/, 'Right');
    else if (b.name.startsWith('Right')) mName = b.name.replace(/^Right/, 'Left');
    else if (b.name.endsWith('_L')) mName = b.name.replace(/_L$/, '_R');
    else if (b.name.endsWith('_R')) mName = b.name.replace(/_R$/, '_L');
    if (mName && nameToIdx.has(mName)) return nameToIdx.get(mName)!;
    return i;
  });

  const count = posAttr.count;
  const worldPts: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    worldPts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld));
  }

  let mirroredCount = 0;
  const newIdx = new Uint16Array(count * 4);
  const newWt = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    newIdx[i * 4] = skinIdx.getX(i);
    newIdx[i * 4 + 1] = skinIdx.getY(i);
    newIdx[i * 4 + 2] = skinIdx.getZ(i);
    newIdx[i * 4 + 3] = skinIdx.getW(i);
    newWt[i * 4] = skinWt.getX(i);
    newWt[i * 4 + 1] = skinWt.getY(i);
    newWt[i * 4 + 2] = skinWt.getZ(i);
    newWt[i * 4 + 3] = skinWt.getW(i);
  }

  const targetSign = direction === 'LtoR' ? -1 : 1; // If LtoR, overwrite negative X vertices
  const mirroredLookup = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const p = worldPts[i];
    if ((targetSign < 0 && p.x >= -0.005) || (targetSign > 0 && p.x <= 0.005)) continue;

    mirroredLookup.set(-p.x, p.y, p.z);
    let bestJ = -1;
    let bestDistSq = Infinity;
    for (let j = 0; j < count; j++) {
      const d = mirroredLookup.distanceToSquared(worldPts[j]);
      if (d < bestDistSq) {
        bestDistSq = d;
        bestJ = j;
      }
    }

    if (bestJ !== -1 && bestDistSq < 0.04) {
      newIdx[i * 4] = mirrorIndexMap[skinIdx.getX(bestJ)] ?? skinIdx.getX(bestJ);
      newIdx[i * 4 + 1] = mirrorIndexMap[skinIdx.getY(bestJ)] ?? skinIdx.getY(bestJ);
      newIdx[i * 4 + 2] = mirrorIndexMap[skinIdx.getZ(bestJ)] ?? skinIdx.getZ(bestJ);
      newIdx[i * 4 + 3] = mirrorIndexMap[skinIdx.getW(bestJ)] ?? skinIdx.getW(bestJ);
      newWt[i * 4] = skinWt.getX(bestJ);
      newWt[i * 4 + 1] = skinWt.getY(bestJ);
      newWt[i * 4 + 2] = skinWt.getZ(bestJ);
      newWt[i * 4 + 3] = skinWt.getW(bestJ);
      mirroredCount += 1;
    }
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(newIdx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(newWt, 4));
  return mirroredCount;
}

/**
 * Transfers or merges weights from `fromBoneIdx` into `toBoneIdx` across a mesh.
 */
export function transferBoneWeightsOnMesh(
  mesh: THREE.Mesh,
  fromBoneIdx: number,
  toBoneIdx: number,
  fraction = 1.0,
): number {
  if (fromBoneIdx === toBoneIdx) return 0;
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr || !skinIdx || !skinWt) return 0;

  let affected = 0;
  for (let i = 0; i < posAttr.count; i++) {
    const idx = [skinIdx.getX(i), skinIdx.getY(i), skinIdx.getZ(i), skinIdx.getW(i)];
    const wt = [skinWt.getX(i), skinWt.getY(i), skinWt.getZ(i), skinWt.getW(i)];

    const fromSlot = idx.indexOf(fromBoneIdx);
    if (fromSlot === -1 || wt[fromSlot] <= 0) continue;

    const moved = wt[fromSlot] * THREE.MathUtils.clamp(fraction, 0, 1);
    wt[fromSlot] -= moved;

    let toSlot = idx.indexOf(toBoneIdx);
    if (toSlot === -1) {
      if (wt[fromSlot] <= 0.0001) {
        idx[fromSlot] = toBoneIdx;
        wt[fromSlot] = moved;
      } else {
        let minK = 0;
        for (let k = 1; k < 4; k++) if (wt[k] < wt[minK]) minK = k;
        idx[minK] = toBoneIdx;
        wt[minK] = moved;
      }
    } else {
      wt[toSlot] += moved;
    }

    const sum = wt[0] + wt[1] + wt[2] + wt[3] || 1;
    skinIdx.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
    skinWt.setXYZW(i, wt[0] / sum, wt[1] / sum, wt[2] / sum, wt[3] / sum);
    affected += 1;
  }

  if (affected > 0) {
    skinIdx.needsUpdate = true;
    skinWt.needsUpdate = true;
  }
  return affected;
}

/**
 * Picks closest vertex to a world raycast intersection and reads its 4 bone influences.
 */
export function pickClosestVertexInfluence(
  mesh: THREE.Mesh,
  worldPoint: THREE.Vector3,
  bones: BoneNode[],
): SelectedVertexInfo | null {
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr) return null;

  mesh.updateMatrixWorld(true);
  let bestIdx = 0;
  let bestDistSq = Infinity;
  const bestWorld = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    _v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    const d = _v.distanceToSquared(worldPoint);
    if (d < bestDistSq) {
      bestDistSq = d;
      bestIdx = i;
      bestWorld.copy(_v);
    }
  }

  const influences = [];
  if (skinIdx && skinWt) {
    const rawIdx = [
      skinIdx.getX(bestIdx),
      skinIdx.getY(bestIdx),
      skinIdx.getZ(bestIdx),
      skinIdx.getW(bestIdx),
    ];
    const rawWt = [
      skinWt.getX(bestIdx),
      skinWt.getY(bestIdx),
      skinWt.getZ(bestIdx),
      skinWt.getW(bestIdx),
    ];
    for (let k = 0; k < 4; k++) {
      const bIdx = Math.min(Math.max(0, Math.round(rawIdx[k])), Math.max(0, bones.length - 1));
      influences.push({
        boneIndex: bIdx,
        boneName: bones[bIdx]?.name || `Bone_${bIdx}`,
        weight: Number(rawWt[k].toFixed(4)),
      });
    }
  }

  return {
    meshUuid: mesh.uuid,
    meshName: mesh.name || 'Mesh',
    vertexIndex: bestIdx,
    worldPos: [
      Number(bestWorld.x.toFixed(3)),
      Number(bestWorld.y.toFixed(3)),
      Number(bestWorld.z.toFixed(3)),
    ],
    influences,
  };
}

/**
 * Sets a specific slot weight on a vertex and normalizes the other slots proportionally.
 */
export function setVertexSlotWeight(
  mesh: THREE.Mesh,
  vertexIndex: number,
  slot: number,
  boneIndex: number,
  newWeight: number,
): void {
  const geo = mesh.geometry;
  const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!skinIdx || !skinWt || vertexIndex < 0 || vertexIndex >= skinIdx.count) return;

  const idx = [skinIdx.getX(vertexIndex), skinIdx.getY(vertexIndex), skinIdx.getZ(vertexIndex), skinIdx.getW(vertexIndex)];
  const wt = [skinWt.getX(vertexIndex), skinWt.getY(vertexIndex), skinWt.getZ(vertexIndex), skinWt.getW(vertexIndex)];

  const clamped = THREE.MathUtils.clamp(newWeight, 0, 1);
  idx[slot] = boneIndex;
  wt[slot] = clamped;

  let othersSum = 0;
  for (let k = 0; k < 4; k++) if (k !== slot) othersSum += wt[k];
  const targetRemaining = Math.max(0, 1 - clamped);
  if (othersSum > 0.0001) {
    for (let k = 0; k < 4; k++) if (k !== slot) wt[k] = (wt[k] / othersSum) * targetRemaining;
  } else if (targetRemaining > 0.0001) {
    const fallbackSlot = (slot + 1) % 4;
    wt[fallbackSlot] = targetRemaining;
  }

  skinIdx.setXYZW(vertexIndex, idx[0], idx[1], idx[2], idx[3]);
  skinWt.setXYZW(vertexIndex, wt[0], wt[1], wt[2], wt[3]);
  skinIdx.needsUpdate = true;
  skinWt.needsUpdate = true;
}

const _heatColor = new THREE.Color();

function sampleThermalHeatColor(w: number, out: THREE.Color): THREE.Color {
  const clamped = THREE.MathUtils.clamp(w, 0, 1);
  if (clamped < 0.25) {
    const t = clamped / 0.25;
    out.setRGB(0.05, 0.15 + t * 0.75, 0.95);
  } else if (clamped < 0.5) {
    const t = (clamped - 0.25) / 0.25;
    out.setRGB(0.05, 0.9, 0.95 - t * 0.8);
  } else if (clamped < 0.75) {
    const t = (clamped - 0.5) / 0.25;
    out.setRGB(0.1 + t * 0.9, 0.95, 0.1);
  } else {
    const t = (clamped - 0.75) / 0.25;
    out.setRGB(1.0, 0.95 - t * 0.85, 0.08);
  }
  return out;
}

export function applyHeatMapVertexColors(mesh: THREE.Mesh, boneIndex: number): void {
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position;
  const skinIdxAttr = geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWtAttr = geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!posAttr) return;

  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    let w = 0;
    if (skinIdxAttr && skinWtAttr) {
      if (skinIdxAttr.getX(i) === boneIndex) w += skinWtAttr.getX(i);
      if (skinIdxAttr.getY(i) === boneIndex) w += skinWtAttr.getY(i);
      if (skinIdxAttr.getZ(i) === boneIndex) w += skinWtAttr.getZ(i);
      if (skinIdxAttr.getW(i) === boneIndex) w += skinWtAttr.getW(i);
    }
    sampleThermalHeatColor(w, _heatColor);
    colors[i * 3] = _heatColor.r;
    colors[i * 3 + 1] = _heatColor.g;
    colors[i * 3 + 2] = _heatColor.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

/**
 * Analyzes polygon topology across every mesh in `group` for:
 * - Non-manifold edges (shared by > 2 triangles)
 * - Open boundary edges (shared by only 1 triangle)
 * - Degenerate zero-area triangles
 * - NaN / invalid coordinates
 * Optionally applies a vivid color-coded viewport vertex heat map highlighting exact problem regions.
 */
export function analyzeAndHighlightMeshIssues(
  group: THREE.Object3D,
  highlightInViewport: boolean,
): MeshIssueAnalysis {
  let totalVertices = 0;
  let totalTriangles = 0;
  let nonManifoldEdges = 0;
  let boundaryEdges = 0;
  let degenerateTriangles = 0;
  let nanVertices = 0;
  const affectedMeshes: string[] = [];

  group.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const geo = mesh.geometry;
    const pos = geo?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!pos || pos.count === 0) return;

    if (!mesh.userData.__origMaterial) {
      mesh.userData.__origMaterial = mesh.material;
    }

    const vCount = pos.count;
    totalVertices += vCount;

    // Quantize spatial coordinates so UV seams map to unified topological vertex IDs
    const vertMap = new Map<string, number>();
    const canonVertIds = new Int32Array(vCount);
    const vertSeverity = new Uint8Array(vCount); // 0=clean, 1=boundary, 2=non-manifold/degenerate/NaN
    let nextCanon = 0;

    for (let i = 0; i < vCount; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        nanVertices += 1;
        vertSeverity[i] = 2;
        canonVertIds[i] = nextCanon++;
        continue;
      }
      const key = `${Math.round(x * 2000)}_${Math.round(y * 2000)}_${Math.round(z * 2000)}`;
      let cid = vertMap.get(key);
      if (cid === undefined) {
        cid = nextCanon++;
        vertMap.set(key, cid);
      }
      canonVertIds[i] = cid;
    }

    const index = geo.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(vCount / 3);
    totalTriangles += triCount;

    const edgeCounts = new Map<string, { count: number; vList: number[] }>();
    const markEdge = (rawA: number, rawB: number) => {
      const a = canonVertIds[rawA];
      const b = canonVertIds[rawB];
      if (a === b) return;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let rec = edgeCounts.get(key);
      if (!rec) {
        rec = { count: 0, vList: [] };
        edgeCounts.set(key, rec);
      }
      rec.count += 1;
      if (rec.vList.length < 12) {
        rec.vList.push(rawA, rawB);
      }
    };

    let meshNonManifold = 0;
    let meshBoundary = 0;
    let meshDegenerate = 0;

    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      if (i0 >= vCount || i1 >= vCount || i2 >= vCount) continue;

      _p0.fromBufferAttribute(pos, i0);
      _p1.fromBufferAttribute(pos, i1);
      _p2.fromBufferAttribute(pos, i2);
      _e1.subVectors(_p1, _p0);
      _e2.subVectors(_p2, _p0);
      const area2 = _cross.crossVectors(_e1, _e2).length();

      if (!Number.isFinite(area2) || area2 < 1e-8) {
        meshDegenerate += 1;
        vertSeverity[i0] = 2;
        vertSeverity[i1] = 2;
        vertSeverity[i2] = 2;
      }

      markEdge(i0, i1);
      markEdge(i1, i2);
      markEdge(i2, i0);
    }

    // Propagate severity to all UV-seam duplicates sharing a bad topological vertex
    const canonSeverity = new Uint8Array(nextCanon);
    for (const rec of edgeCounts.values()) {
      if (rec.count > 2) {
        meshNonManifold += 1;
        for (const rIdx of rec.vList) {
          canonSeverity[canonVertIds[rIdx]] = Math.max(canonSeverity[canonVertIds[rIdx]], 2);
        }
      } else if (rec.count === 1) {
        meshBoundary += 1;
        for (const rIdx of rec.vList) {
          canonSeverity[canonVertIds[rIdx]] = Math.max(canonSeverity[canonVertIds[rIdx]], 1);
        }
      }
    }

    for (let i = 0; i < vCount; i++) {
      if (vertSeverity[i] > canonSeverity[canonVertIds[i]]) {
        canonSeverity[canonVertIds[i]] = vertSeverity[i];
      }
    }

    nonManifoldEdges += meshNonManifold;
    boundaryEdges += meshBoundary;
    degenerateTriangles += meshDegenerate;

    if (meshNonManifold > 0 || meshBoundary > 0 || meshDegenerate > 0) {
      affectedMeshes.push(mesh.name || 'Mesh');
    }

    if (highlightInViewport) {
      const colors = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        const sev = Math.max(vertSeverity[i], canonSeverity[canonVertIds[i]]);
        if (sev >= 2) {
          // Critical Red/Crimson: Non-manifold edge (>2 tris) or Degenerate/NaN
          colors[i * 3] = 1.0;
          colors[i * 3 + 1] = 0.14;
          colors[i * 3 + 2] = 0.18;
        } else if (sev === 1) {
          // Amber Warning: Open Boundary Edge
          colors[i * 3] = 0.98;
          colors[i * 3 + 1] = 0.72;
          colors[i * 3 + 2] = 0.12;
        } else {
          // Clean Manifold Interior: Cool Slate-Emerald
          colors[i * 3] = 0.16;
          colors[i * 3 + 1] = 0.72;
          colors[i * 3 + 2] = 0.62;
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (!mesh.userData.__meshIssueMat) {
        mesh.userData.__meshIssueMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.55,
          metalness: 0.12,
        });
      }
      mesh.material = mesh.userData.__meshIssueMat as THREE.Material;
    } else if (mesh.userData.__origMaterial) {
      mesh.material = mesh.userData.__origMaterial as THREE.Material;
    }
  });

  return {
    totalVertices,
    totalTriangles,
    nonManifoldEdges,
    boundaryEdges,
    degenerateTriangles,
    nanVertices,
    affectedMeshes,
    hasIssues: nonManifoldEdges > 0 || boundaryEdges > 0 || degenerateTriangles > 0 || nanVertices > 0,
  };
}

export interface BoundRigResult {
  skinnedGroup: THREE.Group;
  skeleton: THREE.Skeleton;
  bonesByName: Map<string, THREE.Bone>;
  orderedBones: THREE.Bone[];
  restPositions: Map<string, THREE.Vector3>;
  restRotations: Map<string, THREE.Euler>;
}

function sanitizeSkinAttributes(geometry: THREE.BufferGeometry, boneCount: number): void {
  const posAttr = geometry.attributes.position;
  if (!posAttr || boneCount <= 0) return;

  const skinIdx = geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWt = geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!skinIdx || !skinWt) return;

  for (let i = 0; i < posAttr.count; i++) {
    const idx = [
      Math.min(boneCount - 1, Math.max(0, Math.round(skinIdx.getX(i)))),
      Math.min(boneCount - 1, Math.max(0, Math.round(skinIdx.getY(i)))),
      Math.min(boneCount - 1, Math.max(0, Math.round(skinIdx.getZ(i)))),
      Math.min(boneCount - 1, Math.max(0, Math.round(skinIdx.getW(i)))),
    ];
    const wt = [
      Math.max(0, skinWt.getX(i)),
      Math.max(0, skinWt.getY(i)),
      Math.max(0, skinWt.getZ(i)),
      Math.max(0, skinWt.getW(i)),
    ];
    const sum = wt[0] + wt[1] + wt[2] + wt[3];
    if (sum > 0.0001) {
      wt[0] /= sum;
      wt[1] /= sum;
      wt[2] /= sum;
      wt[3] /= sum;
    } else {
      idx[0] = 0;
      wt[0] = 1;
      wt[1] = 0;
      wt[2] = 0;
      wt[3] = 0;
    }
    skinIdx.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
    skinWt.setXYZW(i, wt[0], wt[1], wt[2], wt[3]);
  }
  skinIdx.needsUpdate = true;
  skinWt.needsUpdate = true;
}

/**
 * Binds any source Group (uploaded GLB or starter mesh) into a real
 * animated THREE.SkinnedMesh hierarchy driven by `boneNodes`.
 * Uses strict topological parent-first construction and `worldToLocal` coordinate
 * conversion so parent rotations/scales never displace child bones, while keeping
 * `orderedBones[i]` aligned 1:1 with `boneNodes[i]` (`skinIndex = i`).
 */
export function bindSkeletonToModelGroup(
  sourceGroup: THREE.Group,
  boneNodes: BoneNode[],
): BoundRigResult {
  const skinnedGroup = new THREE.Group();
  skinnedGroup.name = `${sourceGroup.name || 'Model'}_Rigged`;

  const bonesByName = new Map<string, THREE.Bone>();
  const restPositions = new Map<string, THREE.Vector3>();
  const restRotations = new Map<string, THREE.Euler>();
  const nodeByName = new Map<string, BoneNode>();
  const worldPosByName = new Map<string, THREE.Vector3>();

  for (const node of boneNodes) {
    nodeByName.set(node.name, node);
    worldPosByName.set(node.name, new THREE.Vector3(...node.position));
    const bone = new THREE.Bone();
    bone.name = node.name;
    if (node.rotation) {
      bone.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2]);
    }
    if (node.roll && Math.abs(node.roll) > 1e-4) {
      bone.rotateY(node.roll);
    }
    if (node.scale) {
      bone.scale.set(
        Math.max(0.05, node.scale[0]),
        Math.max(0.05, node.scale[1]),
        Math.max(0.05, node.scale[2]),
      );
    }
    bonesByName.set(node.name, bone);
  }

  // Keep orderedBones strictly matching boneNodes index order for 1:1 skinIndex mapping
  const orderedBones: THREE.Bone[] = boneNodes.map((n) => bonesByName.get(n.name)!);

  const rootBonesGroup = new THREE.Group();
  rootBonesGroup.name = 'Armature';
  skinnedGroup.add(rootBonesGroup);

  // Build parent -> child hierarchy in topological BFS order so parent matrixWorld is ALWAYS exact
  const childrenByParent = new Map<string | null, BoneNode[]>();
  for (const node of boneNodes) {
    const validParent =
      node.parent && nodeByName.has(node.parent) && node.parent !== node.name ? node.parent : null;
    if (!childrenByParent.has(validParent)) childrenByParent.set(validParent, []);
    childrenByParent.get(validParent)!.push(node);
  }

  const visited = new Set<string>();
  const queue: Array<{ node: BoneNode; parentName: string | null }> = [];
  for (const rootNode of childrenByParent.get(null) ?? []) {
    queue.push({ node: rootNode, parentName: null });
  }

  // Fallback for any disconnected cycle nodes
  for (const n of boneNodes) {
    if (!queue.some((q) => q.node.name === n.name)) {
      const vp = n.parent && nodeByName.has(n.parent) && n.parent !== n.name ? n.parent : null;
      if (!vp) queue.push({ node: n, parentName: null });
    }
  }

  while (queue.length > 0) {
    const { node, parentName } = queue.shift()!;
    if (visited.has(node.name)) continue;
    visited.add(node.name);

    const bone = bonesByName.get(node.name)!;
    const desiredWorld = worldPosByName.get(node.name)!.clone();

    if (parentName && bonesByName.has(parentName)) {
      const parentBone = bonesByName.get(parentName)!;
      parentBone.updateMatrixWorld(true);
      // Exact worldToLocal prevents parent rotation/scale from teleporting children
      bone.position.copy(parentBone.worldToLocal(desiredWorld));
      parentBone.add(bone);
    } else {
      bone.position.copy(desiredWorld);
      rootBonesGroup.add(bone);
    }

    bone.updateMatrixWorld(true);
    restPositions.set(node.name, bone.position.clone());
    restRotations.set(node.name, bone.rotation.clone());

    for (const ch of childrenByParent.get(node.name) ?? []) {
      if (!visited.has(ch.name)) {
        queue.push({ node: ch, parentName: node.name });
      }
    }
  }

  // Attach any remaining nodes involved in cycles safely under root
  for (const node of boneNodes) {
    if (!visited.has(node.name)) {
      const bone = bonesByName.get(node.name)!;
      bone.position.copy(worldPosByName.get(node.name)!);
      rootBonesGroup.add(bone);
      bone.updateMatrixWorld(true);
      restPositions.set(node.name, bone.position.clone());
      restRotations.set(node.name, bone.rotation.clone());
    }
  }

  skinnedGroup.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(orderedBones);
  skeleton.calculateInverses();

  sourceGroup.updateMatrixWorld(true);

  sourceGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      const clonedGeo = srcMesh.geometry.clone();
      clonedGeo.applyMatrix4(srcMesh.matrixWorld);

      // Flip triangle winding if baked with negative-scale mirror transform
      if (srcMesh.matrixWorld.determinant() < 0) {
        const index = clonedGeo.index;
        if (index) {
          for (let i = 0; i + 2 < index.count; i += 3) {
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            index.setX(i + 1, c);
            index.setX(i + 2, b);
          }
          index.needsUpdate = true;
        }
        clonedGeo.computeVertexNormals();
      }

      if (!clonedGeo.attributes.skinIndex || !clonedGeo.attributes.skinWeight) {
        const tempMesh = new THREE.Mesh(clonedGeo);
        computeHeatMapWeightsForMesh(tempMesh, boneNodes, 0.36, 2.2);
      } else {
        sanitizeSkinAttributes(clonedGeo, orderedBones.length);
      }

      const clonedMat = Array.isArray(srcMesh.material)
        ? srcMesh.material.map((m) => m.clone())
        : srcMesh.material.clone();

      const matList = Array.isArray(clonedMat) ? clonedMat : [clonedMat];
      matList.forEach((m) => {
        if ('vertexColors' in m) {
          (m as THREE.MeshStandardMaterial).vertexColors = false;
          m.needsUpdate = true;
        }
      });

      const skinnedMesh = new THREE.SkinnedMesh(clonedGeo, clonedMat);
      skinnedMesh.name = `${srcMesh.name || 'Mesh'}_Skinned`;
      skinnedMesh.castShadow = true;
      skinnedMesh.receiveShadow = true;
      skinnedMesh.frustumCulled = false;
      if (srcMesh.morphTargetDictionary) {
        skinnedMesh.morphTargetDictionary = { ...srcMesh.morphTargetDictionary };
      }
      if (srcMesh.morphTargetInfluences) {
        skinnedMesh.morphTargetInfluences = [...srcMesh.morphTargetInfluences];
      }
      skinnedGroup.add(skinnedMesh);
      skinnedMesh.updateMatrixWorld(true);
      skinnedMesh.bind(skeleton, skinnedMesh.matrixWorld.clone());
    }
  });

  return { skinnedGroup, skeleton, bonesByName, orderedBones, restPositions, restRotations };
}
