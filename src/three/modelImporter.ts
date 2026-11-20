import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { BoneNode, ModelStats, SceneMeshInfo } from '../types';
import {
  analyzeImportedGLBScene,
  applyTransformToPreservedScene,
  bakeMeshWorldGeometry,
  cloneScenePreservingSkeleton,
  computeNormalizationMatrixFromAnalysis,
  type BoundRigResult,
} from './riggingEngine';

export interface ImportedModelPackage {
  group: THREE.Group;
  preservedSkinnedScene: THREE.Group | null;
  hasValidNativeRig: boolean;
  stats: ModelStats;
  existingBones: BoneNode[];
  nativeClips: THREE.AnimationClip[];
  modelName: string;
}

const r3 = (n: number) => Number(n.toFixed(3));

export function computeGroupStats(
  root: THREE.Object3D,
  nativeClips: THREE.AnimationClip[] = [],
  existingBonesOverride?: number,
): ModelStats {
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  let boneCount = 0;
  const materialSet = new Set<THREE.Material>();
  const morphNames = new Set<string>();

  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      boneCount += 1;
    }
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      meshes += 1;
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (pos) {
        vertices += pos.count;
        triangles += geo.index ? Math.floor(geo.index.count / 3) : Math.floor(pos.count / 3);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (m) materialSet.add(m);
      });
      if (mesh.morphTargetDictionary) {
        Object.keys(mesh.morphTargetDictionary).forEach((k) => morphNames.add(k));
      }
    }
  });

  return {
    vertices,
    triangles,
    meshes,
    materials: materialSet.size,
    existingBones: existingBonesOverride ?? boneCount,
    animations: nativeClips.length,
    animationNames: nativeClips.map((c, idx) => c.name || `Clip_${idx + 1}`),
    morphTargetCount: morphNames.size,
    morphTargetNames: Array.from(morphNames),
  };
}

export function extractSceneMeshesInfo(group: THREE.Object3D): SceneMeshInfo[] {
  const result: SceneMeshInfo[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      const geo = m.geometry;
      const pos = geo.attributes.position;
      const verts = pos ? pos.count : 0;
      const tris = pos ? (geo.index ? Math.floor(geo.index.count / 3) : Math.floor(pos.count / 3)) : 0;
      const firstMat = Array.isArray(m.material) ? m.material[0] : m.material;
      const wireframe = Boolean(firstMat && 'wireframe' in firstMat && (firstMat as THREE.MeshStandardMaterial).wireframe);
      result.push({
        name: m.name || `Mesh_${result.length + 1}`,
        uuid: m.uuid,
        vertices: verts,
        triangles: tris,
        visible: m.visible,
        wireframe,
        materialName: (firstMat && firstMat.name) || 'Standard Material',
      });
    }
  });
  return result;
}

function validateNativeSkinnedScene(root: THREE.Object3D): boolean {
  let validSkinnedCount = 0;
  let totalVertsChecked = 0;
  let validVerts = 0;

  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      const skel = sm.skeleton;
      const pos = sm.geometry?.attributes?.position;
      const sIdx = sm.geometry?.attributes?.skinIndex as THREE.BufferAttribute | undefined;
      const sWt = sm.geometry?.attributes?.skinWeight as THREE.BufferAttribute | undefined;
      if (!skel || skel.bones.length < 2 || !pos || !sIdx || !sWt) return;

      // Ensure finite bone inverses
      const hasValidInverses =
        skel.boneInverses.length === skel.bones.length &&
        skel.boneInverses.every((m) => Number.isFinite(m.elements[0]) && Math.abs(m.determinant()) > 1e-10);
      if (!hasValidInverses) return;

      const stride = Math.max(1, Math.floor(pos.count / 120));
      for (let i = 0; i < pos.count; i += stride) {
        totalVertsChecked += 1;
        const sum = sWt.getX(i) + sWt.getY(i) + sWt.getZ(i) + sWt.getW(i);
        if (sum > 0.05 && Number.isFinite(sum)) validVerts += 1;
      }
      validSkinnedCount += 1;
    }
  });

  return validSkinnedCount > 0 && (totalVertsChecked === 0 || validVerts / totalVertsChecked >= 0.85);
}

/**
 * Extracts a ready-to-animate BoundRigResult directly from a preserved native GLB scene
 * without overwriting its original Skeleton, bindMatrix, boneInverses, or skinWeights.
 */
export function extractPreservedBoundRig(preservedScene: THREE.Group): BoundRigResult {
  const cloned = cloneScenePreservingSkeleton(preservedScene);
  cloned.updateMatrixWorld(true);

  const bonesByName = new Map<string, THREE.Bone>();
  const restPositions = new Map<string, THREE.Vector3>();
  const restRotations = new Map<string, THREE.Euler>();
  const orderedBones: THREE.Bone[] = [];
  let primarySkeleton: THREE.Skeleton | null = null;

  cloned.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      sm.frustumCulled = false;
      sm.castShadow = true;
      sm.receiveShadow = true;
      if (!primarySkeleton && sm.skeleton) primarySkeleton = sm.skeleton;
    }
    if ((obj as THREE.Bone).isBone) {
      const b = obj as THREE.Bone;
      if (!bonesByName.has(b.name)) {
        bonesByName.set(b.name, b);
        restPositions.set(b.name, b.position.clone());
        restRotations.set(b.name, b.rotation.clone());
        orderedBones.push(b);
      }
    }
  });

  const skeleton = primarySkeleton ?? new THREE.Skeleton(orderedBones);
  return {
    skinnedGroup: cloned,
    skeleton,
    bonesByName,
    orderedBones,
    restPositions,
    restRotations,
  };
}

function extractNormalizedBonesFromScene(root: THREE.Object3D): BoneNode[] {
  root.updateMatrixWorld(true);
  const foundBones: THREE.Bone[] = [];
  const usedNames = new Set<string>();

  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      const b = obj as THREE.Bone;
      let clean = (b.name || `Bone_${foundBones.length + 1}`).trim();
      while (usedNames.has(clean)) {
        clean = `${clean}_${foundBones.length + 1}`;
      }
      b.name = clean;
      usedNames.add(clean);
      foundBones.push(b);
    }
  });

  if (foundBones.length === 0) return [];

  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();

  return foundBones.map((b) => {
    b.matrixWorld.decompose(worldPos, worldQuat, worldScale);
    const parentName = b.parent && (b.parent as THREE.Bone).isBone ? b.parent.name : null;
    return {
      name: b.name,
      parent: parentName,
      position: [r3(worldPos.x), r3(worldPos.y), r3(worldPos.z)],
      rotation: [r3(b.rotation.x), r3(b.rotation.y), r3(b.rotation.z)],
      scale: [1, 1, 1],
    };
  });
}

function preserveAndBakeRiggingGroup(rawScene: THREE.Object3D, fallbackName: string): {
  baked: THREE.Group;
  preservedSkinnedScene: THREE.Group | null;
  hasValidNativeRig: boolean;
  existingBones: BoneNode[];
} {
  // 0. Analyze complete raw GLB scene (hierarchy, bounds, outliers, orientation, SkinnedMeshes) BEFORE modifying anything
  const initialAnalysis = analyzeImportedGLBScene(rawScene);
  const normMatrix = computeNormalizationMatrixFromAnalysis(initialAnalysis, 1.9, true);

  // 1. Non-destructively clone the raw imported GLB scene first to preserve native Skeleton + SkinnedMeshes
  const hasSkinned = initialAnalysis.skinnedMeshCount > 0;

  let preservedSkinnedScene: THREE.Group | null = null;
  let hasValidNativeRig = false;
  if (hasSkinned) {
    preservedSkinnedScene = cloneScenePreservingSkeleton(rawScene);
    preservedSkinnedScene.name = rawScene.name || fallbackName;
    applyTransformToPreservedScene(preservedSkinnedScene, normMatrix);
    preservedSkinnedScene.userData.__normalizedHeight = 1.9;
    hasValidNativeRig = validateNativeSkinnedScene(preservedSkinnedScene);
    if (!hasValidNativeRig) {
      preservedSkinnedScene = null;
    }
  }

  // Extract existing bones in exact unified normalized coordinates
  const boneSource = preservedSkinnedScene ?? rawScene;
  if (!preservedSkinnedScene) {
    applyTransformToPreservedScene(rawScene, normMatrix);
  }
  boneSource.updateMatrixWorld(true);
  const existingBones = extractNormalizedBonesFromScene(boneSource);

  // 2. Build clean world-baked mesh copy (respecting SkinnedMesh bind poses!) for Edit / Auto-Rigging
  const baked = new THREE.Group();
  baked.name = rawScene.name || fallbackName;

  boneSource.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const srcMesh = child as THREE.Mesh;
      const srcPos = srcMesh.geometry?.attributes?.position;
      if (!srcPos || srcPos.count === 0) return;

      const geo = bakeMeshWorldGeometry(srcMesh);

      const mat = Array.isArray(srcMesh.material)
        ? srcMesh.material.map((m) => m.clone())
        : srcMesh.material
          ? srcMesh.material.clone()
          : new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.45 });

      const cleanMesh = new THREE.Mesh(geo, mat);
      cleanMesh.name = srcMesh.name || `Mesh_${baked.children.length + 1}`;
      cleanMesh.castShadow = true;
      cleanMesh.receiveShadow = true;
      if (srcMesh.morphTargetDictionary) {
        cleanMesh.morphTargetDictionary = { ...srcMesh.morphTargetDictionary };
      }
      if (srcMesh.morphTargetInfluences) {
        cleanMesh.morphTargetInfluences = [...srcMesh.morphTargetInfluences];
      }
      baked.add(cleanMesh);
    }
  });

  if (baked.children.length === 0) {
    throw new Error('The imported 3D file contains no valid polygon meshes.');
  }

  // Validate finite geometry positions
  let hasInvalidNaN = false;
  baked.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const pos = (child as THREE.Mesh).geometry.attributes.position;
      for (let i = 0; i < Math.min(pos.count, 500); i++) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
          hasInvalidNaN = true;
          break;
        }
      }
    }
  });
  if (hasInvalidNaN) {
    throw new Error('Geometry contains invalid NaN vertex coordinates and cannot be rigged safely.');
  }

  baked.updateMatrixWorld(true);
  baked.userData.__normalizedHeight = 1.9;
  baked.userData.__glbAnalysis = analyzeImportedGLBScene(baked);
  if (preservedSkinnedScene) {
    preservedSkinnedScene.userData.__glbAnalysis = baked.userData.__glbAnalysis;
  }
  return { baked, preservedSkinnedScene, hasValidNativeRig, existingBones };
}

function buildDracoLoader(): DRACOLoader | null {
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    return draco;
  } catch {
    return null;
  }
}

export async function importModelFiles(files: File[]): Promise<ImportedModelPackage> {
  if (!files || files.length === 0) {
    throw new Error('No files selected for import.');
  }

  const primaryFile = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
  if (!primaryFile) {
    throw new Error('Unsupported file type. Please select a .GLB or .GLTF 3D character file (plus optional .bin and texture files).');
  }

  const isGlb = /\.glb$/i.test(primaryFile.name);
  const blobUrls = new Map<string, string>();
  const createdUrls: string[] = [];

  for (const file of files) {
    const url = URL.createObjectURL(file);
    createdUrls.push(url);
    blobUrls.set(file.name, url);
    blobUrls.set(file.name.toLowerCase(), url);
    const baseName = file.name.split('/').pop() || file.name;
    blobUrls.set(baseName, url);
    blobUrls.set(baseName.toLowerCase(), url);
  }

  const cleanup = () => {
    createdUrls.forEach((u) => URL.revokeObjectURL(u));
  };

  try {
    const buffer = await primaryFile.arrayBuffer();

    if (isGlb) {
      if (buffer.byteLength < 12) {
        throw new Error('Corrupt .GLB file: file is smaller than the 12-byte GLB header.');
      }
      const magic = new DataView(buffer).getUint32(0, true);
      // 0x46546C67 = 'glTF'
      if (magic !== 0x46546c67) {
        throw new Error('Invalid .GLB binary header. Ensure the file is a valid binary glTF 2.0 container.');
      }
    } else {
      const text = new TextDecoder().decode(buffer);
      let parsedJson: Record<string, unknown>;
      try {
        parsedJson = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error('Invalid .GLTF file: JSON syntax could not be parsed.');
      }
      if (!parsedJson.asset && !parsedJson.meshes && !parsedJson.nodes) {
        throw new Error('Invalid .GLTF schema: missing required glTF asset/meshes fields.');
      }
      // Check external .bin dependency notice
      const buffers = Array.isArray(parsedJson.buffers) ? (parsedJson.buffers as Array<{ uri?: string }>) : [];
      for (const b of buffers) {
        if (b.uri && !b.uri.startsWith('data:')) {
          const cleanUri = decodeURIComponent(b.uri).split('/').pop()?.toLowerCase() || '';
          if (!blobUrls.has(cleanUri) && !blobUrls.has(b.uri.toLowerCase())) {
            throw new Error(
              `This .GLTF references an external binary "${b.uri}". Please select/drop the .gltf, .bin, and texture files together, or upload a self-contained .GLB.`,
            );
          }
        }
      }
    }

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      const stripped = decodeURIComponent(url.split('?')[0]);
      const base = (stripped.split('/').pop() || stripped).toLowerCase();
      return blobUrls.get(stripped) || blobUrls.get(base) || url;
    });

    const loader = new GLTFLoader(manager);
    const draco = buildDracoLoader();
    if (draco) loader.setDRACOLoader(draco);

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (res) => resolve(res),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });

    const cleanName = primaryFile.name.replace(/\.(glb|gltf)$/i, '').slice(0, 60) || 'Imported Character';
    const rawScene = gltf.scene || (gltf.scenes && gltf.scenes[0]) || new THREE.Group();
    const { baked, preservedSkinnedScene, hasValidNativeRig, existingBones } =
      preserveAndBakeRiggingGroup(rawScene, cleanName);
    const nativeClips = Array.isArray(gltf.animations) ? gltf.animations : [];
    const stats = computeGroupStats(baked, nativeClips, existingBones.length);

    return {
      group: baked,
      preservedSkinnedScene,
      hasValidNativeRig,
      stats,
      existingBones,
      nativeClips,
      modelName: cleanName,
    };
  } finally {
    // Allow brief microtask window for async textures before revoking blob URLs
    window.setTimeout(cleanup, 1500);
  }
}

export async function applyTextureFileToMesh(mesh: THREE.Mesh, file: File): Promise<void> {
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
    throw new Error('Supported texture formats: PNG, JPG, WEBP, BMP.');
  }
  const url = URL.createObjectURL(file);
  try {
    const tex = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error('Failed to decode texture image.')));
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;

    // Ensure mesh has UV coordinates
    if (!mesh.geometry.attributes.uv) {
      const pos = mesh.geometry.attributes.position;
      const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
      const size = box.getSize(new THREE.Vector3());
      const uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const u = (pos.getX(i) - box.min.x) / Math.max(size.x, 0.001);
        const v = (pos.getY(i) - box.min.y) / Math.max(size.y, 0.001);
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
      mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if ('map' in m) {
        (m as THREE.MeshStandardMaterial).map = tex;
        (m as THREE.MeshStandardMaterial).color.setHex(0xffffff);
        m.needsUpdate = true;
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportGroupWithAnimations(
  group: THREE.Object3D,
  animations: THREE.AnimationClip[],
  binary: boolean,
): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          resolve(JSON.stringify(result, null, 2));
        }
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      {
        binary,
        animations: animations.length > 0 ? animations : undefined,
      },
    );
  });
}
