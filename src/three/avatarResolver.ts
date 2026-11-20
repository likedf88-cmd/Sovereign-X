import * as THREE from 'three';
import type { LoyaltyRank, RiggedModelConfig } from '../types';
import { createRiggedProceduralAvatar } from './proceduralAvatars';
import {
  CharacterAssetManager,
  type RigCompatibilityStatus,
} from './characterAssetManager';
import { AnimationStateMachine } from './animationStateMachine';
import { resolveHumanoidRole, type CanonicalHumanoidRole } from './riggingEngine';

export interface ResolvedAvatar {
  root: THREE.Group;
  bonesByName: Map<string, THREE.Bone>;
  restPositions: Map<string, THREE.Vector3>;
  restRotations?: Map<string, THREE.Euler>;
  mixer?: THREE.AnimationMixer;
  stateMachine?: AnimationStateMachine;
  nativeClips?: THREE.AnimationClip[];
  isCustomGLB: boolean;
  humanoidBoneCount: number;
  rigStatus: RigCompatibilityStatus;
  missingCoreRoles?: CanonicalHumanoidRole[];
  resolvedSignature: string;
  warning?: string;
  dispose: () => void;
}

function countHumanoidRoles(bonesByName: Map<string, THREE.Bone>): number {
  const roles = new Set<string>();
  for (const [name] of bonesByName.entries()) {
    const r = resolveHumanoidRole(name);
    if (r !== 'other') roles.add(r);
  }
  return roles.size;
}

export function buildAvatarSignature(
  avatarId: string,
  loyaltyRank: LoyaltyRank,
  riggedModels: RiggedModelConfig[],
): string {
  const custom = riggedModels.find((m) => m.id === avatarId);
  if (!custom) return `proc:${avatarId}:${loyaltyRank}`;
  return `custom:${custom.id}:${custom.sourceType}:${custom.modelEndpoint || ''}:${custom.bones.length}:${loyaltyRank}`;
}

export async function resolveAvatarInstance(
  avatarId: string,
  loyaltyRank: LoyaltyRank,
  riggedModels: RiggedModelConfig[],
): Promise<ResolvedAvatar> {
  const custom = riggedModels.find((m) => m.id === avatarId);
  const signature = buildAvatarSignature(avatarId, loyaltyRank, riggedModels);

  if (custom && custom.sourceType === 'glb-custom' && custom.modelEndpoint) {
    try {
      const prepared = await CharacterAssetManager.instantiateGLBCharacter(
        custom.modelEndpoint,
        custom.bones,
      );
      const stateMachine =
        prepared.bonesByName.size > 0
          ? new AnimationStateMachine(
              prepared.innerRoot,
              prepared.bonesByName,
              prepared.restPositions,
              prepared.restRotations,
              prepared.nativeClips,
            )
          : undefined;

      let warning: string | undefined;
      if (prepared.bonesByName.size === 0) {
        warning = `Custom GLB "${custom.name}" has no skeleton bones; spawned static mesh.`;
      } else if (prepared.analysis.rigStatus === 'partial-rig') {
        warning = `Custom GLB "${custom.name}" is missing core joints (${prepared.analysis.missingCoreRoles.slice(0, 3).join(', ')}); retargeted best-effort.`;
      }

      return {
        root: prepared.actorWrapper,
        bonesByName: prepared.bonesByName,
        restPositions: prepared.restPositions,
        restRotations: prepared.restRotations,
        mixer: stateMachine?.mixer,
        stateMachine,
        nativeClips: prepared.nativeClips,
        isCustomGLB: true,
        humanoidBoneCount: prepared.analysis.humanoidRoleCount,
        rigStatus: prepared.analysis.rigStatus,
        missingCoreRoles: prepared.analysis.missingCoreRoles,
        resolvedSignature: signature,
        warning,
        dispose: () => {
          stateMachine?.dispose();
          prepared.dispose();
        },
      };
    } catch (err) {
      const warning =
        err instanceof Error
          ? `Custom GLB "${custom.name}" failed to load (${err.message}); showing Sovereign fallback.`
          : `Custom GLB "${custom.name}" failed to load; showing Sovereign fallback.`;
      const fallback = createRiggedProceduralAvatar('avatar-sovereign-knight', loyaltyRank);
      const actorWrapper = new THREE.Group();
      actorWrapper.add(fallback.root);
      const restRotations = new Map<string, THREE.Euler>();
      fallback.bonesByName.forEach((b, k) => restRotations.set(k, b.rotation.clone()));
      const stateMachine = new AnimationStateMachine(
        fallback.root,
        fallback.bonesByName,
        fallback.restPositions,
        restRotations,
      );

      return {
        root: actorWrapper,
        bonesByName: fallback.bonesByName,
        restPositions: fallback.restPositions,
        restRotations,
        mixer: stateMachine.mixer,
        stateMachine,
        isCustomGLB: false,
        humanoidBoneCount: countHumanoidRoles(fallback.bonesByName),
        rigStatus: 'humanoid',
        resolvedSignature: signature,
        warning,
        dispose: () => {
          stateMachine.dispose();
          fallback.dispose();
          actorWrapper.clear();
        },
      };
    }
  }

  const resolvedPreset =
    custom?.sourceType === 'procedural-vanguard'
      ? 'avatar-nebula-visor'
      : custom?.sourceType === 'procedural-knight'
        ? 'avatar-sovereign-knight'
        : avatarId;

  const inst = createRiggedProceduralAvatar(resolvedPreset, loyaltyRank);
  const actorWrapper = new THREE.Group();
  actorWrapper.name = 'ProceduralActorWrapper';
  actorWrapper.add(inst.root);

  const restRotations = new Map<string, THREE.Euler>();
  inst.bonesByName.forEach((b, k) => restRotations.set(k, b.rotation.clone()));

  const stateMachine = new AnimationStateMachine(
    inst.root,
    inst.bonesByName,
    inst.restPositions,
    restRotations,
  );

  return {
    root: actorWrapper,
    bonesByName: inst.bonesByName,
    restPositions: inst.restPositions,
    restRotations,
    mixer: stateMachine.mixer,
    stateMachine,
    isCustomGLB: false,
    humanoidBoneCount: countHumanoidRoles(inst.bonesByName),
    rigStatus: 'humanoid',
    resolvedSignature: signature,
    dispose: () => {
      stateMachine.dispose();
      inst.dispose();
      actorWrapper.clear();
    },
  };
}
