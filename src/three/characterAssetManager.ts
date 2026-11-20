import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BoneNode } from '../types';
import {
  bindSkeletonToModelGroup,
  flattenAndBakeGLBForRigging,
  normalizePreservedSkinnedScene,
  resolveHumanoidRole,
  type CanonicalHumanoidRole,
} from './riggingEngine';

export type RigCompatibilityStatus = 'humanoid' | 'partial-rig' | 'unrigged';

export interface GLBAssetAnalysis {
  meshCount: number;
  vertexCount: number;
  boneCount: number;
  humanoidRoleCount: number;
  rigStatus: RigCompatibilityStatus;
  missingCoreRoles: CanonicalHumanoidRole[];
  hasSkinnedMesh: boolean;
}

export interface CachedGLBTemplate {
  endpoint: string;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  hasSkeleton: boolean;
  analysis: GLBAssetAnalysis;
}

export interface PreparedCharacterRig {
  /** Outer actor wrapper whose origin (0,0,0) always sits strictly centered under feet on y=0 */
  actorWrapper: THREE.Group;
  /** Inner normalized character root (either cloned GLB or bound SkinnedMesh group) */
  innerRoot: THREE.Group;
  bonesByName: Map<string, THREE.Bone>;
  restPositions: Map<string, THREE.Vector3>;
  restRotations: Map<string, THREE.Euler>;
  nativeClips: THREE.AnimationClip[];
  analysis: GLBAssetAnalysis;
  usedFallbackAutoRig: boolean;
  dispose: () => void;
}

const CORE_HUMANOID_ROLES: CanonicalHumanoidRole[] = [
  'hips',
  'spine',
  'head',
  'leftArm',
  'leftForearm',
  'rightArm',
  'rightForearm',
  'leftUpLeg',
  'leftLeg',
  'leftFoot',
  'rightUpLeg',
  'rightLeg',
  'rightFoot',
];

const _loader = new GLTFLoader();
const _templateCache = new Map<string, Promise<CachedGLBTemplate>>();
const _boxScratch = new THREE.Box3();
const _centerScratch = new THREE.Vector3();

function inspectSceneRig(root: THREE.Object3D): GLBAssetAnalysis {
  let meshCount = 0;
  let vertexCount = 0;
  let hasSkinnedMesh = false;
  const uniqueBones = new Set<string>();
  const detectedRoles = new Set<CanonicalHumanoidRole>();

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      meshCount += 1;
      const pos = m.geometry?.attributes?.position;
      if (pos) vertexCount += pos.count;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        hasSkinnedMesh = true;
      }
    }
    if ((obj as THREE.Bone).isBone) {
      uniqueBones.add(obj.name);
      const role = resolveHumanoidRole(obj.name);
      if (role !== 'other') detectedRoles.add(role);
    }
  });

  const missingCoreRoles = CORE_HUMANOID_ROLES.filter((r) => !detectedRoles.has(r));
  let rigStatus: RigCompatibilityStatus = 'unrigged';
  if (uniqueBones.size > 0 && hasSkinnedMesh) {
    rigStatus = missingCoreRoles.length <= 3 && detectedRoles.size >= 8 ? 'humanoid' : 'partial-rig';
  }

  return {
    meshCount,
    vertexCount,
    boneCount: uniqueBones.size,
    humanoidRoleCount: detectedRoles.size,
    rigStatus,
    missingCoreRoles,
    hasSkinnedMesh,
  };
}

function configureCharacterMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      // Clone materials per-instance safely only when modifying flags, keeping textures shared
      const hasVertexColors = Boolean(mesh.geometry?.attributes?.color);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => {
        if (!mat) return;
        if ('vertexColors' in mat && !hasVertexColors) {
          (mat as THREE.MeshStandardMaterial).vertexColors = false;
        }
        mat.needsUpdate = true;
      });
    }
  });
}

function snapInnerRootToFloorOrigin(actorWrapper: THREE.Group, innerRoot: THREE.Group): void {
  actorWrapper.updateMatrixWorld(true);
  _boxScratch.setFromObject(innerRoot);
  if (!_boxScratch.isEmpty()) {
    _boxScratch.getCenter(_centerScratch);
    innerRoot.position.x -= _centerScratch.x;
    innerRoot.position.z -= _centerScratch.z;
    innerRoot.position.y -= _boxScratch.min.y;
    actorWrapper.updateMatrixWorld(true);
  }
}

export class CharacterAssetManager {
  /**
   * Loads & caches a parsed GLB/GLTF template by endpoint so multiple actors
   * (or preview views) never duplicate network requests or binary parsing.
   * Ephemeral `blob:` URLs are bypassed from persistent cache or cleared safely on error.
   */
  public static loadTemplate(endpoint: string): Promise<CachedGLBTemplate> {
    const isBlob = endpoint.startsWith('blob:');
    if (!isBlob && _templateCache.has(endpoint)) {
      return _templateCache.get(endpoint)!;
    }

    const loadPromise = new Promise<CachedGLBTemplate>((resolve, reject) => {
      _loader.load(
        endpoint,
        (gltf) => {
          const root = gltf.scene || gltf.scenes?.[0];
          if (!root) {
            reject(new Error('GLB archive contains no valid 3D scene root.'));
            return;
          }

          root.updateMatrixWorld(true);
          const analysis = inspectSceneRig(root);
          if (analysis.meshCount === 0 || analysis.vertexCount === 0) {
            reject(new Error('GLB archive contains no renderable mesh geometry.'));
            return;
          }

          resolve({
            endpoint,
            scene: root,
            animations: gltf.animations || [],
            hasSkeleton: analysis.hasSkinnedMesh && analysis.boneCount > 0,
            analysis,
          });
        },
        undefined,
        (err) => {
          if (!isBlob) _templateCache.delete(endpoint);
          reject(err instanceof Error ? err : new Error(`Failed to fetch GLB at ${endpoint}`));
        },
      );
    });

    if (!isBlob) {
      _templateCache.set(endpoint, loadPromise);
    }
    return loadPromise;
  }

  public static invalidate(endpoint: string): void {
    _templateCache.delete(endpoint);
  }

  /**
   * Instantiates an independent, ground-aligned, normalized (`~1.9m` tall, `+Y` up, `+Z` forward)
   * character actor inside an outer `actorWrapper` Group.
   * Outer callers ONLY move/rotate `actorWrapper` so GLB root transforms are never wiped out.
   */
  public static async instantiateGLBCharacter(
    endpoint: string,
    customBones?: BoneNode[],
  ): Promise<PreparedCharacterRig> {
    const template = await this.loadTemplate(endpoint);
    const clonedScene = SkeletonUtils.clone(template.scene) as THREE.Group;
    clonedScene.updateMatrixWorld(true);

    // Normalize scale (~1.9m height), orientation (+Y up, +Z forward), and center on innerRoot
    normalizePreservedSkinnedScene(clonedScene, 1.9);
    configureCharacterMaterials(clonedScene);

    const actorWrapper = new THREE.Group();
    actorWrapper.name = 'CharacterActorWrapper';

    if (template.hasSkeleton) {
      const bonesByName = new Map<string, THREE.Bone>();
      const restPositions = new Map<string, THREE.Vector3>();
      const restRotations = new Map<string, THREE.Euler>();

      clonedScene.traverse((obj) => {
        if ((obj as THREE.Bone).isBone) {
          const b = obj as THREE.Bone;
          if (!bonesByName.has(b.name)) {
            bonesByName.set(b.name, b);
            restPositions.set(b.name, b.position.clone());
            restRotations.set(b.name, b.rotation.clone());
          }
        }
      });

      if (bonesByName.size > 0) {
        actorWrapper.add(clonedScene);
        snapInnerRootToFloorOrigin(actorWrapper, clonedScene);

        return {
          actorWrapper,
          innerRoot: clonedScene,
          bonesByName,
          restPositions,
          restRotations,
          nativeClips: template.animations,
          analysis: template.analysis,
          usedFallbackAutoRig: false,
          dispose: () => {
            // Only detach cloned hierarchy; shared template geometries/textures remain cached cleanly
            actorWrapper.clear();
          },
        };
      }
    }

    // Unskinned or missing-skeleton fallback: bind cleanly to provided BoneNodes
    const baked = flattenAndBakeGLBForRigging(clonedScene);
    const fallbackBones: BoneNode[] =
      customBones && customBones.length > 0
        ? customBones
        : [];

    if (fallbackBones.length > 0) {
      const bound = bindSkeletonToModelGroup(baked, fallbackBones);
      configureCharacterMaterials(bound.skinnedGroup);
      actorWrapper.add(bound.skinnedGroup);
      snapInnerRootToFloorOrigin(actorWrapper, bound.skinnedGroup);

      return {
        actorWrapper,
        innerRoot: bound.skinnedGroup,
        bonesByName: bound.bonesByName,
        restPositions: bound.restPositions,
        restRotations: bound.restRotations,
        nativeClips: template.animations,
        analysis: inspectSceneRig(bound.skinnedGroup),
        usedFallbackAutoRig: true,
        dispose: () => {
          bound.skinnedGroup.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const m = obj as THREE.Mesh;
              m.geometry?.dispose();
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              mats.forEach((mat) => mat?.dispose?.());
            }
          });
          actorWrapper.clear();
        },
      };
    }

    // Static fallback if neither native skeleton nor customBones exists
    actorWrapper.add(clonedScene);
    snapInnerRootToFloorOrigin(actorWrapper, clonedScene);
    return {
      actorWrapper,
      innerRoot: clonedScene,
      bonesByName: new Map(),
      restPositions: new Map(),
      restRotations: new Map(),
      nativeClips: template.animations,
      analysis: template.analysis,
      usedFallbackAutoRig: false,
      dispose: () => {
        actorWrapper.clear();
      },
    };
  }
}
