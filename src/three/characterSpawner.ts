import * as THREE from 'three';
import type { LoungeMember, RiggedModelConfig } from '../types';
import {
  buildAvatarSignature,
  resolveAvatarInstance,
  type ResolvedAvatar,
} from './avatarResolver';
import {
  createActorAnimState,
  type ActorAnimationState,
  type LocomotionMoveState,
} from './locomotion';

export interface SceneActor {
  member: LoungeMember;
  avatar: ResolvedAvatar;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetMoveState: LocomotionMoveState;
  targetSpeed: number;
  animState: ActorAnimationState;
}

export interface SpawnerCallbacks {
  onLoadingChange?: (loadingLabel: string | null) => void;
  onWarning?: (warning: string | null) => void;
}

/**
 * Race-safe actor spawner & live avatar hot-swapper for the 3D Lounge.
 * Tracks full `resolvedSignature` so actors that spawned as fallback before
 * Firestore `riggedModels` finished syncing automatically upgrade to custom GLBs
 * without duplicating meshes or resetting actor coordinates.
 */
export class CharacterSpawner {
  public readonly actors = new Map<string, SceneActor>();
  private readonly loadGen = new Map<string, number>();

  public syncMembers(
    scene: THREE.Scene,
    members: LoungeMember[],
    riggedModels: RiggedModelConfig[],
    selfClientId: string,
    callbacks?: SpawnerCallbacks,
  ): void {
    const activeIds = new Set(members.map((m) => m.clientId));

    // Remove departed actors cleanly
    for (const [id, actor] of this.actors.entries()) {
      if (!activeIds.has(id)) {
        scene.remove(actor.avatar.root);
        actor.avatar.dispose();
        this.actors.delete(id);
        this.loadGen.delete(id);
      }
    }

    for (const member of members) {
      const existing = this.actors.get(member.clientId);
      const isSelf = member.clientId === selfClientId;
      const desiredSig = buildAvatarSignature(
        member.equippedAvatarId,
        member.loyaltyRank,
        riggedModels,
      );

      if (!existing) {
        const gen = (this.loadGen.get(member.clientId) || 0) + 1;
        this.loadGen.set(member.clientId, gen);

        if (isSelf) {
          const match = riggedModels.find((r) => r.id === member.equippedAvatarId);
          callbacks?.onLoadingChange?.(match?.name || member.equippedAvatarId);
        }

        void resolveAvatarInstance(
          member.equippedAvatarId,
          member.loyaltyRank,
          riggedModels,
        ).then((avatar) => {
          if (this.loadGen.get(member.clientId) !== gen || this.actors.has(member.clientId)) {
            avatar.dispose();
            return;
          }

          if (isSelf) {
            callbacks?.onLoadingChange?.(null);
            callbacks?.onWarning?.(avatar.warning ?? null);
          }

          avatar.root.position.set(member.x, member.y, member.z);
          avatar.root.rotation.y = member.yaw;
          scene.add(avatar.root);

          this.actors.set(member.clientId, {
            member: { ...member },
            avatar,
            currentPos: new THREE.Vector3(member.x, member.y, member.z),
            targetPos: new THREE.Vector3(member.x, member.y, member.z),
            targetYaw: member.yaw,
            targetMoveState: member.moveState || 'idle',
            targetSpeed: member.speed || 0,
            animState: createActorAnimState(),
          });
        });
      } else {
        const needsSwap = existing.avatar.resolvedSignature !== desiredSig;
        existing.member = { ...existing.member, ...member };

        if (needsSwap) {
          const gen = (this.loadGen.get(member.clientId) || 0) + 1;
          this.loadGen.set(member.clientId, gen);

          if (isSelf) {
            const match = riggedModels.find((r) => r.id === member.equippedAvatarId);
            callbacks?.onLoadingChange?.(match?.name || member.equippedAvatarId);
          }

          void resolveAvatarInstance(
            member.equippedAvatarId,
            member.loyaltyRank,
            riggedModels,
          ).then((avatar) => {
            const latest = this.actors.get(member.clientId);
            if (!latest || this.loadGen.get(member.clientId) !== gen) {
              avatar.dispose();
              return;
            }

            if (isSelf) {
              callbacks?.onLoadingChange?.(null);
              callbacks?.onWarning?.(avatar.warning ?? null);
            }

            scene.remove(latest.avatar.root);
            latest.avatar.dispose();

            avatar.root.position.copy(latest.currentPos);
            avatar.root.rotation.y = latest.avatar.root.rotation.y;
            scene.add(avatar.root);
            latest.avatar = avatar;
          });
        }
      }
    }
  }

  public disposeAll(scene?: THREE.Scene): void {
    for (const actor of this.actors.values()) {
      scene?.remove(actor.avatar.root);
      actor.avatar.dispose();
    }
    this.actors.clear();
    this.loadGen.clear();
  }
}
