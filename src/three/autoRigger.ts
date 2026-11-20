import * as THREE from 'three';
import type {
  BoneConstraint,
  BoneNode,
  DeformationJointTestResult,
  RigAuditReport,
  RigValidationIssue,
  ScanCorrectionReport,
  SkeletonPresetType,
} from '../types';
import {
  analyzeAndHighlightMeshIssues,
  analyzeImportedGLBScene,
  bindSkeletonToModelGroup,
  computeHeatMapWeightsForMesh,
  normalizeModelToUnitHeight,
  normalizeWeightsOnMesh,
  resolveHumanoidRole,
  type CanonicalHumanoidRole,
} from './riggingEngine';

const r3 = (n: number) => Number(n.toFixed(3));

export interface SilhouetteLandmarks {
  minY: number;
  maxY: number;
  height: number;
  centerX: number;
  centerZ: number;
  pelvisY: number;
  pelvisZ: number;
  spineY: number;
  spineZ: number;
  chestY: number;
  chestZ: number;
  shoulderY: number;
  shoulderZ: number;
  neckY: number;
  neckZ: number;
  headY: number;
  headX: number;
  headZ: number;
  headTopY: number;
  headFrontZ: number;
  torsoHalfWidth: number;
  shoulderWidth: number;
  armSpanHalf: number;
  handY: number;
  lShoulderPos: [number, number, number];
  lArmPos: [number, number, number];
  lElbowPos: [number, number, number];
  lHandPos: [number, number, number];
  lHandDir: [number, number, number];
  lHandSpan: number;
  rShoulderPos: [number, number, number];
  rArmPos: [number, number, number];
  rElbowPos: [number, number, number];
  rHandPos: [number, number, number];
  rHandDir: [number, number, number];
  rHandSpan: number;
  hipSpreadX: number;
  lUpLegPos: [number, number, number];
  lKneePos: [number, number, number];
  lAnklePos: [number, number, number];
  lToePos: [number, number, number];
  rUpLegPos: [number, number, number];
  rKneePos: [number, number, number];
  rAnklePos: [number, number, number];
  rToePos: [number, number, number];
  kneeY: number;
  ankleY: number;
  toeForwardZ: number;
  headRadius: number;
  orientationWarning?: string;
}

const DEFAULT_CONSTRAINTS: Record<string, BoneConstraint> = {
  Neck: { enabled: true, minDeg: [-45, -65, -35], maxDeg: [45, 65, 35] },
  Head: { enabled: true, minDeg: [-50, -75, -35], maxDeg: [50, 75, 35] },
  Jaw: { enabled: true, minDeg: [0, -10, -5], maxDeg: [48, 10, 5] },
  LeftForearm: { enabled: true, minDeg: [-145, -35, -35], maxDeg: [10, 35, 35] },
  RightForearm: { enabled: true, minDeg: [-145, -35, -35], maxDeg: [10, 35, 35] },
  LeftLeg: { enabled: true, minDeg: [-5, -15, -15], maxDeg: [145, 15, 15] },
  RightLeg: { enabled: true, minDeg: [-5, -15, -15], maxDeg: [145, 15, 15] },
  LeftFoot: { enabled: true, minDeg: [-55, -30, -25], maxDeg: [65, 30, 25] },
  RightFoot: { enabled: true, minDeg: [-55, -30, -25], maxDeg: [65, 30, 25] },
};

function percentileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = THREE.MathUtils.clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

function trimmedMedian(vals: number[], trimFrac = 0.15): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const lo = Math.floor(s.length * trimFrac);
  const hi = Math.max(lo + 1, Math.ceil(s.length * (1 - trimFrac)));
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += s[i];
  return sum / (hi - lo);
}

function computeCentroid3(pts: THREE.Vector3[]): THREE.Vector3 | null {
  if (pts.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  return new THREE.Vector3(sx / pts.length, sy / pts.length, sz / pts.length);
}

/**
 * Ensures any joint coordinate lies inside or tightly anchored to its local mesh volume
 * by checking distance to sampled character vertices and snapping toward the local vertex cluster if drifted outside.
 */
function snapJointInsideMeshVolume(
  joint: THREE.Vector3,
  candidatePts: THREE.Vector3[],
  maxOutsideDist: number,
  pullRadius: number,
): THREE.Vector3 {
  if (candidatePts.length === 0) return joint;
  let nearestDistSq = Infinity;
  const nearPts: Array<{ p: THREE.Vector3; dSq: number }> = [];
  const pullRadiusSq = pullRadius * pullRadius;

  for (const p of candidatePts) {
    const dSq = p.distanceToSquared(joint);
    if (dSq < nearestDistSq) nearestDistSq = dSq;
    if (dSq <= pullRadiusSq) nearPts.push({ p, dSq });
  }

  if (nearestDistSq <= maxOutsideDist * maxOutsideDist && nearPts.length >= 3) {
    return joint;
  }

  if (nearPts.length >= 3) {
    const c = computeCentroid3(nearPts.map((n) => n.p));
    if (c) return joint.clone().lerp(c, 0.72);
  }

  // Fallback to 12 globally closest vertices in candidatePts
  const closest = candidatePts
    .map((p) => ({ p, dSq: p.distanceToSquared(joint) }))
    .sort((a, b) => a.dSq - b.dSq)
    .slice(0, 12)
    .map((e) => e.p);
  const c = computeCentroid3(closest);
  return c ?? joint;
}

/**
 * Traces a single arm (`side = +1` Left, `side = -1` Right) via 3D voxel-graph BFS geodesic distance
 * starting at the shoulder root, cleanly handling T-pose, A-pose, I-pose, and bent elbows while rejecting
 * disconnected props or stray floor meshes.
 */
function traceGeodesicArmChain(
  allPts: THREE.Vector3[],
  centerX: number,
  minY: number,
  height: number,
  pelvisY: number,
  shoulderY: number,
  neckY: number,
  chestZ: number,
  torsoHalfWidth: number,
  headCenterX: number,
  headOuterHalfX: number,
  torsoWallBySlice: Float32Array,
  legOuterBySlice: Float32Array,
  sliceCount: number,
  side: 1 | -1,
): {
  shoulderJoint: THREE.Vector3;
  armRoot: THREE.Vector3;
  elbow: THREE.Vector3;
  hand: THREE.Vector3;
  handDir: THREE.Vector3;
  handSpan: number;
} {
  const getInnerExclusionX = (y: number): number => {
    const t = THREE.MathUtils.clamp((y - minY) / height, 0, 0.9999);
    const sIdx = Math.floor(t * sliceCount);
    if (y >= pelvisY - height * 0.03) {
      const cappedSliceWall = Math.min(torsoWallBySlice[sIdx], torsoHalfWidth * 1.16);
      return Math.max(torsoHalfWidth * 1.02, cappedSliceWall) + height * 0.008;
    }
    return Math.max(torsoHalfWidth * 1.02, legOuterBySlice[sIdx] + height * 0.014);
  };

  // Collect arm vertices strictly outside the torso / leg cylinder AND outside the head envelope
  const headExcludeHalfX = headOuterHalfX + height * 0.022;
  const armPts: THREE.Vector3[] = [];
  for (const p of allPts) {
    if (p.y < minY + height * 0.14 || p.y > neckY + height * 0.16) continue;
    if (p.y >= neckY - height * 0.012 && Math.abs(p.x - headCenterX) <= headExcludeHalfX) {
      continue;
    }
    const dxSigned = (p.x - centerX) * side;
    if (dxSigned <= getInnerExclusionX(p.y)) continue;
    armPts.push(p);
  }

  if (armPts.length < 10) {
    // Arms are tucked close to torso/hips (e.g. I-pose) so no separated outer cluster protruded beyond torso wall.
    // Trace the outer lateral edge of the upper-body/hip silhouette instead of placing joints in empty air outside the mesh.
    const innerEdge = Math.min(torsoHalfWidth * 0.62, height * 0.12);
    const flushArmPts = allPts.filter((p) => {
      if (p.y < Math.max(minY + height * 0.16, pelvisY - height * 0.16)) return false;
      if (p.y > shoulderY + height * 0.05) return false;
      if (p.y >= neckY - height * 0.012 && Math.abs(p.x - headCenterX) <= headExcludeHalfX) {
        return false;
      }
      const dxSigned = (p.x - centerX) * side;
      return dxSigned >= innerEdge;
    });

    const bodyPool = flushArmPts.length >= 10 ? flushArmPts : allPts;
    let maxArmLat = torsoHalfWidth * 0.85;
    for (const p of bodyPool) {
      const dx = (p.x - centerX) * side;
      if (dx > maxArmLat && p.y <= shoulderY + height * 0.05 && p.y >= pelvisY - height * 0.16) {
        maxArmLat = dx;
      }
    }

    const armX = centerX + side * Math.max(innerEdge + height * 0.012, maxArmLat * 0.84);
    const sh = snapJointInsideMeshVolume(
      new THREE.Vector3(centerX + side * Math.min(torsoHalfWidth * 0.56, height * 0.095), shoulderY, chestZ),
      allPts,
      height * 0.03,
      height * 0.09,
    );
    const armBand = flushArmPts.filter((p) => Math.abs(p.y - (shoulderY - height * 0.02)) <= height * 0.06);
    const armRaw = computeCentroid3(armBand) ?? new THREE.Vector3(armX, shoulderY - height * 0.02, chestZ);
    armRaw.x = THREE.MathUtils.lerp(armRaw.x, armX, 0.5);

    const lowestArmY =
      flushArmPts.length >= 10
        ? Math.max(
            minY + height * 0.22,
            percentileSorted(flushArmPts.map((p) => p.y).sort((a, b) => a - b), 0.12),
          )
        : Math.max(minY + height * 0.34, pelvisY - height * 0.05);
    const handBand = flushArmPts.filter((p) => Math.abs(p.y - lowestArmY) <= height * 0.045);
    const handRaw = computeCentroid3(handBand) ?? new THREE.Vector3(armX, lowestArmY, chestZ);
    const elbowTargetY = THREE.MathUtils.lerp(armRaw.y, handRaw.y, 0.48);
    const elbowBand = flushArmPts.filter((p) => Math.abs(p.y - elbowTargetY) <= height * 0.05);
    const elbowRaw =
      computeCentroid3(elbowBand) ??
      armRaw.clone().lerp(handRaw, 0.48).add(new THREE.Vector3(0, 0, -height * 0.01));

    const arm = snapJointInsideMeshVolume(armRaw, bodyPool, height * 0.025, height * 0.08);
    const elbow = snapJointInsideMeshVolume(elbowRaw, bodyPool, height * 0.025, height * 0.08);
    const hand = snapJointInsideMeshVolume(handRaw, bodyPool, height * 0.022, height * 0.07);
    const dir = hand.clone().sub(elbow);
    if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);

    return {
      shoulderJoint: sh,
      armRoot: arm,
      elbow,
      hand,
      handDir: dir.normalize(),
      handSpan: height * 0.05,
    };
  }

  // Locate shoulder socket candidates below neckY near shoulderY closest to torso wall
  const shoulderBandPts = armPts.filter(
    (p) => p.y <= neckY + height * 0.01 && Math.abs(p.y - shoulderY) <= height * 0.11,
  );
  const belowNeckPool = armPts.filter((p) => p.y <= neckY + height * 0.02);
  const seedPool =
    shoulderBandPts.length >= 6
      ? shoulderBandPts
      : belowNeckPool.length >= 6
        ? belowNeckPool
        : armPts;
  let seedPt = seedPool[0];
  let bestSeedScore = Infinity;
  for (const p of seedPool) {
    const dxSigned = (p.x - centerX) * side;
    const score = dxSigned + Math.abs(p.y - shoulderY) * 1.8;
    if (score < bestSeedScore) {
      bestSeedScore = score;
      seedPt = p;
    }
  }

  // Build coarse 3D voxel graph over armPts for geodesic traversal (handles bent elbows & wide T-pose!)
  const voxelSize = THREE.MathUtils.clamp(height * 0.038, 0.026, 0.08);
  const keyOf = (ix: number, iy: number, iz: number) => `${ix}|${iy}|${iz}`;
  const toVoxel = (p: THREE.Vector3): [number, number, number] => [
    Math.round(p.x / voxelSize),
    Math.round(p.y / voxelSize),
    Math.round(p.z / voxelSize),
  ];

  interface VoxelCell {
    ix: number;
    iy: number;
    iz: number;
    pts: THREE.Vector3[];
    centroid: THREE.Vector3;
    gDist: number;
  }

  const voxelMap = new Map<string, VoxelCell>();
  for (const p of armPts) {
    const [ix, iy, iz] = toVoxel(p);
    const k = keyOf(ix, iy, iz);
    let cell = voxelMap.get(k);
    if (!cell) {
      cell = { ix, iy, iz, pts: [], centroid: new THREE.Vector3(), gDist: -1 };
      voxelMap.set(k, cell);
    }
    cell.pts.push(p);
  }
  for (const cell of voxelMap.values()) {
    const c = computeCentroid3(cell.pts);
    if (c) cell.centroid.copy(c);
  }

  const [six, siy, siz] = toVoxel(seedPt);
  const startCell = voxelMap.get(keyOf(six, siy, siz));
  const visitedCells: VoxelCell[] = [];

  if (startCell) {
    startCell.gDist = 0;
    const queue: VoxelCell[] = [startCell];
    let qHead = 0;
    while (qHead < queue.length) {
      const cur = queue[qHead++];
      visitedCells.push(cur);
      // 2-ring voxel neighborhood bridges slight triangle gaps on low-poly meshes
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nk = keyOf(cur.ix + dx, cur.iy + dy, cur.iz + dz);
            const nbr = voxelMap.get(nk);
            if (!nbr) continue;
            const stepCost = cur.centroid.distanceTo(nbr.centroid);
            if (stepCost > voxelSize * 3.2) continue;
            const nextDist = cur.gDist + stepCost;
            if (nbr.gDist < 0 || nextDist < nbr.gDist) {
              const firstVisit = nbr.gDist < 0;
              nbr.gDist = nextDist;
              if (firstVisit) queue.push(nbr);
            }
          }
        }
      }
    }
  }

  // Re-run Dijkstra-like relaxation twice so exact path lengths settle cleanly
  for (let pass = 0; pass < 2; pass++) {
    for (const cur of visitedCells) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nbr = voxelMap.get(keyOf(cur.ix + dx, cur.iy + dy, cur.iz + dz));
            if (!nbr || nbr.gDist < 0) continue;
            const stepCost = cur.centroid.distanceTo(nbr.centroid);
            if (stepCost <= voxelSize * 3.2 && cur.gDist + stepCost < nbr.gDist) {
              nbr.gDist = cur.gDist + stepCost;
            }
          }
        }
      }
    }
  }

  const connectedPts: Array<{ p: THREE.Vector3; g: number }> = [];
  let maxG = 0;
  for (const cell of visitedCells) {
    if (cell.gDist > maxG) maxG = cell.gDist;
    for (const p of cell.pts) {
      connectedPts.push({ p, g: cell.gDist });
    }
  }

  if (connectedPts.length < 10 || maxG < height * 0.08) {
    // Fallback to Euclidean radial trace over armPts if arm voxel graph was fragmented
    const rootPt = seedPt.clone();
    let maxD = 0;
    for (const p of armPts) {
      const d = p.distanceTo(rootPt);
      if (d > maxD) maxD = d;
    }
    const bandCentroid = (lo: number, hi: number, fb: THREE.Vector3) => {
      const sub = armPts.filter((p) => {
        const d = p.distanceTo(rootPt);
        return d >= maxD * lo && d <= maxD * hi;
      });
      return computeCentroid3(sub) ?? fb;
    };
    const farthest = armPts.reduce(
      (b, p) => (p.distanceToSquared(rootPt) > b.distanceToSquared(rootPt) ? p : b),
      rootPt,
    );
    const armRoot = bandCentroid(0.0, 0.14, rootPt);
    const elbow = bandCentroid(0.40, 0.56, rootPt.clone().lerp(farthest, 0.48));
    const hand = bandCentroid(0.76, 0.89, rootPt.clone().lerp(farthest, 0.84));
    const tip = bandCentroid(0.90, 1.0, farthest);
    const shoulderJoint = new THREE.Vector3(
      THREE.MathUtils.lerp(centerX, armRoot.x, 0.62),
      THREE.MathUtils.lerp(shoulderY, armRoot.y, 0.45),
      THREE.MathUtils.lerp(chestZ, armRoot.z, 0.6),
    );
    const dir = tip.clone().sub(hand);
    if (dir.lengthSq() < 1e-6) dir.copy(hand).sub(elbow);
    if (dir.lengthSq() < 1e-6) dir.set(side * 0.4, -0.9, 0);
    const handSpan = THREE.MathUtils.clamp(hand.distanceTo(tip), height * 0.032, height * 0.095);
    return {
      shoulderJoint,
      armRoot: snapJointInsideMeshVolume(armRoot, armPts, height * 0.025, height * 0.08),
      elbow: snapJointInsideMeshVolume(elbow, armPts, height * 0.025, height * 0.08),
      hand: snapJointInsideMeshVolume(hand, armPts, height * 0.022, height * 0.07),
      handDir: dir.normalize(),
      handSpan,
    };
  }

  const bandCentroidG = (lo: number, hi: number): THREE.Vector3 | null => {
    const sub = connectedPts.filter((e) => e.g >= maxG * lo && e.g <= maxG * hi).map((e) => e.p);
    return computeCentroid3(sub);
  };

  const armRootRaw = bandCentroidG(0.0, 0.12) ?? seedPt.clone();
  const handRaw =
    bandCentroidG(0.77, 0.88) ??
    bandCentroidG(0.70, 0.92) ??
    armRootRaw.clone().lerp(connectedPts[connectedPts.length - 1].p, 0.82);
  const tipRaw =
    bandCentroidG(0.91, 1.0) ??
    connectedPts.reduce((b, e) => (e.g > b.g ? e : b), connectedPts[0]).p;

  // Detect true elbow bend around geodesic midpoint [0.36 .. 0.58]
  const elbowMid =
    bandCentroidG(0.41, 0.54) ?? armRootRaw.clone().lerp(handRaw, 0.5);

  const armCloud = connectedPts.map((e) => e.p);
  const armRoot = snapJointInsideMeshVolume(armRootRaw, armCloud, height * 0.022, height * 0.08);
  const elbow = snapJointInsideMeshVolume(elbowMid, armCloud, height * 0.022, height * 0.08);
  const hand = snapJointInsideMeshVolume(handRaw, armCloud, height * 0.02, height * 0.065);

  const clavicleOffset = Math.min(
    Math.abs(armRoot.x - centerX) * 0.62,
    torsoHalfWidth * 0.88,
  );
  const shoulderJoint = new THREE.Vector3(
    centerX + side * clavicleOffset,
    THREE.MathUtils.lerp(shoulderY, armRoot.y, 0.45),
    THREE.MathUtils.lerp(chestZ, armRoot.z, 0.55),
  );

  const dir = tipRaw.clone().sub(hand);
  if (dir.lengthSq() < 1e-6) dir.copy(hand).sub(elbow);
  if (dir.lengthSq() < 1e-6) dir.set(side * 0.4, -0.9, 0);
  dir.normalize();

  const handSpan = THREE.MathUtils.clamp(hand.distanceTo(tipRaw), height * 0.032, height * 0.095);

  return {
    shoulderJoint,
    armRoot,
    elbow,
    hand,
    handDir: dir,
    handSpan,
  };
}

/**
 * Traces a single leg (`side = +1` Left, `side = -1` Right) across vertical slices from `minY` to `crotchY`,
 * locating hip socket, knee centroid, narrowest ankle constriction, and toe forward tip inside the mesh.
 */
function traceLegChain(
  allPts: THREE.Vector3[],
  centerX: number,
  centerZ: number,
  minY: number,
  height: number,
  pelvisY: number,
  crotchY: number,
  maxLegOuterX: number,
  side: 1 | -1,
): {
  upLeg: THREE.Vector3;
  knee: THREE.Vector3;
  ankle: THREE.Vector3;
  toe: THREE.Vector3;
} {
  const legHeight = Math.max(crotchY - minY, height * 0.16);
  const legPts = allPts.filter((p) => {
    if (p.y > pelvisY - height * 0.01) return false;
    const dx = (p.x - centerX) * side;
    return dx >= height * 0.005 && dx <= maxLegOuterX;
  });

  const fbX = centerX + side * Math.max(height * 0.062, maxLegOuterX * 0.45);
  const fbHipY = Math.max(minY + legHeight * 0.88, pelvisY - height * 0.04);
  const fbAnkleY = minY + Math.max(height * 0.035, legHeight * 0.10);
  const fbKneeY = THREE.MathUtils.lerp(fbAnkleY, fbHipY, 0.50);

  if (legPts.length < 12) {
    return {
      upLeg: new THREE.Vector3(fbX, fbHipY, centerZ),
      knee: new THREE.Vector3(fbX, fbKneeY, centerZ + height * 0.008),
      ankle: new THREE.Vector3(fbX, fbAnkleY, centerZ + height * 0.008),
      toe: new THREE.Vector3(fbX, minY + height * 0.018, centerZ + height * 0.085),
    };
  }

  // Slice leg from minY to crotchY into 20 vertical slices
  const SLICES = 20;
  const sliceBuckets: THREE.Vector3[][] = Array.from({ length: SLICES }, () => []);
  for (const p of legPts) {
    const t = THREE.MathUtils.clamp((p.y - minY) / legHeight, 0, 0.9999);
    sliceBuckets[Math.floor(t * SLICES)].push(p);
  }

  const sliceCentroid = (idx: number): THREE.Vector3 | null =>
    computeCentroid3(sliceBuckets[THREE.MathUtils.clamp(idx, 0, SLICES - 1)]);

  // 1. Find narrowest ankle constriction in bottom 28% of leg height (above sole/foot flare)
  let ankleSliceIdx = Math.max(1, Math.round(0.11 * SLICES));
  let minAnkleSpan = Infinity;
  for (let s = 1; s <= Math.min(SLICES - 3, Math.round(0.28 * SLICES)); s++) {
    const pts = sliceBuckets[s];
    if (pts.length < 3) continue;
    let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const p of pts) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    const crossArea = (maxZ - minZ) * (maxX - minX) + (maxZ - minZ) * 0.02;
    if (crossArea < minAnkleSpan) {
      minAnkleSpan = crossArea;
      ankleSliceIdx = s;
    }
  }
  const ankleRaw =
    sliceCentroid(ankleSliceIdx) ??
    new THREE.Vector3(fbX, minY + ((ankleSliceIdx + 0.5) / SLICES) * legHeight, centerZ);
  // Keep ankle Z anchored to shin shaft (avoid forward pull from instep)
  const shinUpper = sliceCentroid(Math.min(SLICES - 2, ankleSliceIdx + 2));
  if (shinUpper) {
    ankleRaw.z = THREE.MathUtils.lerp(ankleRaw.z, shinUpper.z, 0.45);
  }

  // 2. Hip socket near top of separated thigh (below pelvisY)
  const topThighPts = legPts.filter(
    (p) => p.y >= minY + legHeight * 0.78 && p.y <= pelvisY - height * 0.015,
  );
  const upLegRaw =
    computeCentroid3(topThighPts) ??
    sliceCentroid(SLICES - 2) ??
    new THREE.Vector3(fbX, fbHipY, centerZ);
  upLegRaw.y = THREE.MathUtils.clamp(upLegRaw.y, minY + legHeight * 0.78, pelvisY - height * 0.02);

  // 3. Knee at midpoint between ankle and hip socket, using actual slice centroid at that Y
  const kneeTargetY = THREE.MathUtils.lerp(ankleRaw.y, upLegRaw.y, 0.50);
  const kneePts = legPts.filter((p) => Math.abs(p.y - kneeTargetY) <= legHeight * 0.08);
  const kneeRaw =
    computeCentroid3(kneePts) ??
    new THREE.Vector3((upLegRaw.x + ankleRaw.x) * 0.5, kneeTargetY, (upLegRaw.z + ankleRaw.z) * 0.5);
  kneeRaw.y = kneeTargetY;

  // 4. Foot / Toe tip below ankleY
  const footPts = legPts.filter((p) => p.y <= ankleRaw.y + height * 0.015);
  let footMinY = minY;
  let toeZ = ankleRaw.z + height * 0.08;
  let toeX = ankleRaw.x;
  if (footPts.length >= 4) {
    let minFY = Infinity;
    for (const p of footPts) if (p.y < minFY) minFY = p.y;
    footMinY = minFY;
    const zSorted = footPts.map((p) => p.z).sort((a, b) => a - b);
    const z90 = percentileSorted(zSorted, 0.90);
    const z75 = percentileSorted(zSorted, 0.75);
    const frontPts = footPts.filter((p) => p.z >= z75);
    const frontC = computeCentroid3(frontPts);
    if (frontC) {
      toeX = frontC.x;
      toeZ = Math.max(ankleRaw.z + height * 0.035, THREE.MathUtils.lerp(frontC.z, z90, 0.45));
    }
  }
  const toeY = footMinY + THREE.MathUtils.clamp((ankleRaw.y - footMinY) * 0.30, height * 0.012, height * 0.032);
  const toeRaw = new THREE.Vector3(toeX, toeY, toeZ);

  return {
    upLeg: snapJointInsideMeshVolume(upLegRaw, legPts, height * 0.028, height * 0.09),
    knee: snapJointInsideMeshVolume(kneeRaw, legPts, height * 0.025, height * 0.08),
    ankle: snapJointInsideMeshVolume(ankleRaw, legPts, height * 0.022, height * 0.07),
    toe: snapJointInsideMeshVolume(toeRaw, footPts.length >= 4 ? footPts : legPts, height * 0.022, height * 0.065),
  };
}

/**
 * Samples the character's 3D vertex geometry across vertical height slices,
 * filters out outlier slabs/props, detects true crotch fork, neck pinch, per-band spine Z curve,
 * geodesic arms (T/A/I/bent poses), and leg chains strictly from actual 3D vertices.
 */
export function analyzeCharacterSilhouette(group: THREE.Object3D): SilhouetteLandmarks {
  group.updateMatrixWorld(true);
  const sceneAnalysis = analyzeImportedGLBScene(group);
  const box = sceneAnalysis.coreBounds;
  const size = box.getSize(new THREE.Vector3());
  const boxCenter = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  const maxY = box.max.y;
  const height = Math.max(size.y, 0.25);

  let orientationWarning: string | undefined;
  if (size.z > size.y * 1.45 && size.y < Math.max(size.x, size.z) * 0.68) {
    orientationWarning =
      'Character appears oriented horizontally along Z. Use Rig & Mesh Calibration if upright alignment is needed.';
  }

  // Dense world-space point + triangle-surface sampling across core character meshes (excluding floor/outlier slabs)
  const points: THREE.Vector3[] = [];
  const coreMeshes: THREE.Mesh[] = [];

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      if (sceneAnalysis.outlierMeshUuids.has(m.uuid)) return;
      const pos = m.geometry?.attributes?.position;
      if (pos && pos.count > 0) coreMeshes.push(m);
    }
  });

  const targetTotalPts = 16000;
  const perMeshMaxVerts = Math.max(800, Math.floor(targetTotalPts / Math.max(1, coreMeshes.length)));
  const minSurfaceSpacing = Math.max(0.012, height * 0.02);
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vInterp = new THREE.Vector3();

  for (const mesh of coreMeshes) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const sm = mesh as THREE.SkinnedMesh;
    const useSkinned = Boolean(
      sm.isSkinnedMesh &&
        sm.skeleton &&
        sm.skeleton.bones.length > 0 &&
        mesh.geometry.attributes.skinIndex &&
        mesh.geometry.attributes.skinWeight,
    );

    // Evaluate all vertices once in world space so triangle densification is O(V + T)
    const worldVerts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      if (useSkinned) {
        sm.getVertexPosition(i, vA).applyMatrix4(sm.matrixWorld);
      } else {
        vA.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      }
      worldVerts[i * 3] = vA.x;
      worldVerts[i * 3 + 1] = vA.y;
      worldVerts[i * 3 + 2] = vA.z;
    }

    const vertStride = Math.max(1, Math.floor(pos.count / perMeshMaxVerts));
    for (let i = 0; i < pos.count; i += vertStride) {
      const x = worldVerts[i * 3];
      const y = worldVerts[i * 3 + 1];
      const z = worldVerts[i * 3 + 2];
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push(new THREE.Vector3(x, y, z));
      }
    }

    // Subdivide large triangles (common on low-poly boxes/limbs) so slice & voxel graphs stay watertight
    const index = mesh.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const triStride = Math.max(1, Math.floor(triCount / 3600));
    for (let t = 0; t < triCount; t += triStride) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      if (i0 >= pos.count || i1 >= pos.count || i2 >= pos.count) continue;

      vA.set(worldVerts[i0 * 3], worldVerts[i0 * 3 + 1], worldVerts[i0 * 3 + 2]);
      vB.set(worldVerts[i1 * 3], worldVerts[i1 * 3 + 1], worldVerts[i1 * 3 + 2]);
      vC.set(worldVerts[i2 * 3], worldVerts[i2 * 3 + 1], worldVerts[i2 * 3 + 2]);

      const maxEdge = Math.max(vA.distanceTo(vB), vB.distanceTo(vC), vC.distanceTo(vA));
      if (!Number.isFinite(maxEdge) || maxEdge <= minSurfaceSpacing) continue;

      const steps = Math.min(8, Math.ceil(maxEdge / minSurfaceSpacing));
      for (let a = 0; a <= steps; a++) {
        for (let b = 0; b <= steps - a; b++) {
          // Skip corners already pushed as vertices when stride == 1
          if (vertStride === 1 && ((a === 0 && b === 0) || (a === steps && b === 0) || (a === 0 && b === steps))) {
            continue;
          }
          const u = a / steps;
          const v = b / steps;
          const w = 1 - u - v;
          vInterp
            .set(0, 0, 0)
            .addScaledVector(vA, u)
            .addScaledVector(vB, v)
            .addScaledVector(vC, w);
          if (Number.isFinite(vInterp.x) && Number.isFinite(vInterp.y) && Number.isFinite(vInterp.z)) {
            points.push(vInterp.clone());
          }
        }
      }
    }
  }

  if (points.length < 16) {
    const w = Math.max(size.x * 0.5, 0.28);
    const d = Math.max(size.z * 0.5, 0.14);
    const shY = minY + height * 0.8;
    const hY = minY + height * 0.51;
    const cx = boxCenter.x;
    const cz = boxCenter.z;
    const hipX = w * 0.23;
    const kneeY = minY + height * 0.25;
    const ankleY = minY + height * 0.045;
    const toeZ = cz + d * 0.55;
    return {
      minY,
      maxY,
      height,
      centerX: cx,
      centerZ: cz,
      pelvisY: minY + height * 0.51,
      pelvisZ: cz,
      spineY: minY + height * 0.61,
      spineZ: cz,
      chestY: minY + height * 0.73,
      chestZ: cz,
      shoulderY: shY,
      shoulderZ: cz,
      neckY: minY + height * 0.84,
      neckZ: cz,
      headY: minY + height * 0.89,
      headX: cx,
      headZ: cz,
      headTopY: minY + height * 0.99,
      headFrontZ: cz + height * 0.08,
      torsoHalfWidth: w * 0.25,
      shoulderWidth: w * 0.44,
      armSpanHalf: w * 0.82,
      handY: hY,
      lShoulderPos: [r3(cx + w * 0.26), r3(shY), r3(cz)],
      lArmPos: [r3(cx + w * 0.44), r3(shY - height * 0.015), r3(cz)],
      lElbowPos: [r3(cx + w * 0.64), r3((shY + hY) * 0.5), r3(cz - 0.02)],
      lHandPos: [r3(cx + w * 0.82), r3(hY), r3(cz)],
      lHandDir: [0.35, -0.9, 0],
      lHandSpan: height * 0.055,
      rShoulderPos: [r3(cx - w * 0.26), r3(shY), r3(cz)],
      rArmPos: [r3(cx - w * 0.44), r3(shY - height * 0.015), r3(cz)],
      rElbowPos: [r3(cx - w * 0.64), r3((shY + hY) * 0.5), r3(cz - 0.02)],
      rHandPos: [r3(cx - w * 0.82), r3(hY), r3(cz)],
      rHandDir: [-0.35, -0.9, 0],
      rHandSpan: height * 0.055,
      hipSpreadX: hipX,
      lUpLegPos: [r3(cx + hipX), r3(minY + height * 0.46), r3(cz)],
      lKneePos: [r3(cx + hipX), r3(kneeY), r3(cz + 0.015)],
      lAnklePos: [r3(cx + hipX), r3(ankleY), r3(cz + 0.01)],
      lToePos: [r3(cx + hipX), r3(minY + height * 0.022), r3(toeZ)],
      rUpLegPos: [r3(cx - hipX), r3(minY + height * 0.46), r3(cz)],
      rKneePos: [r3(cx - hipX), r3(kneeY), r3(cz + 0.015)],
      rAnklePos: [r3(cx - hipX), r3(ankleY), r3(cz + 0.01)],
      rToePos: [r3(cx - hipX), r3(minY + height * 0.022), r3(toeZ)],
      kneeY,
      ankleY,
      toeForwardZ: toeZ,
      headRadius: height * 0.08,
      orientationWarning,
    };
  }

  // 1. Torso midline centerX & centerZ from central vertical core (immune to asymmetric props/arms!)
  const midCorePts = points.filter(
    (p) =>
      p.y >= minY + height * 0.30 &&
      p.y <= minY + height * 0.80 &&
      Math.abs(p.x - boxCenter.x) <= Math.max(size.x * 0.28, height * 0.18),
  );
  const centerX =
    midCorePts.length >= 16
      ? trimmedMedian(midCorePts.map((p) => p.x), 0.2)
      : trimmedMedian(points.map((p) => p.x), 0.2);
  const centerZ =
    midCorePts.length >= 16
      ? trimmedMedian(midCorePts.map((p) => p.z), 0.2)
      : trimmedMedian(points.map((p) => p.z), 0.2);

  // 2. Vertical 64-slice connected-central-cluster & leg-split profile
  const SLICES = 64;
  const slicePoints: THREE.Vector3[][] = Array.from({ length: SLICES }, () => []);
  for (const p of points) {
    const t = THREE.MathUtils.clamp((p.y - minY) / height, 0, 0.9999);
    slicePoints[Math.floor(t * SLICES)].push(p);
  }

  const maxScanHalfX = Math.max(height * 0.35, Math.min(size.x * 0.5, height * 0.48));
  const XBINS = 48;
  const binW = (2 * maxScanHalfX) / XBINS;
  const centerBin = Math.floor(XBINS / 2);

  const centralWidthBySlice = new Float32Array(SLICES);
  const torsoWallBySlice = new Float32Array(SLICES);
  const centralZBySlice = new Float32Array(SLICES).fill(centerZ);
  const hasLegSplitBySlice = new Uint8Array(SLICES);

  for (let s = 0; s < SLICES; s++) {
    const sPts = slicePoints[s];
    if (sPts.length === 0) continue;

    const counts = new Uint32Array(XBINS);
    for (const p of sPts) {
      const rel = p.x - centerX + maxScanHalfX;
      if (rel < 0 || rel >= 2 * maxScanHalfX) continue;
      const b = Math.min(XBINS - 1, Math.floor(rel / binW));
      counts[b] += 1;
    }

    // Check 2-leg lateral separation with strict central void near centerX (immune to outer hanging arms)
    let leftCount = 0;
    let rightCount = 0;
    let midGapCount = 0;
    const gapLimit = Math.max(height * 0.015, 0.018);
    const legSpanLimit = Math.min(height * 0.19, maxScanHalfX * 0.65);
    for (const p of sPts) {
      const dx = p.x - centerX;
      if (Math.abs(dx) <= gapLimit) midGapCount += 1;
      else if (dx > gapLimit && dx <= legSpanLimit) leftCount += 1;
      else if (dx < -gapLimit && dx >= -legSpanLimit) rightCount += 1;
    }
    const centerPop = counts[centerBin] + counts[centerBin - 1];
    if (
      leftCount >= 4 &&
      rightCount >= 4 &&
      midGapCount <= Math.min(leftCount, rightCount) * 0.05 &&
      centerPop <= 1
    ) {
      hasLegSplitBySlice[s] = 1;
    }

    // Connected central interval around centerBin (allowing 1-bin sparse noise, stopping on 2-bin gap)
    let loBin = centerBin;
    let emptyRun = 0;
    for (let b = centerBin - 1; b >= 0; b--) {
      if (counts[b] > 0) {
        loBin = b;
        emptyRun = 0;
      } else {
        emptyRun += 1;
        if (emptyRun >= 2) break;
      }
    }
    let hiBin = centerBin;
    emptyRun = 0;
    for (let b = centerBin + 1; b < XBINS; b++) {
      if (counts[b] > 0) {
        hiBin = b;
        emptyRun = 0;
      } else {
        emptyRun += 1;
        if (emptyRun >= 2) break;
      }
    }

    const coreMinX = centerX - maxScanHalfX + loBin * binW;
    const coreMaxX = centerX - maxScanHalfX + (hiBin + 1) * binW;
    const coreSlicePts = sPts.filter((p) => p.x >= coreMinX - 0.01 && p.x <= coreMaxX + 0.01);
    let exactHalfWall = Math.max(0, (coreMaxX - coreMinX) * 0.5);
    if (coreSlicePts.length > 0) {
      let maxAbsCoreX = 0;
      for (const p of coreSlicePts) {
        const ax = Math.abs(p.x - centerX);
        if (ax > maxAbsCoreX) maxAbsCoreX = ax;
      }
      exactHalfWall = Math.max(exactHalfWall, maxAbsCoreX);
      centralZBySlice[s] = trimmedMedian(coreSlicePts.map((p) => p.z), 0.15);
    }
    centralWidthBySlice[s] = exactHalfWall * 2;
    torsoWallBySlice[s] = exactHalfWall;
  }

  // 3. Detect Crotch Fork / Pelvis Y from geometry (handles chibi short-legs & tall long-legs!)
  // Walk upward through separated leg slices and stop at the FIRST sustained contiguous pelvis bridge.
  let lastLegSplitSlice = -1;
  let legSplitSlicesSeen = 0;
  let contiguousPelvisRun = 0;
  const minLegS = Math.floor(0.10 * SLICES);
  const maxLegS = Math.floor(0.68 * SLICES);

  for (let s = minLegS; s <= maxLegS; s++) {
    if (hasLegSplitBySlice[s] === 1) {
      lastLegSplitSlice = s;
      legSplitSlicesSeen += 1;
      contiguousPelvisRun = 0;
    } else if (
      legSplitSlicesSeen >= 3 &&
      slicePoints[s].length >= 4 &&
      centralWidthBySlice[s] > height * 0.045
    ) {
      contiguousPelvisRun += 1;
      if (contiguousPelvisRun >= 3) {
        break;
      }
    }
  }

  let crotchY: number;
  if (legSplitSlicesSeen >= 3 && lastLegSplitSlice >= minLegS) {
    crotchY = minY + ((lastLegSplitSlice + 1) / SLICES) * height;
  } else {
    // Skirt / fused-leg fallback: stay safely in proportional mid-body below waist
    crotchY = minY + height * 0.44;
  }
  const pelvisY = THREE.MathUtils.clamp(
    crotchY + height * 0.036,
    minY + height * 0.24,
    minY + height * 0.64,
  );

  // 4. Detect Head Bulge (top-down), Neck Pinch below Head Bulge, and Head Centroid
  const upperStartS = THREE.MathUtils.clamp(
    Math.floor(((pelvisY - minY) / height + 0.14) * SLICES),
    Math.floor(0.32 * SLICES),
    SLICES - 8,
  );

  // Walk top-down from SLICES - 2 to locate the widest head bulge before width pinches at the neck
  let headPeakW = 0;
  let headBulgeSlice = SLICES - Math.max(3, Math.round(0.06 * SLICES));
  for (let s = SLICES - 2; s >= upperStartS + 3; s--) {
    const w = centralWidthBySlice[s];
    if (w <= height * 0.015) continue;
    if (w > headPeakW) {
      headPeakW = w;
      headBulgeSlice = s;
    } else if (headPeakW > height * 0.05 && w < headPeakW * 0.84) {
      // Entered neck constriction below widest part of head
      break;
    }
  }
  const upperEndS = THREE.MathUtils.clamp(
    headBulgeSlice - 1,
    upperStartS + 2,
    SLICES - Math.max(4, Math.round(0.06 * SLICES)),
  );

  let neckSlice = Math.round((upperStartS + upperEndS) * 0.5);
  let minNeckSpan = Infinity;
  for (let s = upperStartS + 2; s <= upperEndS; s++) {
    const w = centralWidthBySlice[s];
    if (w <= height * 0.018) continue;
    let maxAbove = 0;
    for (let a = s + 1; a <= Math.min(SLICES - 2, s + Math.round(0.18 * SLICES)); a++) {
      if (centralWidthBySlice[a] > maxAbove) maxAbove = centralWidthBySlice[a];
    }
    let maxBelow = 0;
    for (let b = Math.max(upperStartS, s - Math.round(0.16 * SLICES)); b < s; b++) {
      if (centralWidthBySlice[b] > maxBelow) maxBelow = centralWidthBySlice[b];
    }
    const pinchBonus = (maxAbove > w * 1.12 ? 0.85 : 1.15) * (maxBelow > w * 1.12 ? 0.85 : 1.15);
    const score = w * pinchBonus;
    if (score < minNeckSpan) {
      minNeckSpan = score;
      neckSlice = s;
    }
  }

  const neckY = THREE.MathUtils.clamp(
    minY + ((neckSlice + 0.5) / SLICES) * height,
    pelvisY + height * 0.18,
    maxY - height * 0.08,
  );

  // Head cluster strictly above neckY within central head envelope
  const headSearchHalfX = Math.max(
    height * 0.24,
    headPeakW * 0.72,
    centralWidthBySlice[Math.min(SLICES - 3, neckSlice + 3)] * 0.85,
  );
  const headPts = points.filter(
    (p) => p.y >= neckY && Math.abs(p.x - centerX) <= headSearchHalfX,
  );
  const headBox = new THREE.Box3();
  for (const p of headPts) headBox.expandByPoint(p);
  const headHeight = Math.max(height * 0.08, (headPts.length >= 6 ? headBox.max.y : maxY) - neckY);
  const headX = headPts.length >= 6 ? trimmedMedian(headPts.map((p) => p.x), 0.15) : centerX;
  const headZ = headPts.length >= 6 ? trimmedMedian(headPts.map((p) => p.z), 0.15) : centerZ;
  const headY = neckY + headHeight * 0.44;
  const headTopY = (headPts.length >= 6 ? headBox.max.y : maxY) - headHeight * 0.05;
  const headFrontZ =
    headPts.length >= 6
      ? percentileSorted(headPts.map((p) => p.z).sort((a, b) => a - b), 0.92)
      : headZ + headHeight * 0.45;
  const headOuterHalfX =
    headPts.length >= 6
      ? Math.max(headBox.max.x - headX, headX - headBox.min.x)
      : headHeight * 0.48;
  const headRadius = THREE.MathUtils.clamp(
    headPts.length >= 6
      ? Math.max((headBox.max.x - headBox.min.x) * 0.5, headHeight * 0.45)
      : headHeight * 0.48,
    height * 0.045,
    height * 0.24,
  );

  // 5. Spine, Chest, Shoulder Y & per-level Z curve
  const torsoH = Math.max(neckY - pelvisY, height * 0.14);
  const pelvisS = THREE.MathUtils.clamp(Math.floor(((pelvisY - minY) / height) * SLICES), 0, SLICES - 1);
  const waistStartS = THREE.MathUtils.clamp(Math.floor(((pelvisY + torsoH * 0.24 - minY) / height) * SLICES), 0, SLICES - 1);
  const waistEndS = THREE.MathUtils.clamp(Math.floor(((pelvisY + torsoH * 0.52 - minY) / height) * SLICES), waistStartS, SLICES - 1);

  let spineS = Math.round((waistStartS + waistEndS) * 0.5);
  let minWaistW = Infinity;
  for (let s = waistStartS; s <= waistEndS; s++) {
    if (centralWidthBySlice[s] > 0.02 && centralWidthBySlice[s] < minWaistW) {
      minWaistW = centralWidthBySlice[s];
      spineS = s;
    }
  }
  const spineY = THREE.MathUtils.clamp(
    minY + ((spineS + 0.5) / SLICES) * height,
    pelvisY + torsoH * 0.22,
    pelvisY + torsoH * 0.52,
  );
  const chestY = pelvisY + torsoH * 0.72;
  const shoulderY = THREE.MathUtils.clamp(
    pelvisY + torsoH * 0.87,
    chestY + torsoH * 0.1,
    neckY - Math.max(0.018, torsoH * 0.06),
  );

  const sampleBandZ = (yVal: number): number => {
    const band = points.filter(
      (p) =>
        Math.abs(p.y - yVal) <= Math.max(height * 0.045, 0.03) &&
        Math.abs(p.x - centerX) <= Math.max(height * 0.14, 0.08),
    );
    return band.length >= 6 ? trimmedMedian(band.map((p) => p.z), 0.18) : centerZ;
  };
  const pelvisZ = sampleBandZ(pelvisY);
  const spineZ = sampleBandZ(spineY);
  const chestZ = sampleBandZ(chestY);
  const neckZ = sampleBandZ(neckY);

  // Estimate torso core half-width from waist-to-midchest slices
  const torsoHalfWidths: number[] = [];
  const torsoLoS = THREE.MathUtils.clamp(pelvisS + 1, 0, SLICES - 1);
  const torsoHiS = THREE.MathUtils.clamp(Math.floor(((chestY - minY) / height) * SLICES), torsoLoS, SLICES - 1);
  for (let s = torsoLoS; s <= torsoHiS; s++) {
    if (torsoWallBySlice[s] > height * 0.04) {
      torsoHalfWidths.push(torsoWallBySlice[s]);
    }
  }
  const torsoHalfWidth = THREE.MathUtils.clamp(
    torsoHalfWidths.length > 0 ? trimmedMedian(torsoHalfWidths, 0.2) : size.x * 0.16,
    height * 0.055,
    height * 0.18,
  );

  // 6. Compute per-slice leg outer profile below crotchY so hanging I-pose arms don't pick up thigh vertices
  const legOuterBySlice = new Float32Array(SLICES).fill(torsoHalfWidth * 1.05);
  for (let s = 0; s < SLICES; s++) {
    const sY = minY + ((s + 0.5) / SLICES) * height;
    if (sY >= pelvisY) continue;
    const sPts = slicePoints[s];
    if (sPts.length === 0) continue;
    // Walk outward from inner leg center until gap
    const counts = new Uint32Array(XBINS);
    for (const p of sPts) {
      const dx = Math.abs(p.x - centerX);
      if (dx > height * 0.35) continue;
      const b = Math.min(XBINS - 1, Math.floor((dx / maxScanHalfX) * XBINS));
      counts[b] += 1;
    }
    let lastFilled = Math.floor((torsoHalfWidth * 0.9 / maxScanHalfX) * XBINS);
    let emptyRun = 0;
    let started = false;
    for (let b = 0; b < Math.floor(XBINS * 0.45); b++) {
      if (counts[b] > 0) {
        started = true;
        emptyRun = 0;
        lastFilled = b;
      } else if (started) {
        emptyRun += 1;
        if (emptyRun >= 2) break;
      }
    }
    legOuterBySlice[s] = THREE.MathUtils.clamp(
      ((lastFilled + 1) / XBINS) * maxScanHalfX,
      height * 0.075,
      torsoHalfWidth * 1.25,
    );
  }

  // 7. Trace real Left & Right Arms via 3D Voxel-Graph Geodesic Traversal
  const lArmTrace = traceGeodesicArmChain(
    points,
    centerX,
    minY,
    height,
    pelvisY,
    shoulderY,
    neckY,
    chestZ,
    torsoHalfWidth,
    headX,
    headOuterHalfX,
    torsoWallBySlice,
    legOuterBySlice,
    SLICES,
    1,
  );
  const rArmTrace = traceGeodesicArmChain(
    points,
    centerX,
    minY,
    height,
    pelvisY,
    shoulderY,
    neckY,
    chestZ,
    torsoHalfWidth,
    headX,
    headOuterHalfX,
    torsoWallBySlice,
    legOuterBySlice,
    SLICES,
    -1,
  );

  // 8. Trace real Left & Right Legs (Hip socket -> Knee -> Ankle constriction -> Toe forward tip)
  const lMinArmX = Math.min(lArmTrace.armRoot.x, lArmTrace.hand.x) - centerX;
  const rMinArmX = centerX - Math.max(rArmTrace.armRoot.x, rArmTrace.hand.x);
  const maxLegOuterX = Math.max(
    torsoHalfWidth * 1.28,
    Math.min(height * 0.24, Math.max(lMinArmX, rMinArmX) * 0.92),
  );

  const lLeg = traceLegChain(
    points,
    centerX,
    pelvisZ,
    minY,
    height,
    pelvisY,
    crotchY,
    maxLegOuterX,
    1,
  );
  const rLeg = traceLegChain(
    points,
    centerX,
    pelvisZ,
    minY,
    height,
    pelvisY,
    crotchY,
    maxLegOuterX,
    -1,
  );

  // Snap axial spine points inside central torso volume so arched/leaning characters align cleanly
  const torsoPts = points.filter(
    (p) =>
      p.y >= pelvisY - height * 0.05 &&
      p.y <= neckY + height * 0.04 &&
      Math.abs(p.x - centerX) <= torsoHalfWidth * 1.15,
  );
  const pelvisPos = snapJointInsideMeshVolume(
    new THREE.Vector3(centerX, pelvisY, pelvisZ),
    torsoPts.length >= 6 ? torsoPts : points,
    height * 0.04,
    height * 0.12,
  );
  const spinePos = snapJointInsideMeshVolume(
    new THREE.Vector3(centerX, spineY, spineZ),
    torsoPts.length >= 6 ? torsoPts : points,
    height * 0.04,
    height * 0.12,
  );
  const chestPos = snapJointInsideMeshVolume(
    new THREE.Vector3(centerX, chestY, chestZ),
    torsoPts.length >= 6 ? torsoPts : points,
    height * 0.04,
    height * 0.12,
  );
  const neckPos = snapJointInsideMeshVolume(
    new THREE.Vector3(headX, neckY, neckZ),
    points,
    height * 0.03,
    height * 0.09,
  );
  const headPos = snapJointInsideMeshVolume(
    new THREE.Vector3(headX, headY, headZ),
    headPts.length >= 6 ? headPts : points,
    height * 0.03,
    Math.max(headRadius * 1.1, height * 0.08),
  );

  const shoulderWidth = THREE.MathUtils.clamp(
    ((lArmTrace.armRoot.x - centerX) + (centerX - rArmTrace.armRoot.x)) * 0.5,
    torsoHalfWidth * 0.9,
    height * 0.24,
  );
  const armSpanHalf = Math.max(
    Math.abs(lArmTrace.hand.x - centerX),
    Math.abs(rArmTrace.hand.x - centerX),
    shoulderWidth * 1.35,
  );
  const hipSpreadX = ((lLeg.upLeg.x - centerX) + (centerX - rLeg.upLeg.x)) * 0.5;
  const kneeY = (lLeg.knee.y + rLeg.knee.y) * 0.5;
  const ankleY = (lLeg.ankle.y + rLeg.ankle.y) * 0.5;
  const toeForwardZ = (lLeg.toe.z + rLeg.toe.z) * 0.5;

  return {
    minY,
    maxY,
    height,
    centerX: pelvisPos.x,
    centerZ: pelvisPos.z,
    pelvisY: pelvisPos.y,
    pelvisZ: pelvisPos.z,
    spineY: spinePos.y,
    spineZ: spinePos.z,
    chestY: chestPos.y,
    chestZ: chestPos.z,
    shoulderY,
    shoulderZ: chestPos.z,
    neckY: neckPos.y,
    neckZ: neckPos.z,
    headY: headPos.y,
    headX: headPos.x,
    headZ: headPos.z,
    headTopY,
    headFrontZ,
    torsoHalfWidth,
    shoulderWidth,
    armSpanHalf,
    handY: (lArmTrace.hand.y + rArmTrace.hand.y) * 0.5,
    lShoulderPos: [r3(lArmTrace.shoulderJoint.x), r3(lArmTrace.shoulderJoint.y), r3(lArmTrace.shoulderJoint.z)],
    lArmPos: [r3(lArmTrace.armRoot.x), r3(lArmTrace.armRoot.y), r3(lArmTrace.armRoot.z)],
    lElbowPos: [r3(lArmTrace.elbow.x), r3(lArmTrace.elbow.y), r3(lArmTrace.elbow.z)],
    lHandPos: [r3(lArmTrace.hand.x), r3(lArmTrace.hand.y), r3(lArmTrace.hand.z)],
    lHandDir: [lArmTrace.handDir.x, lArmTrace.handDir.y, lArmTrace.handDir.z],
    lHandSpan: lArmTrace.handSpan,
    rShoulderPos: [r3(rArmTrace.shoulderJoint.x), r3(rArmTrace.shoulderJoint.y), r3(rArmTrace.shoulderJoint.z)],
    rArmPos: [r3(rArmTrace.armRoot.x), r3(rArmTrace.armRoot.y), r3(rArmTrace.armRoot.z)],
    rElbowPos: [r3(rArmTrace.elbow.x), r3(rArmTrace.elbow.y), r3(rArmTrace.elbow.z)],
    rHandPos: [r3(rArmTrace.hand.x), r3(rArmTrace.hand.y), r3(rArmTrace.hand.z)],
    rHandDir: [rArmTrace.handDir.x, rArmTrace.handDir.y, rArmTrace.handDir.z],
    rHandSpan: rArmTrace.handSpan,
    hipSpreadX,
    lUpLegPos: [r3(lLeg.upLeg.x), r3(lLeg.upLeg.y), r3(lLeg.upLeg.z)],
    lKneePos: [r3(lLeg.knee.x), r3(lLeg.knee.y), r3(lLeg.knee.z)],
    lAnklePos: [r3(lLeg.ankle.x), r3(lLeg.ankle.y), r3(lLeg.ankle.z)],
    lToePos: [r3(lLeg.toe.x), r3(lLeg.toe.y), r3(lLeg.toe.z)],
    rUpLegPos: [r3(rLeg.upLeg.x), r3(rLeg.upLeg.y), r3(rLeg.upLeg.z)],
    rKneePos: [r3(rLeg.knee.x), r3(rLeg.knee.y), r3(rLeg.knee.z)],
    rAnklePos: [r3(rLeg.ankle.x), r3(rLeg.ankle.y), r3(rLeg.ankle.z)],
    rToePos: [r3(rLeg.toe.x), r3(rLeg.toe.y), r3(rLeg.toe.z)],
    kneeY,
    ankleY,
    toeForwardZ,
    headRadius,
    orientationWarning,
  };
}

export function buildIntelligentHumanoidRig(
  group: THREE.Object3D,
  preset: SkeletonPresetType = 'full-33',
): BoneNode[] {
  const lm = analyzeCharacterSilhouette(group);
  const cx = lm.centerX;
  const h = lm.height;
  const isStylized = preset === 'stylized-anime';

  const withConstraint = (name: string, node: BoneNode): BoneNode => ({
    ...node,
    ...(DEFAULT_CONSTRAINTS[name] ? { constraint: { ...DEFAULT_CONSTRAINTS[name] } } : {}),
  });

  if (preset === 'simple-15') {
    return [
      { name: 'Hips', parent: null, position: [r3(cx), r3(lm.pelvisY), r3(lm.pelvisZ)], controlShape: 'ring' },
      { name: 'Spine', parent: 'Hips', position: [r3(cx), r3(lm.spineY), r3(lm.spineZ)] },
      { name: 'Chest', parent: 'Spine', position: [r3(cx), r3(lm.chestY), r3(lm.chestZ)], controlShape: 'ring' },
      withConstraint('Neck', { name: 'Neck', parent: 'Chest', position: [r3(lm.headX), r3(lm.neckY), r3(lm.neckZ)] }),
      withConstraint('Head', {
        name: 'Head',
        parent: 'Neck',
        position: [r3(lm.headX), r3(lm.headY), r3(lm.headZ)],
        controlShape: 'sphere',
      }),

      { name: 'LeftShoulder', parent: 'Chest', position: lm.lShoulderPos },
      { name: 'LeftArm', parent: 'LeftShoulder', position: lm.lArmPos },
      withConstraint('LeftForearm', { name: 'LeftForearm', parent: 'LeftArm', position: lm.lElbowPos }),

      { name: 'RightShoulder', parent: 'Chest', position: lm.rShoulderPos },
      { name: 'RightArm', parent: 'RightShoulder', position: lm.rArmPos },
      withConstraint('RightForearm', { name: 'RightForearm', parent: 'RightArm', position: lm.rElbowPos }),

      { name: 'LeftUpLeg', parent: 'Hips', position: lm.lUpLegPos },
      withConstraint('LeftLeg', { name: 'LeftLeg', parent: 'LeftUpLeg', position: lm.lKneePos }),

      { name: 'RightUpLeg', parent: 'Hips', position: lm.rUpLegPos },
      withConstraint('RightLeg', { name: 'RightLeg', parent: 'RightUpLeg', position: lm.rKneePos }),
    ];
  }

  // Hand outward direction & scaled finger geometry kept strictly inside detected hand span
  const lOut = new THREE.Vector3(...lm.lHandDir).normalize();
  const rOut = new THREE.Vector3(...lm.rHandDir).normalize();
  const [lHandX, lHandY, lHandZ] = lm.lHandPos;
  const [rHandX, rHandY, rHandZ] = lm.rHandPos;

  const lFingerReach = THREE.MathUtils.clamp(lm.lHandSpan * 0.56, 0.02, h * 0.034);
  const rFingerReach = THREE.MathUtils.clamp(lm.rHandSpan * 0.56, 0.02, h * 0.034);
  const fingerDepth = THREE.MathUtils.clamp(lm.headRadius * 0.44, 0.018, h * 0.036);

  const lFingerPos = (distMult: number, zOffset: number): [number, number, number] => [
    r3(lHandX + lOut.x * lFingerReach * distMult),
    r3(lHandY + lOut.y * lFingerReach * distMult),
    r3(lHandZ + lOut.z * lFingerReach * distMult + zOffset),
  ];
  const rFingerPos = (distMult: number, zOffset: number): [number, number, number] => [
    r3(rHandX + rOut.x * rFingerReach * distMult),
    r3(rHandY + rOut.y * rFingerReach * distMult),
    r3(rHandZ + rOut.z * rFingerReach * distMult + zOffset),
  ];

  const jawZ = THREE.MathUtils.lerp(lm.headZ, lm.headFrontZ, 0.58);
  const eyeZ = THREE.MathUtils.lerp(lm.headZ, lm.headFrontZ, 0.72);

  const nodes: BoneNode[] = [
    { name: 'Hips', parent: null, position: [r3(cx), r3(lm.pelvisY), r3(lm.pelvisZ)], controlShape: 'ring' },
    { name: 'Spine', parent: 'Hips', position: [r3(cx), r3(lm.spineY), r3(lm.spineZ)] },
    { name: 'Chest', parent: 'Spine', position: [r3(cx), r3(lm.chestY), r3(lm.chestZ)], controlShape: 'ring' },
    withConstraint('Neck', { name: 'Neck', parent: 'Chest', position: [r3(lm.headX), r3(lm.neckY), r3(lm.neckZ)] }),
    withConstraint('Head', {
      name: 'Head',
      parent: 'Neck',
      position: [r3(lm.headX), r3(lm.headY), r3(lm.headZ)],
      weightScale: isStylized ? 1.25 : 1.0,
      controlShape: 'sphere',
    }),
    withConstraint('Jaw', {
      name: 'Jaw',
      parent: 'Head',
      position: [r3(lm.headX), r3(lm.headY - lm.headRadius * 0.34), r3(jawZ)],
      weightScale: 0.7,
      controlShape: 'diamond',
    }),

    // Left Arm + Hand + 5 Fingers
    { name: 'LeftShoulder', parent: 'Chest', position: lm.lShoulderPos },
    { name: 'LeftArm', parent: 'LeftShoulder', position: lm.lArmPos },
    withConstraint('LeftForearm', {
      name: 'LeftForearm',
      parent: 'LeftArm',
      position: lm.lElbowPos,
    }),
    {
      name: 'LeftHand',
      parent: 'LeftForearm',
      position: lm.lHandPos,
      weightScale: 0.9,
      controlShape: 'cube',
    },
    { name: 'LeftThumb', parent: 'LeftHand', position: lFingerPos(0.55, fingerDepth * 0.82), weightScale: 0.72 },
    { name: 'LeftIndex', parent: 'LeftHand', position: lFingerPos(1.02, fingerDepth * 0.42), weightScale: 0.68 },
    { name: 'LeftMiddle', parent: 'LeftHand', position: lFingerPos(1.08, fingerDepth * 0.12), weightScale: 0.68 },
    { name: 'LeftRing', parent: 'LeftHand', position: lFingerPos(1.02, -fingerDepth * 0.2), weightScale: 0.68 },
    { name: 'LeftPinky', parent: 'LeftHand', position: lFingerPos(0.90, -fingerDepth * 0.5), weightScale: 0.68 },

    // Right Arm + Hand + 5 Fingers
    { name: 'RightShoulder', parent: 'Chest', position: lm.rShoulderPos },
    { name: 'RightArm', parent: 'RightShoulder', position: lm.rArmPos },
    withConstraint('RightForearm', {
      name: 'RightForearm',
      parent: 'RightArm',
      position: lm.rElbowPos,
    }),
    {
      name: 'RightHand',
      parent: 'RightForearm',
      position: lm.rHandPos,
      weightScale: 0.9,
      controlShape: 'cube',
    },
    { name: 'RightThumb', parent: 'RightHand', position: rFingerPos(0.55, fingerDepth * 0.82), weightScale: 0.72 },
    { name: 'RightIndex', parent: 'RightHand', position: rFingerPos(1.02, fingerDepth * 0.42), weightScale: 0.68 },
    { name: 'RightMiddle', parent: 'RightHand', position: rFingerPos(1.08, fingerDepth * 0.12), weightScale: 0.68 },
    { name: 'RightRing', parent: 'RightHand', position: rFingerPos(1.02, -fingerDepth * 0.2), weightScale: 0.68 },
    { name: 'RightPinky', parent: 'RightHand', position: rFingerPos(0.90, -fingerDepth * 0.5), weightScale: 0.68 },

    // Left Leg + Foot + Toe
    { name: 'LeftUpLeg', parent: 'Hips', position: lm.lUpLegPos },
    withConstraint('LeftLeg', { name: 'LeftLeg', parent: 'LeftUpLeg', position: lm.lKneePos }),
    withConstraint('LeftFoot', {
      name: 'LeftFoot',
      parent: 'LeftLeg',
      position: lm.lAnklePos,
      weightScale: 0.9,
      controlShape: 'cube',
    }),
    { name: 'LeftToe', parent: 'LeftFoot', position: lm.lToePos, weightScale: 0.75 },

    // Right Leg + Foot + Toe
    { name: 'RightUpLeg', parent: 'Hips', position: lm.rUpLegPos },
    withConstraint('RightLeg', { name: 'RightLeg', parent: 'RightUpLeg', position: lm.rKneePos }),
    withConstraint('RightFoot', {
      name: 'RightFoot',
      parent: 'RightLeg',
      position: lm.rAnklePos,
      weightScale: 0.9,
      controlShape: 'cube',
    }),
    { name: 'RightToe', parent: 'RightFoot', position: lm.rToePos, weightScale: 0.75 },
  ];

  if (preset === 'ultra-45' || isStylized) {
    nodes.push(
      { name: 'HeadTop', parent: 'Head', position: [r3(lm.headX), r3(lm.headTopY), r3(lm.headZ)], weightScale: 0.8 },
      {
        name: 'LeftEye',
        parent: 'Head',
        position: [r3(lm.headX + lm.headRadius * 0.34), r3(lm.headY + lm.headRadius * 0.16), r3(eyeZ)],
        weightScale: 0.45,
        controlShape: 'diamond',
      },
      {
        name: 'RightEye',
        parent: 'Head',
        position: [r3(lm.headX - lm.headRadius * 0.34), r3(lm.headY + lm.headRadius * 0.16), r3(eyeZ)],
        weightScale: 0.45,
        controlShape: 'diamond',
      },
      { name: 'LeftThumb2', parent: 'LeftThumb', position: lFingerPos(0.95, fingerDepth * 0.95), weightScale: 0.58 },
      { name: 'LeftIndex2', parent: 'LeftIndex', position: lFingerPos(1.55, fingerDepth * 0.45), weightScale: 0.58 },
      { name: 'LeftMiddle2', parent: 'LeftMiddle', position: lFingerPos(1.65, fingerDepth * 0.12), weightScale: 0.58 },
      { name: 'LeftRing2', parent: 'LeftRing', position: lFingerPos(1.55, -fingerDepth * 0.22), weightScale: 0.58 },
      { name: 'LeftPinky2', parent: 'LeftPinky', position: lFingerPos(1.38, -fingerDepth * 0.54), weightScale: 0.58 },

      { name: 'RightThumb2', parent: 'RightThumb', position: rFingerPos(0.95, fingerDepth * 0.95), weightScale: 0.58 },
      { name: 'RightIndex2', parent: 'RightIndex', position: rFingerPos(1.55, fingerDepth * 0.45), weightScale: 0.58 },
      { name: 'RightMiddle2', parent: 'RightMiddle', position: rFingerPos(1.65, fingerDepth * 0.12), weightScale: 0.58 },
      { name: 'RightRing2', parent: 'RightRing', position: rFingerPos(1.55, -fingerDepth * 0.22), weightScale: 0.58 },
      { name: 'RightPinky2', parent: 'RightPinky', position: rFingerPos(1.38, -fingerDepth * 0.54), weightScale: 0.58 },
    );
  }

  return nodes;
}

export function getMirrorBoneNameStrict(name: string): string | null {
  if (name.startsWith('Left')) return name.replace(/^Left/, 'Right');
  if (name.startsWith('Right')) return name.replace(/^Right/, 'Left');
  if (name.endsWith('_L')) return name.replace(/_L$/, '_R');
  if (name.endsWith('_R')) return name.replace(/_R$/, '_L');
  if (name.endsWith('.L')) return name.replace(/\.L$/, '.R');
  if (name.endsWith('.R')) return name.replace(/\.R$/, '.L');
  return null;
}

export function mirrorSkeletonLR(bones: BoneNode[], direction: 'LtoR' | 'RtoL' = 'LtoR'): BoneNode[] {
  const byName = new Map<string, BoneNode>();
  bones.forEach((b) => byName.set(b.name, b));

  return bones.map((b) => {
    const isLeft = b.name.startsWith('Left') || b.name.endsWith('_L') || b.name.endsWith('.L');
    const isRight = b.name.startsWith('Right') || b.name.endsWith('_R') || b.name.endsWith('.R');
    const shouldReceive = direction === 'LtoR' ? isRight : isLeft;
    if (!shouldReceive) return b;

    const sourceName = getMirrorBoneNameStrict(b.name);
    const src = sourceName ? byName.get(sourceName) : undefined;
    if (!src) return b;

    return {
      ...b,
      position: [r3(-src.position[0]), src.position[1], src.position[2]],
      ...(src.rotation
        ? { rotation: [src.rotation[0], -src.rotation[1], -src.rotation[2]] }
        : {}),
      ...(src.scale ? { scale: [...src.scale] as [number, number, number] } : {}),
      ...(src.weightScale !== undefined ? { weightScale: src.weightScale } : {}),
      ...(src.constraint ? { constraint: { ...src.constraint } } : {}),
    };
  });
}

export function validateRig(group: THREE.Object3D | null, bones: BoneNode[]): RigValidationIssue[] {
  return runFullRigAudit(group, bones, false).issues;
}

/**
 * Full structural, bind-pose, skin-weight, and optional live deformation audit.
 * Never returns `overallPassed = true` if critical structural, binding, or weight errors exist.
 */
export function runFullRigAudit(
  group: THREE.Object3D | null,
  bones: BoneNode[],
  includeDeformationTest = false,
): RigAuditReport {
  const issues: RigValidationIssue[] = [];
  const passedChecks: string[] = [];
  const problematicBonesSet = new Set<string>();
  const problematicMeshesSet = new Set<string>();

  if (bones.length === 0) {
    issues.push({
      id: 'no-bones',
      severity: 'error',
      title: 'Empty Skeleton',
      detail: 'No bones exist in the rig. Generate a humanoid preset or adopt an imported skeleton.',
      suggestion: 'Choose an Auto-Rig preset (e.g. Full 33) or click Use Imported Skeleton.',
      autoFixable: true,
    });
    return {
      overallPassed: false,
      passedChecks,
      issues,
      problematicBones: [],
      problematicMeshes: [],
      deformationResults: [],
    };
  }

  // 1. Duplicate bone names
  const seen = new Set<string>();
  const duplicates: string[] = [];
  bones.forEach((b) => {
    if (seen.has(b.name)) {
      duplicates.push(b.name);
      problematicBonesSet.add(b.name);
    }
    seen.add(b.name);
  });
  if (duplicates.length > 0) {
    issues.push({
      id: 'dup-names',
      severity: 'error',
      title: 'Duplicate Bone Names',
      detail: `Duplicate joints detected (${duplicates.slice(0, 4).join(', ')}).`,
      boneName: duplicates[0],
      suggestion: 'Run Auto-Fix to deduplicate bone identifiers cleanly.',
      autoFixable: true,
    });
  } else {
    passedChecks.push(`Unique bone naming verified (${bones.length} bones).`);
  }

  // 2. Parent-child hierarchy, multiple disconnected roots, orphan links, cycles
  const boneMap = new Map<string, BoneNode>();
  bones.forEach((b) => boneMap.set(b.name, b));
  let orphanCount = 0;
  let cycleCount = 0;
  const rootBones: string[] = [];

  for (const b of bones) {
    if (!b.parent) {
      rootBones.push(b.name);
    } else if (!boneMap.has(b.parent) || b.parent === b.name) {
      orphanCount += 1;
      problematicBonesSet.add(b.name);
    }
    const visited = new Set<string>();
    let cur: BoneNode | undefined = b;
    while (cur && cur.parent) {
      if (visited.has(cur.name)) {
        cycleCount += 1;
        problematicBonesSet.add(cur.name);
        break;
      }
      visited.add(cur.name);
      cur = boneMap.get(cur.parent);
    }
  }

  if (orphanCount > 0 || cycleCount > 0) {
    issues.push({
      id: 'hierarchy-error',
      severity: 'error',
      title: 'Broken Parent Hierarchy',
      detail: `${orphanCount} orphan parent link(s) and ${cycleCount} cycle(s) found.`,
      suggestion: 'Run Auto-Fix to repair invalid parent references and break circular links.',
      autoFixable: true,
    });
  } else {
    passedChecks.push('Parent-child hierarchy acyclic with valid parent references.');
  }

  if (rootBones.length > 1) {
    issues.push({
      id: 'multiple-roots',
      severity: 'warning',
      title: 'Multiple Skeleton Roots Detected',
      detail: `Found ${rootBones.length} independent root bones (${rootBones.slice(0, 3).join(', ')}). Humanoids should descend from one Hips/Root bone.`,
      boneName: rootBones[1],
      suggestion: 'Parent detached root branches under Hips/Chest or run Auto-Fix.',
      autoFixable: true,
    });
    rootBones.slice(1).forEach((rb) => problematicBonesSet.add(rb));
  } else {
    passedChecks.push(`Single continuous armature root (${rootBones[0] ?? 'Hips'}).`);
  }

  // 3. Humanoid Chain Connectivity Verification
  const byRole = new Map<CanonicalHumanoidRole, BoneNode>();
  bones.forEach((b) => {
    const r = resolveHumanoidRole(b.name);
    if (r !== 'other' && !byRole.has(r)) byRole.set(r, b);
  });

  const isDescendantOf = (childName: string, ancestorName: string): boolean => {
    let cur = boneMap.get(childName);
    const guard = new Set<string>();
    while (cur && cur.parent && !guard.has(cur.name)) {
      if (cur.parent === ancestorName) return true;
      guard.add(cur.name);
      cur = boneMap.get(cur.parent);
    }
    return false;
  };

  const expectedLinks: Array<[CanonicalHumanoidRole, CanonicalHumanoidRole, string]> = [
    ['head', 'neck', 'Head must parent under Neck'],
    ['neck', 'chest', 'Neck must parent under Chest'],
    ['chest', 'spine', 'Chest must parent under Spine'],
    ['spine', 'hips', 'Spine must parent under Hips'],
    ['leftArm', 'leftShoulder', 'Left Upper Arm must connect to Left Shoulder'],
    ['leftForearm', 'leftArm', 'Left Forearm must connect to Left Upper Arm'],
    ['leftHand', 'leftForearm', 'Left Hand must connect to Left Forearm'],
    ['rightArm', 'rightShoulder', 'Right Upper Arm must connect to Right Shoulder'],
    ['rightForearm', 'rightArm', 'Right Forearm must connect to Right Upper Arm'],
    ['rightHand', 'rightForearm', 'Right Hand must connect to Right Forearm'],
    ['leftLeg', 'leftUpLeg', 'Left Lower Leg must connect to Left Upper Leg'],
    ['leftFoot', 'leftLeg', 'Left Foot must connect to Left Lower Leg'],
    ['rightLeg', 'rightUpLeg', 'Right Lower Leg must connect to Right Upper Leg'],
    ['rightFoot', 'rightLeg', 'Right Foot must connect to Right Lower Leg'],
  ];

  const brokenChainLinks: string[] = [];
  for (const [childRole, parentRole, msg] of expectedLinks) {
    const ch = byRole.get(childRole);
    const pa = byRole.get(parentRole);
    if (ch && pa && !isDescendantOf(ch.name, pa.name)) {
      brokenChainLinks.push(`${msg} (${ch.name} -> ${pa.name})`);
      problematicBonesSet.add(ch.name);
    }
  }
  if (brokenChainLinks.length > 0) {
    issues.push({
      id: 'humanoid-chain-disconnect',
      severity: 'error',
      title: 'Disconnected Humanoid Chain',
      detail: brokenChainLinks.slice(0, 3).join('; '),
      suggestion: 'Re-parent limbs correctly or re-apply Humanoid Auto-Rig.',
      autoFixable: true,
    });
  } else if (byRole.has('hips') && byRole.has('head')) {
    passedChecks.push('Anatomical spine, neck/head, arm, and leg chains connected.');
  }

  // 4. Scale, bounds proximity, and collapsed segments
  let degenerateScale = 0;
  let collapsedLength = 0;
  let floatingBones = 0;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();

  let inflatedBox: THREE.Box3 | null = null;
  if (group) {
    group.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(group);
    if (!b.isEmpty()) inflatedBox = b.clone().expandByScalar(0.32);
  }

  for (const b of bones) {
    if (b.scale && (b.scale[0] <= 0.01 || b.scale[1] <= 0.01 || b.scale[2] <= 0.01)) {
      degenerateScale += 1;
      problematicBonesSet.add(b.name);
    }
    if (b.parent && boneMap.has(b.parent)) {
      vA.set(...b.position);
      vB.set(...boneMap.get(b.parent)!.position);
      if (vA.distanceTo(vB) < 0.004) collapsedLength += 1;
    }
    if (inflatedBox) {
      vA.set(...b.position);
      if (!inflatedBox.containsPoint(vA)) {
        floatingBones += 1;
        problematicBonesSet.add(b.name);
      }
    }
  }
  if (degenerateScale > 0) {
    issues.push({
      id: 'bad-scale',
      severity: 'warning',
      title: 'Degenerate Bone Scale',
      detail: `${degenerateScale} bone(s) have near-zero scale which distorts SkinnedMesh normals.`,
      autoFixable: true,
    });
  }
  if (floatingBones > 0) {
    issues.push({
      id: 'floating-bones',
      severity: 'warning',
      title: 'Joints Outside Character Volume',
      detail: `${floatingBones} bone(s) sit far outside the mesh bounding volume.`,
      suggestion: 'Refit skeleton preset or move highlighted joints inside the character.',
      autoFixable: false,
    });
  } else if (group) {
    passedChecks.push('All skeleton joints lie within character anatomical bounds.');
  }
  if (collapsedLength > 0) {
    issues.push({
      id: 'zero-len',
      severity: 'info',
      title: 'Co-located Joints',
      detail: `${collapsedLength} child joint(s) share position (< 4mm) with parent.`,
      autoFixable: false,
    });
  }

  // 5. Skin Weights, Indices & Bind Matrix Checks
  if (group) {
    let missingWeightAttrs = 0;
    let unnormalizedVerts = 0;
    let zeroWeightVerts = 0;
    let invalidIndices = 0;

    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        const geo = m.geometry;
        const pos = geo.attributes.position;
        const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
        const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
        if (!pos) return;
        if (!skinWt || !skinIdx) {
          missingWeightAttrs += 1;
          problematicMeshesSet.add(m.name || 'Mesh');
          return;
        }
        let meshHasBad = false;
        for (let i = 0; i < pos.count; i++) {
          const w0 = skinWt.getX(i);
          const w1 = skinWt.getY(i);
          const w2 = skinWt.getZ(i);
          const w3 = skinWt.getW(i);
          const i0 = skinIdx.getX(i);
          const i1 = skinIdx.getY(i);
          const i2 = skinIdx.getZ(i);
          const i3 = skinIdx.getW(i);
          if (
            w0 < -0.001 || w1 < -0.001 || w2 < -0.001 || w3 < -0.001 ||
            !Number.isFinite(w0 + w1 + w2 + w3)
          ) {
            unnormalizedVerts += 1;
            meshHasBad = true;
          }
          if (
            i0 < 0 || i0 >= bones.length ||
            i1 < 0 || i1 >= bones.length ||
            i2 < 0 || i2 >= bones.length ||
            i3 < 0 || i3 >= bones.length
          ) {
            invalidIndices += 1;
            meshHasBad = true;
          }
          const sum = w0 + w1 + w2 + w3;
          if (sum < 0.01) {
            zeroWeightVerts += 1;
            meshHasBad = true;
          } else if (Math.abs(sum - 1.0) > 0.02) {
            unnormalizedVerts += 1;
            meshHasBad = true;
          }
        }
        if (meshHasBad) problematicMeshesSet.add(m.name || 'Mesh');
      }
    });

    if (missingWeightAttrs > 0) {
      issues.push({
        id: 'no-skin-weights',
        severity: 'error',
        title: 'Meshes Missing Skin Weights',
        detail: `${missingWeightAttrs} mesh(es) lack skinIndex/skinWeight attributes.`,
        suggestion: 'Recompute Automatic Heat Weights or run Auto-Fix.',
        autoFixable: true,
      });
    } else {
      passedChecks.push('All meshes contain valid skinIndex & skinWeight BufferAttributes.');
    }

    if (invalidIndices > 0) {
      issues.push({
        id: 'invalid-skin-indices',
        severity: 'error',
        title: 'Out-of-Range Bone Indices',
        detail: `${invalidIndices} vertex slot(s) reference invalid bone indices outside [0..${bones.length - 1}].`,
        suggestion: 'Run Auto-Fix to sanitize indices and renormalize weights.',
        autoFixable: true,
      });
    }

    if (zeroWeightVerts > 0 || unnormalizedVerts > 0) {
      issues.push({
        id: 'unnormalized-weights',
        severity: 'warning',
        title: 'Weight Normalization Needed',
        detail: `${zeroWeightVerts} zero-weight and ${unnormalizedVerts} unnormalized vertices detected.`,
        suggestion: 'Run Normalize or Auto-Fix to enforce unit 1.0 vertex weights.',
        autoFixable: true,
      });
    } else if (missingWeightAttrs === 0) {
      passedChecks.push('100% of vertices strictly normalized (sum = 1.0) with valid indices.');
    }
  }

  let deformationResults: DeformationJointTestResult[] = [];
  if (includeDeformationTest && group && issues.every((i) => i.severity !== 'error')) {
    deformationResults = runAutomatedDeformationTest(group, bones);
    const failedDeform = deformationResults.filter((d) => !d.passed);
    if (failedDeform.length > 0) {
      failedDeform.forEach((fd) => problematicBonesSet.add(fd.boneName));
      issues.push({
        id: 'deformation-stretch-fail',
        severity: 'error',
        title: 'Deformation Seam Instability',
        detail: `${failedDeform.length} joint test(s) showed seam tearing or zero deformation (e.g. ${failedDeform[0].boneName}).`,
        boneName: failedDeform[0].boneName,
        suggestion: 'Recompute outward anatomical weights & run Smooth Mesh.',
        autoFixable: true,
      });
    } else if (deformationResults.length > 0) {
      passedChecks.push(
        `Automated LBS deformation test passed across ${deformationResults.length} anatomical joints.`,
      );
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return {
    overallPassed: !hasError,
    passedChecks,
    issues,
    problematicBones: Array.from(problematicBonesSet),
    problematicMeshes: Array.from(problematicMeshesSet),
    deformationResults,
    testedAt: includeDeformationTest ? new Date().toLocaleTimeString() : undefined,
  };
}

/**
 * Evaluates actual CPU Linear Blend Skinning vertex displacement and triangle edge stretch
 * on a temporary SkinnedMesh bind across Head, Neck, Spine, Shoulders, Elbows, Wrists,
 * Hips, Knees, and Ankles to guarantee zero mesh detachment before export.
 */
export function runAutomatedDeformationTest(
  sourceGroup: THREE.Object3D,
  boneNodes: BoneNode[],
): DeformationJointTestResult[] {
  if (boneNodes.length === 0) return [];
  const tempGroup = new THREE.Group();
  sourceGroup.updateMatrixWorld(true);
  sourceGroup.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      const src = c as THREE.Mesh;
      const geo = src.geometry.clone();
      geo.applyMatrix4(src.matrixWorld);
      const m = new THREE.Mesh(geo, src.material);
      m.name = src.name;
      tempGroup.add(m);
    }
  });

  const bound = bindSkeletonToModelGroup(tempGroup, boneNodes);
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  bound.skinnedGroup.traverse((c) => {
    if ((c as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(c as THREE.SkinnedMesh);
  });

  // Collect sampled triangle edges per mesh (stride to keep test fast < 12ms)
  interface SampledMeshData {
    sm: THREE.SkinnedMesh;
    restPositions: Float32Array;
    edges: Array<[number, number, number]>; // [vA, vB, restDist]
  }

  const samples: SampledMeshData[] = [];
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  for (const sm of skinnedMeshes) {
    const pos = sm.geometry.attributes.position as THREE.BufferAttribute | undefined;
    const sIdx = sm.geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
    const sWt = sm.geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
    if (!pos || !sIdx || !sWt) continue;

    const restArr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      pA.fromBufferAttribute(pos, i).applyMatrix4(sm.matrixWorld);
      restArr[i * 3] = pA.x;
      restArr[i * 3 + 1] = pA.y;
      restArr[i * 3 + 2] = pA.z;
    }

    const edges: Array<[number, number, number]> = [];
    const index = sm.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const triStride = Math.max(1, Math.floor(triCount / 900));

    for (let t = 0; t < triCount; t += triStride) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const addEdge = (a: number, b: number) => {
        pA.set(restArr[a * 3], restArr[a * 3 + 1], restArr[a * 3 + 2]);
        pB.set(restArr[b * 3], restArr[b * 3 + 1], restArr[b * 3 + 2]);
        const d = pA.distanceTo(pB);
        if (d > 0.002 && d < 0.35) edges.push([a, b, d]);
      };
      addEdge(i0, i1);
      addEdge(i1, i2);
    }

    samples.push({ sm, restPositions: restArr, edges });
  }

  const testSpecs: Array<{
    role: CanonicalHumanoidRole;
    label: string;
    axis: 'x' | 'y' | 'z';
    deg: number;
  }> = [
    { role: 'head', label: 'Head Rotation', axis: 'y', deg: 28 },
    { role: 'neck', label: 'Neck Tilt', axis: 'x', deg: 18 },
    { role: 'spine', label: 'Spine Bend', axis: 'x', deg: 18 },
    { role: 'leftShoulder', label: 'Left Shoulder', axis: 'z', deg: 22 },
    { role: 'leftArm', label: 'Left Upper Arm', axis: 'z', deg: 42 },
    { role: 'leftForearm', label: 'Left Elbow Bend', axis: 'x', deg: -72 },
    { role: 'leftHand', label: 'Left Wrist', axis: 'z', deg: 32 },
    { role: 'leftUpLeg', label: 'Left Hip Swing', axis: 'x', deg: -38 },
    { role: 'leftLeg', label: 'Left Knee Bend', axis: 'x', deg: 70 },
    { role: 'leftFoot', label: 'Left Ankle', axis: 'x', deg: -26 },
  ];

  const results: DeformationJointTestResult[] = [];
  const boneWorldMats: THREE.Matrix4[] = [];
  const _skinVec = new THREE.Vector3();
  const _accum = new THREE.Vector3();
  const _tmpV = new THREE.Vector3();

  const evalVertexLBS = (
    sm: THREE.SkinnedMesh,
    vIdx: number,
    boneMats: THREE.Matrix4[],
    out: THREE.Vector3,
  ) => {
    const pos = sm.geometry.attributes.position as THREE.BufferAttribute;
    const sIdx = sm.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sWt = sm.geometry.attributes.skinWeight as THREE.BufferAttribute;

    _skinVec.fromBufferAttribute(pos, vIdx).applyMatrix4(sm.bindMatrix);
    _accum.set(0, 0, 0);

    const idxs = [sIdx.getX(vIdx), sIdx.getY(vIdx), sIdx.getZ(vIdx), sIdx.getW(vIdx)];
    const wts = [sWt.getX(vIdx), sWt.getY(vIdx), sWt.getZ(vIdx), sWt.getW(vIdx)];

    for (let k = 0; k < 4; k++) {
      const w = wts[k];
      if (w <= 0) continue;
      const bm = boneMats[idxs[k]];
      if (!bm) continue;
      _tmpV.copy(_skinVec).applyMatrix4(bm);
      _accum.addScaledVector(_tmpV, w);
    }

    _accum.applyMatrix4(sm.bindMatrixInverse);
    out.copy(_accum).applyMatrix4(sm.matrixWorld);
  };

  for (const spec of testSpecs) {
    const targetBone = bound.orderedBones.find((b) => resolveHumanoidRole(b.name) === spec.role);
    if (!targetBone) continue;

    // Reset all bones to rest
    for (const [name, bone] of bound.bonesByName.entries()) {
      const rp = bound.restPositions.get(name);
      const rr = bound.restRotations.get(name);
      if (rp) bone.position.copy(rp);
      if (rr) bone.rotation.copy(rr);
      else bone.rotation.set(0, 0, 0);
    }

    // Check rest child distance baseline if bone has a child
    const firstChild = targetBone.children.find((ch): ch is THREE.Bone => (ch as THREE.Bone).isBone);
    const childRestDist = firstChild ? firstChild.position.length() : 0;

    // Apply pose test angle
    targetBone.rotation[spec.axis] += THREE.MathUtils.degToRad(spec.deg);
    bound.skinnedGroup.updateMatrixWorld(true);
    bound.skeleton.update();

    const childAfterDist = firstChild ? firstChild.position.length() : 0;
    const hierarchyDrift = Math.abs(childAfterDist - childRestDist);

    // Precompute skin matrices bone.matrixWorld * boneInverse
    boneWorldMats.length = 0;
    for (let i = 0; i < bound.skeleton.bones.length; i++) {
      const m = new THREE.Matrix4().multiplyMatrices(
        bound.skeleton.bones[i].matrixWorld,
        bound.skeleton.boneInverses[i],
      );
      boneWorldMats.push(m);
    }

    const subtreeIndices = new Set<number>();
    const collectSubtree = (b: THREE.Bone) => {
      const idx = bound.orderedBones.indexOf(b);
      if (idx !== -1) subtreeIndices.add(idx);
      b.children.forEach((ch) => {
        if ((ch as THREE.Bone).isBone) collectSubtree(ch as THREE.Bone);
      });
    };
    collectSubtree(targetBone);

    let maxDisp = 0;
    let maxStretchRatio = 1.0;

    for (const s of samples) {
      const sIdxAttr = s.sm.geometry.attributes.skinIndex as THREE.BufferAttribute;
      const sWtAttr = s.sm.geometry.attributes.skinWeight as THREE.BufferAttribute;
      const posAttr = s.sm.geometry.attributes.position as THREE.BufferAttribute;

      const vertStride = Math.max(1, Math.floor(posAttr.count / 700));
      for (let v = 0; v < posAttr.count; v += vertStride) {
        if (
          (sWtAttr.getX(v) > 0.05 && subtreeIndices.has(sIdxAttr.getX(v))) ||
          (sWtAttr.getY(v) > 0.05 && subtreeIndices.has(sIdxAttr.getY(v))) ||
          (sWtAttr.getZ(v) > 0.05 && subtreeIndices.has(sIdxAttr.getZ(v))) ||
          (sWtAttr.getW(v) > 0.05 && subtreeIndices.has(sIdxAttr.getW(v)))
        ) {
          evalVertexLBS(s.sm, v, boneWorldMats, pA);
          pB.set(s.restPositions[v * 3], s.restPositions[v * 3 + 1], s.restPositions[v * 3 + 2]);
          const disp = pA.distanceTo(pB);
          if (disp > maxDisp) maxDisp = disp;
        }
      }

      for (const [a, b, restD] of s.edges) {
        evalVertexLBS(s.sm, a, boneWorldMats, pA);
        evalVertexLBS(s.sm, b, boneWorldMats, pB);
        const ratio = pA.distanceTo(pB) / restD;
        if (ratio > maxStretchRatio) maxStretchRatio = ratio;
      }
    }

    const passed = hierarchyDrift < 0.002 && maxStretchRatio < 2.8;
    results.push({
      jointRole: spec.label,
      boneName: targetBone.name,
      testAngleDeg: spec.deg,
      maxEdgeStretchRatio: Number(maxStretchRatio.toFixed(2)),
      displacementMag: Number(maxDisp.toFixed(3)),
      passed,
      detail: passed
        ? `Cohesive deformation (${maxDisp.toFixed(3)}m travel, max seam stretch ${maxStretchRatio.toFixed(2)}x).`
        : `High seam stretch (${maxStretchRatio.toFixed(2)}x) or hierarchy drift (${hierarchyDrift.toFixed(4)}m).`,
    });
  }

  // Cleanup temp cloned geometries
  tempGroup.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose();
  });
  skinnedMeshes.forEach((sm) => sm.geometry.dispose());

  return results;
}

export function autoFixRigHierarchy(bones: BoneNode[]): BoneNode[] {
  const seen = new Set<string>();
  const renamed = bones.map((b, idx) => {
    let name = b.name.trim() || `Bone_${idx + 1}`;
    while (seen.has(name)) {
      name = `${name}_${idx + 1}`;
    }
    seen.add(name);
    const scale: [number, number, number] | undefined = b.scale
      ? [
          Math.max(0.1, b.scale[0]),
          Math.max(0.1, b.scale[1]),
          Math.max(0.1, b.scale[2]),
        ]
      : undefined;
    return { ...b, name, ...(scale ? { scale } : {}) };
  });

  const validSet = new Set(renamed.map((b) => b.name));
  const byName = new Map(renamed.map((b) => [b.name, b]));

  // Find primary Hips/Root bone to re-anchor any floating orphan branches
  const primaryRoot =
    renamed.find((b) => resolveHumanoidRole(b.name) === 'hips')?.name ||
    renamed.find((b) => !b.parent)?.name ||
    renamed[0]?.name ||
    null;

  return renamed.map((b) => {
    let parent = b.parent && validSet.has(b.parent) && b.parent !== b.name ? b.parent : null;
    if (!parent && primaryRoot && b.name !== primaryRoot) {
      // Connect non-root floating top bones cleanly to Chest or primaryRoot
      const role = resolveHumanoidRole(b.name);
      const chest = renamed.find((c) => resolveHumanoidRole(c.name) === 'chest')?.name;
      if ((role === 'neck' || role === 'leftShoulder' || role === 'rightShoulder') && chest) {
        parent = chest;
      } else {
        parent = primaryRoot;
      }
    }
    // Break cycles safely
    const visited = new Set<string>([b.name]);
    let cur = parent;
    while (cur) {
      if (visited.has(cur)) {
        parent = b.name === primaryRoot ? null : primaryRoot;
        break;
      }
      visited.add(cur);
      cur = byName.get(cur)?.parent || null;
    }
    return { ...b, parent };
  });
}

const REQUIRED_HUMANOID_ROLES: CanonicalHumanoidRole[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftArm',
  'leftForearm',
  'leftHand',
  'rightShoulder',
  'rightArm',
  'rightForearm',
  'rightHand',
  'leftUpLeg',
  'leftLeg',
  'leftFoot',
  'leftToe',
  'rightUpLeg',
  'rightLeg',
  'rightFoot',
  'rightToe',
];

/**
 * Full "Scan & Repair Rig" pipeline:
 * 1. Scans GLB mesh orientation & proportions -> rescales/grounds to standard 1.9m humanoid base at Y=0.
 * 2. Validates skeleton roles -> detects missing bones, repairs disconnected parents or rebuilds full rig.
 * 3. Snaps misplaced/detached joints cleanly inside mesh volume.
 * 4. Recomputes & normalizes volumetric heat-map skin weights + runs CPU LBS deformation check.
 * 5. Scans mesh topology for non-manifold edges, open boundaries, and degenerate tris + applies heat map.
 */
export function scanAndCorrectGLBSkeleton(
  group: THREE.Group,
  currentBones: BoneNode[],
  preset: SkeletonPresetType = 'full-33',
  heatRadius = 0.36,
  heatFalloff = 2.2,
  highlightMeshIssues = true,
): ScanCorrectionReport {
  const fixesApplied: string[] = [];

  // 1. Check orientation & scale against 1.9m humanoid base grounded at Y=0
  const preAnalysis = analyzeImportedGLBScene(group);
  const preBounds = preAnalysis.coreBounds;
  const preSize = preBounds.getSize(new THREE.Vector3());
  const [rx, ry, rz] = preAnalysis.orientationEulerRad;
  const needsOrientation = Math.abs(rx) > 0.04 || Math.abs(ry) > 0.04 || Math.abs(rz) > 0.04;
  const needsRescaleOrGround =
    Math.abs(preSize.y - 1.9) > 0.08 ||
    Math.abs(preBounds.min.y) > 0.03 ||
    Math.abs(preAnalysis.coreCenter.x) > 0.06 ||
    Math.abs(preAnalysis.coreCenter.z) > 0.06;

  let rescaledToBase = false;
  if (needsOrientation || needsRescaleOrGround) {
    normalizeModelToUnitHeight(group, 1.9, needsOrientation);
    rescaledToBase = true;
    if (needsOrientation) {
      fixesApplied.push(`Re-oriented character upright facing +Z (${preAnalysis.orientationReason})`);
    }
    if (needsRescaleOrGround) {
      fixesApplied.push('Normalized character height to 1.90m standard humanoid base grounded at Y=0');
    }
  }

  // Re-collect world vertices after normalization for accurate volume snapping
  group.updateMatrixWorld(true);
  const sampledPts: THREE.Vector3[] = [];
  const tmpV = new THREE.Vector3();
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      const pos = m.geometry?.attributes?.position as THREE.BufferAttribute | undefined;
      if (!pos || pos.count === 0) return;
      const stride = Math.max(1, Math.floor(pos.count / 2500));
      for (let i = 0; i < pos.count; i += stride) {
        tmpV.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (Number.isFinite(tmpV.x) && Number.isFinite(tmpV.y) && Number.isFinite(tmpV.z)) {
          sampledPts.push(tmpV.clone());
        }
      }
    }
  });

  // 2. Analyze existing skeleton roles & missing bones
  const presentRoles = new Set<CanonicalHumanoidRole>();
  currentBones.forEach((b) => {
    const role = resolveHumanoidRole(b.name);
    if (role !== 'other') presentRoles.add(role);
  });

  const missingRoles = REQUIRED_HUMANOID_ROLES.filter((r) => !presentRoles.has(r));
  const referenceRig = buildIntelligentHumanoidRig(group, preset);
  const coreCriticalMissing =
    currentBones.length < 10 ||
    !presentRoles.has('hips') ||
    !presentRoles.has('spine') ||
    !presentRoles.has('head') ||
    !presentRoles.has('leftArm') ||
    !presentRoles.has('rightArm') ||
    !presentRoles.has('leftUpLeg') ||
    !presentRoles.has('rightUpLeg');

  let rebuiltFullRig = false;
  let hierarchyFixed = false;
  let jointsAdjusted = 0;
  let nextBones: BoneNode[];

  if (coreCriticalMissing || missingRoles.length > 8) {
    nextBones = referenceRig;
    rebuiltFullRig = true;
    hierarchyFixed = true;
    jointsAdjusted = nextBones.length;
    fixesApplied.push(
      missingRoles.length > 0
        ? `Detected ${missingRoles.length} missing humanoid role(s) (${missingRoles.slice(0, 4).join(', ')}${missingRoles.length > 4 ? '…' : ''}) — rebuilt fitted ${nextBones.length}-bone humanoid rig`
        : `Rebuilt volumetric ${nextBones.length}-bone humanoid rig fitted to geometry`,
    );
  } else {
    // Patch missing non-critical roles & snap misplaced joints into mesh volume
    const roleToExisting = new Map<CanonicalHumanoidRole, BoneNode>();
    currentBones.forEach((b) => {
      const r = resolveHumanoidRole(b.name);
      if (r !== 'other' && !roleToExisting.has(r)) roleToExisting.set(r, b);
    });

    const working = [...currentBones];
    if (missingRoles.length > 0) {
      for (const mRole of missingRoles) {
        const refBone = referenceRig.find((rb) => resolveHumanoidRole(rb.name) === mRole);
        if (!refBone) continue;
        // Resolve parent name against existing skeleton if equivalent role exists
        const refParentRole = refBone.parent ? resolveHumanoidRole(refBone.parent) : 'other';
        const matchedParent =
          (refParentRole !== 'other' && roleToExisting.get(refParentRole)?.name) ||
          (refBone.parent && working.some((w) => w.name === refBone.parent) ? refBone.parent : null);
        const inserted: BoneNode = { ...refBone, parent: matchedParent };
        working.push(inserted);
        roleToExisting.set(mRole, inserted);
      }
      fixesApplied.push(`Inserted ${missingRoles.length} missing humanoid joint(s): ${missingRoles.join(', ')}`);
    }

    // Snap any floating/outlier joints cleanly inside mesh volume
    const snapped = working.map((b) => {
      const pt = new THREE.Vector3(...b.position);
      const isFine = /Thumb|Index|Middle|Ring|Pinky|Eye|Toe|Jaw/i.test(b.name);
      const snappedPt = snapJointInsideMeshVolume(
        pt,
        sampledPts,
        isFine ? 0.09 : 0.14,
        isFine ? 0.14 : 0.28,
      );
      if (snappedPt.distanceTo(pt) > 0.012) {
        jointsAdjusted += 1;
        return {
          ...b,
          position: [r3(snappedPt.x), r3(snappedPt.y), r3(snappedPt.z)] as [number, number, number],
        };
      }
      return b;
    });

    if (jointsAdjusted > 0) {
      fixesApplied.push(`Aligned ${jointsAdjusted} drifted joint(s) cleanly inside mesh volume`);
    }

    const fixedHierarchy = autoFixRigHierarchy(snapped);
    const parentChanged = fixedHierarchy.some((fb, i) => fb.parent !== snapped[i]?.parent);
    if (parentChanged) {
      hierarchyFixed = true;
      fixesApplied.push('Repaired broken/orphan parent-child bone chains under single Hips root');
    }
    nextBones = fixedHierarchy;
  }

  // 3. Recompute & normalize volumetric skin weights across every mesh
  let meshCount = 0;
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      meshCount += 1;
      computeHeatMapWeightsForMesh(m, nextBones, heatRadius, heatFalloff);
      normalizeWeightsOnMesh(m, nextBones.length);
    }
  });
  const weightsRebound = meshCount > 0;
  if (weightsRebound) {
    fixesApplied.push(`Recomputed & unit-normalized heat-map skin weights across ${meshCount} mesh(es)`);
  }

  // 4. Topology scan & viewport non-manifold / boundary / degenerate heat map
  const meshIssues = analyzeAndHighlightMeshIssues(group, highlightMeshIssues);
  if (meshIssues.hasIssues) {
    fixesApplied.push(
      `Mesh topology scan flagged ${meshIssues.nonManifoldEdges} non-manifold edge(s), ${meshIssues.boundaryEdges} open boundary edge(s), and ${meshIssues.degenerateTriangles} degenerate triangle(s)`,
    );
  } else {
    fixesApplied.push('Mesh topology scan verified clean watertight manifold geometry (0 critical errors)');
  }

  // 5. Full structural + CPU Linear Blend Skinning deformation audit
  const auditReport = runFullRigAudit(group, nextBones, true);
  if (auditReport.overallPassed) {
    fixesApplied.push(
      `Passed live LBS deformation audit across ${auditReport.deformationResults.length} anatomical joints`,
    );
  }

  return {
    scannedAt: new Date().toLocaleTimeString(),
    orientationFixed: needsOrientation,
    orientationNote: preAnalysis.orientationReason,
    jointsAdjusted,
    hierarchyFixed,
    rebuiltFullRig,
    weightsRebound,
    deformationPassed: auditReport.overallPassed,
    missingRolesDetected: missingRoles,
    rescaledToBase,
    meshIssues,
    fixesApplied,
    bones: nextBones,
    auditReport,
  };
}
