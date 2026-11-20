import * as THREE from 'three';
import type { BoneNode, ViewportShadingMode } from '../types';
import { createControlShapeGeometry } from './ikSolver';
import { applyHeatMapVertexColors } from './riggingEngine';

// Module-scope reusable math objects for zero-GC per-frame bone sync
const _vStart = new THREE.Vector3();
const _vEnd = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _yUp = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _targetBox = new THREE.Box3();
const _boxSize = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();

export type AnatomicalSide = 'left' | 'right' | 'root' | 'center';

export function classifyBoneRole(name: string, parent: string | null): AnatomicalSide {
  if (!parent || /^(hips|pelvis|root)$/i.test(name)) return 'root';
  if (/^(left|l_)|_l$|\.l$/i.test(name)) return 'left';
  if (/^(right|r_)|_r$|\.r$/i.test(name)) return 'right';
  return 'center';
}

export function getBoneRoleColor(
  role: AnatomicalSide,
  isSelected: boolean,
  isHovered: boolean,
): number {
  if (isSelected) return 0xfacc15; // Studio Selection Gold
  if (isHovered) return 0xffffff; // Crisp Hover White
  switch (role) {
    case 'root':
      return 0x34d399; // Pelvis/Root Emerald
    case 'left':
      return 0x38bdf8; // Left Limb Cyan
    case 'right':
      return 0xfb923c; // Right Limb Amber-Coral
    default:
      return 0xcbd5e1; // Axial Spine/Head Platinum
  }
}

/**
 * Builds a classic Blender-style tapered octahedral bone prism spanning y in [0, 1].
 * Base collar sits at y = 0.16, tapering cleanly to tip at y = 1.0 and base at y = 0.0.
 */
export function createOctahedralBoneGeometry(): THREE.BufferGeometry {
  const collarY = 0.16;
  const r = 0.11;

  // 6 key vertices: bottom tip (0), 4 collar corners (1..4), top tip (5)
  const pts: Array<[number, number, number]> = [
    [0, 0, 0], // 0: base joint
    [r, collarY, 0], // 1: +X
    [0, collarY, r], // 2: +Z
    [-r, collarY, 0], // 3: -X
    [0, collarY, -r], // 4: -Z
    [0, 1, 0], // 5: child joint tip
  ];

  const faces = [
    // Lower pyramid (4 triangles)
    0, 2, 1,
    0, 3, 2,
    0, 4, 3,
    0, 1, 4,
    // Upper tapered blade (4 triangles)
    1, 2, 5,
    2, 3, 5,
    3, 4, 5,
    4, 1, 5,
  ];

  const positions = new Float32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const p = pts[faces[i]];
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const SHARED_OCTA_GEO = createOctahedralBoneGeometry();
const SHARED_OCTA_EDGES = new THREE.EdgesGeometry(SHARED_OCTA_GEO, 1);

export interface BoneSegmentVisual {
  boneName: string;
  parentName: string;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  thickness: number;
}

export interface JointVisual {
  boneIndex: number;
  boneName: string;
  mesh: THREE.Mesh;
}

export interface SkeletonVisualRig {
  jointMeshes: JointVisual[];
  boneSegments: BoneSegmentVisual[];
}

const _rollQuat = new THREE.Quaternion();

export function orientBoneSegment(
  mesh: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thicknessFactor = 1.0,
  rollRad = 0,
): void {
  _vDir.copy(end).sub(start);
  const len = _vDir.length();
  if (len < 1e-4) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(start);
  _vDir.divideScalar(len);
  _quat.setFromUnitVectors(_yUp, _vDir);
  if (Math.abs(rollRad) > 1e-4) {
    _rollQuat.setFromAxisAngle(_yUp, rollRad);
    _quat.multiply(_rollQuat);
  }
  mesh.quaternion.copy(_quat);
  // Keep collar width proportional but readable for both spine segments and tiny fingers
  const w = THREE.MathUtils.clamp(len * 0.85, 0.045, 0.36) * thicknessFactor;
  mesh.scale.set(w, len, w);
}

export function buildSkeletonVisuals(
  overlayGroup: THREE.Group,
  targetBones: BoneNode[],
  activeIdx: number,
  hoveredIdx: number | null,
  xray: boolean,
  liveBonesMap?: Map<string, THREE.Bone>,
): SkeletonVisualRig {
  // Dispose previous per-rebuild geometries/materials cleanly (skipping shared octahedron geos)
  while (overlayGroup.children.length > 0) {
    const child = overlayGroup.children[0];
    overlayGroup.remove(child);
    child.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.LineSegments).isLineSegments) {
        const m = obj as THREE.Mesh;
        if (m.geometry && m.geometry !== SHARED_OCTA_GEO && m.geometry !== SHARED_OCTA_EDGES) {
          m.geometry.dispose();
        }
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => mat?.dispose?.());
      }
    });
  }

  const posMap = new Map<string, THREE.Vector3>();
  targetBones.forEach((b) => {
    const live = liveBonesMap?.get(b.name);
    if (live) {
      const wp = new THREE.Vector3();
      live.getWorldPosition(wp);
      posMap.set(b.name, wp);
    } else {
      posMap.set(b.name, new THREE.Vector3(...b.position));
    }
  });

  const jointMeshes: JointVisual[] = [];
  const boneSegments: BoneSegmentVisual[] = [];

  // 1. Octahedral Tapered Parent -> Child Bone Shapes
  targetBones.forEach((b, idx) => {
    if (!b.parent || !posMap.has(b.parent)) return;
    const pVec = posMap.get(b.parent)!;
    const cVec = posMap.get(b.name)!;
    const isSelected = idx === activeIdx;
    const isHovered = idx === hoveredIdx;
    const isFine = /Thumb|Index|Middle|Ring|Pinky|Toe|Jaw|Eye/i.test(b.name);
    const role = classifyBoneRole(b.name, b.parent);
    const color = getBoneRoleColor(role, isSelected, isHovered);

    const fillMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: isSelected ? 0.42 : isHovered ? 0.36 : 0.22,
      depthTest: !xray,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const boneMesh = new THREE.Mesh(SHARED_OCTA_GEO, fillMat);
    boneMesh.renderOrder = isSelected ? 997 : 994;
    boneMesh.userData.boneIndex = idx;

    const edgeMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: isSelected ? 1.0 : isHovered ? 0.95 : 0.78,
      depthTest: !xray,
    });
    const edges = new THREE.LineSegments(SHARED_OCTA_EDGES, edgeMat);
    edges.renderOrder = isSelected ? 998 : 995;
    boneMesh.add(edges);

    const thickness = isFine ? 0.55 : /Spine|Chest|Hips/i.test(b.name) ? 1.15 : 0.92;
    orientBoneSegment(boneMesh, pVec, cVec, thickness, b.roll ?? 0);
    overlayGroup.add(boneMesh);

    boneSegments.push({
      boneName: b.name,
      parentName: b.parent,
      mesh: boneMesh,
      edges,
      thickness,
    });
  });

  // 2. Clean Selectable 3D Joint Handles & Anatomical Control Shapes
  targetBones.forEach((b, idx) => {
    const isSelected = idx === activeIdx;
    const isHovered = idx === hoveredIdx;
    const isFine = /Thumb|Index|Middle|Ring|Pinky|Toe|Jaw|Eye/i.test(b.name);
    const role = classifyBoneRole(b.name, b.parent);
    const color = getBoneRoleColor(role, isSelected, isHovered);

    const baseRadius = isSelected
      ? isFine
        ? 0.018
        : 0.032
      : isHovered
        ? isFine
          ? 0.015
          : 0.026
        : isFine
          ? 0.011
          : 0.021;

    const controlShape =
      b.controlShape ??
      (role === 'root' || /^(Spine|Chest)$/i.test(b.name)
        ? 'ring'
        : /Hand|Foot/i.test(b.name)
          ? 'cube'
          : /Jaw|Eye/i.test(b.name)
            ? 'diamond'
            : 'sphere');

    const jointGeo = createControlShapeGeometry(controlShape, baseRadius);
    const jointMat = new THREE.MeshBasicMaterial({
      color,
      depthTest: !xray,
      wireframe: controlShape === 'cube' && !isSelected,
    });
    const jointMesh = new THREE.Mesh(jointGeo, jointMat);

    const pos = posMap.get(b.name)!;
    jointMesh.position.copy(pos);
    if (b.rotation && !liveBonesMap) {
      jointMesh.rotation.set(b.rotation[0], b.rotation[1], b.rotation[2]);
    }
    if (b.scale && !liveBonesMap) {
      jointMesh.scale.set(b.scale[0], b.scale[1], b.scale[2]);
    }
    jointMesh.renderOrder = isSelected ? 1002 : 999;
    jointMesh.userData.boneIndex = idx;
    jointMesh.userData.boneName = b.name;

    // Selection halo ring & local axis triad (shows bone roll) for crisp Blender-style readability
    if (isSelected) {
      const haloGeo = new THREE.RingGeometry(baseRadius * 1.45, baseRadius * 1.75, 24);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.renderOrder = 1003;
      jointMesh.add(halo);

      const localAxes = new THREE.AxesHelper(isFine ? 0.08 : 0.14);
      if (!liveBonesMap && b.roll) {
        localAxes.rotateY(b.roll);
      }
      localAxes.renderOrder = 1004;
      jointMesh.add(localAxes);
    }

    overlayGroup.add(jointMesh);
    jointMeshes.push({ boneIndex: idx, boneName: b.name, mesh: jointMesh });
  });

  return { jointMeshes, boneSegments };
}

/**
 * Updates octahedral bones and joint handles directly from live Three.js Bones
 * during bound FK/IK posing or AnimationMixer playback with zero heap allocations.
 */
export function syncSkeletonVisualsFromLiveBones(
  rig: SkeletonVisualRig,
  liveBonesMap: Map<string, THREE.Bone>,
): void {
  for (let i = 0; i < rig.jointMeshes.length; i++) {
    const j = rig.jointMeshes[i];
    const b = liveBonesMap.get(j.boneName);
    if (b) {
      b.getWorldPosition(_vStart);
      j.mesh.position.copy(_vStart);
    }
  }
  for (let i = 0; i < rig.boneSegments.length; i++) {
    const seg = rig.boneSegments[i];
    const pBone = liveBonesMap.get(seg.parentName);
    const cBone = liveBonesMap.get(seg.boneName);
    if (pBone && cBone) {
      pBone.getWorldPosition(_vStart);
      cBone.getWorldPosition(_vEnd);
      orientBoneSegment(seg.mesh, _vStart, _vEnd, seg.thickness);
    }
  }
}

/**
 * Creates a soft radial ground contact shadow texture so characters feel grounded
 * without an oversized shiny circular pedestal.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 12, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a clean, properly proportioned Blender/Maya/Unreal viewport grid floor
 * with shadow catcher, subtle contact shadow, minor/major grids, and X/Z axis hairlines.
 */
export function buildStudioFloorGroup(): {
  floorGroup: THREE.Group;
  gridObject: THREE.Group;
  dispose: () => void;
} {
  const floorGroup = new THREE.Group();
  floorGroup.name = 'Studio_Viewport_Floor';

  // Matte real shadow catcher plane
  const shadowPlaneGeo = new THREE.PlaneGeometry(14, 14);
  const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.38 });
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0;
  shadowPlane.receiveShadow = true;
  floorGroup.add(shadowPlane);

  // Subtle radial contact shadow right beneath character's feet
  const contactTex = createContactShadowTexture();
  const contactGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const contactMat = new THREE.MeshBasicMaterial({
    map: contactTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const contactMesh = new THREE.Mesh(contactGeo, contactMat);
  contactMesh.rotation.x = -Math.PI / 2;
  contactMesh.position.y = 0.001;
  floorGroup.add(contactMesh);

  // Proportioned 4.8m Blender/Maya Dual Grid + X/Z World Axis Lines
  const gridObject = new THREE.Group();
  const minorGrid = new THREE.GridHelper(4.8, 24, 0x2a3140, 0x222733);
  minorGrid.position.y = 0.002;
  (minorGrid.material as THREE.Material).transparent = true;
  (minorGrid.material as THREE.Material).opacity = 0.55;
  gridObject.add(minorGrid);

  const majorGrid = new THREE.GridHelper(4.8, 8, 0x3b4459, 0x333b4d);
  majorGrid.position.y = 0.003;
  (majorGrid.material as THREE.Material).transparent = true;
  (majorGrid.material as THREE.Material).opacity = 0.72;
  gridObject.add(majorGrid);

  // X Axis Red Line & Z Axis Blue Line
  const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-2.4, 0.004, 0),
    new THREE.Vector3(2.4, 0.004, 0),
  ]);
  const xAxisMat = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.52 });
  const xAxis = new THREE.Line(xAxisGeo, xAxisMat);
  gridObject.add(xAxis);

  const zAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.004, -2.4),
    new THREE.Vector3(0, 0.004, 2.4),
  ]);
  const zAxisMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.52 });
  const zAxis = new THREE.Line(zAxisGeo, zAxisMat);
  gridObject.add(zAxis);

  floorGroup.add(gridObject);

  const dispose = () => {
    shadowPlaneGeo.dispose();
    shadowPlaneMat.dispose();
    contactTex.dispose();
    contactGeo.dispose();
    contactMat.dispose();
    xAxisGeo.dispose();
    xAxisMat.dispose();
    zAxisGeo.dispose();
    zAxisMat.dispose();
    minorGrid.dispose();
    majorGrid.dispose();
  };

  return { floorGroup, gridObject, dispose };
}

/**
 * Computes ideal camera target & position so the framed character occupies ~74% of viewport height.
 */
export function computeAutoFramedCameraPose(
  targetObject: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  view: 'perspective' | 'front' | 'back' | 'side' | 'top' | 'frame',
  currentCamPos?: THREE.Vector3,
  currentTarget?: THREE.Vector3,
): { target: THREE.Vector3; position: THREE.Vector3 } {
  targetObject.updateMatrixWorld(true);
  _targetBox.setFromObject(targetObject);
  if (_targetBox.isEmpty()) {
    return {
      target: new THREE.Vector3(0, 0.95, 0),
      position: new THREE.Vector3(0.85, 1.32, 2.3),
    };
  }

  _targetBox.getSize(_boxSize);
  _targetBox.getCenter(_boxCenter);

  const h = Math.max(_boxSize.y, 0.5);
  const w = Math.max(_boxSize.x, 0.35);
  const d = Math.max(_boxSize.z, 0.35);

  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const tanHalfV = Math.tan(fovRad / 2);
  const aspect = Math.max(0.6, camera.aspect || 1.33);

  // Target 74% vertical viewport occupancy for full-body framing
  const distV = (h / 0.74) / (2 * tanHalfV);
  const distH = (w / 0.64) / (2 * tanHalfV * aspect);
  const dist = Math.max(distV, distH) + d * 0.42;

  const target = _boxCenter.clone();
  const dir = new THREE.Vector3();

  if (view === 'front') {
    dir.set(0, 0.03, 1);
  } else if (view === 'back') {
    dir.set(0, 0.03, -1);
  } else if (view === 'side') {
    dir.set(1, 0.03, 0);
  } else if (view === 'top') {
    dir.set(0, 0.98, 0.14);
  } else if (view === 'frame' && currentCamPos && currentTarget) {
    dir.copy(currentCamPos).sub(currentTarget);
    if (dir.lengthSq() < 1e-4) dir.set(0.36, 0.14, 0.92);
  } else {
    // Classic 3/4 Blender/Maya studio perspective
    dir.set(0.38, 0.14, 0.91);
  }

  dir.normalize();
  const position = target.clone().addScaledVector(dir, dist * (view === 'top' ? 1.15 : 1.0));
  return { target, position };
}

const SHARED_CLAY_MAT = new THREE.MeshStandardMaterial({
  color: 0xa1a8b5,
  roughness: 0.46,
  metalness: 0.08,
});

/**
 * Applies any of the 7 real viewport shading modes cleanly across a model Group
 * while caching original PBR materials on `mesh.userData.__origMaterial`.
 */
export function applyViewportShadingToGroup(
  group: THREE.Group | null,
  mode: ViewportShadingMode,
  selectedBoneIdx: number,
  meshWireframeOverrides?: Set<string>,
): void {
  if (!group) return;

  group.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;

    if (!mesh.userData.__origMaterial) {
      mesh.userData.__origMaterial = mesh.material;
    }
    const orig = mesh.userData.__origMaterial as THREE.Material | THREE.Material[];
    const userWire = meshWireframeOverrides?.has(mesh.uuid) ?? false;

    const disposeTempIfAny = () => {
      if (mesh.userData.__tempShadingMat) {
        const list = Array.isArray(mesh.userData.__tempShadingMat)
          ? mesh.userData.__tempShadingMat
          : [mesh.userData.__tempShadingMat];
        list.forEach((m: THREE.Material) => m?.dispose?.());
        mesh.userData.__tempShadingMat = null;
      }
    };

    if (mode === 'material' || mode === 'unskinned') {
      disposeTempIfAny();
      mesh.material = orig;
      const mats = Array.isArray(orig) ? orig : [orig];
      mats.forEach((m) => {
        if ('vertexColors' in m) (m as THREE.MeshStandardMaterial).vertexColors = false;
        if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = userWire;
        if ('transparent' in m && mesh.userData.__origOpacity !== undefined) {
          m.opacity = mesh.userData.__origOpacity;
          m.transparent = Boolean(mesh.userData.__origTransparent);
          m.depthWrite = mesh.userData.__origDepthWrite ?? true;
        }
        m.needsUpdate = true;
      });
      return;
    }

    if (mode === 'solid') {
      disposeTempIfAny();
      const clay = SHARED_CLAY_MAT.clone();
      clay.wireframe = userWire;
      mesh.userData.__tempShadingMat = clay;
      mesh.material = clay;
      return;
    }

    if (mode === 'wireframe') {
      disposeTempIfAny();
      const wireMat = new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.18,
        roughness: 0.4,
        metalness: 0.1,
        wireframe: true,
      });
      mesh.userData.__tempShadingMat = wireMat;
      mesh.material = wireMat;
      return;
    }

    if (mode === 'xray' || mode === 'skeleton') {
      disposeTempIfAny();
      const ghostMat = new THREE.MeshStandardMaterial({
        color: 0x8b95a8,
        roughness: 0.5,
        metalness: 0.1,
        transparent: true,
        opacity: mode === 'skeleton' ? 0.14 : 0.36,
        depthWrite: false,
        wireframe: userWire,
      });
      mesh.userData.__tempShadingMat = ghostMat;
      mesh.material = ghostMat;
      return;
    }

    if (mode === 'weights') {
      disposeTempIfAny();
      applyHeatMapVertexColors(mesh, selectedBoneIdx);
      const heatMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0.04,
        vertexColors: true,
        emissive: 0x111111,
        emissiveIntensity: 0.35,
        wireframe: userWire,
      });
      mesh.userData.__tempShadingMat = heatMat;
      mesh.material = heatMat;
    }
  });
}
