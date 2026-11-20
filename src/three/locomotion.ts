import * as THREE from 'three';
import type { AvatarEmote } from '../types';
import { solveTwoBoneIK } from './ikSolver';
import { resolveHumanoidRole } from './riggingEngine';

export type LocomotionMoveState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'land'
  | 'turn';

export interface ArenaSurfaceZone {
  type: 'circle' | 'box';
  x: number;
  z: number;
  y: number;
  radius?: number;
  halfW?: number;
  halfD?: number;
}

/**
 * Shared Arena platform definitions so physics grounding and 3D architecture stay 1:1 aligned.
 */
export const ARENA_SURFACES: ArenaSurfaceZone[] = [
  // VIP Obsidian Throne Dais (Center Back)
  { type: 'circle', x: 0, z: -7.5, y: 0.36, radius: 4.2 },
  // Left Sky Platform
  { type: 'circle', x: -9.5, z: -8.5, y: 3.1, radius: 3.1 },
  // Right Sky Platform
  { type: 'circle', x: 9.5, z: -8.5, y: 3.1, radius: 3.1 },
  // Central Upper Sanctuary Bridge
  { type: 'box', x: 0, z: -10.5, y: 4.5, halfW: 3.0, halfD: 1.8 },
];

export function getArenaSurfaceHeight(x: number, z: number, currentY: number): number {
  let highest = 0;
  for (let i = 0; i < ARENA_SURFACES.length; i++) {
    const s = ARENA_SURFACES[i];
    // Only snap onto elevated surface if character feet are near or above surface top
    if (currentY + 0.45 < s.y) continue;
    if (s.type === 'circle' && s.radius !== undefined) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius && s.y > highest) {
        highest = s.y;
      }
    } else if (s.type === 'box' && s.halfW !== undefined && s.halfD !== undefined) {
      if (Math.abs(x - s.x) <= s.halfW && Math.abs(z - s.z) <= s.halfD && s.y > highest) {
        highest = s.y;
      }
    }
  }
  return highest;
}

export function shortestAngleDiff(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const diff = shortestAngleDiff(current, target);
  return current + diff * (1 - Math.exp(-lambda * dt));
}

export interface LocomotionSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  moveState: LocomotionMoveState;
  stridePhase: number;
  grounded: boolean;
  landImpulse: number;
  justLanded: boolean;
}

const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _wishDir = new THREE.Vector3();
const _clickDelta = new THREE.Vector3();

// Zero-GC scratch vectors for per-frame 2-bone foot grounding IK
const _footWorld = new THREE.Vector3();
const _kneeWorld = new THREE.Vector3();
const _poleWorld = new THREE.Vector3();
const _targetFoot = new THREE.Vector3();
const _forwardOffset = new THREE.Vector3();

/**
 * Smooth, acceleration-damped third-person humanoid locomotion controller
 * with sprint, turn-in-place detection, gravity, multi-tier platform grounding, and click-to-move steering.
 * Pre-allocates all scratch vectors for zero GC pressure in the 60fps render loop.
 */
export class LocomotionController {
  public pos = new THREE.Vector3(0, 0, 6.0);
  public vel = new THREE.Vector3(0, 0, 0);
  public yaw = Math.PI;
  public targetYaw = Math.PI;
  public speed = 0;
  public grounded = true;
  public moveState: LocomotionMoveState = 'idle';
  public stridePhase = 0;
  public landTimer = 0;
  public landImpulse = 0;
  public clickTarget: THREE.Vector3 | null = null;
  private dashTimer = 0;

  public triggerJump(impulse = 7.4): boolean {
    if (!this.grounded && this.vel.y > -0.25) return false;
    if (this.grounded) {
      this.vel.y = impulse;
      this.grounded = false;
      this.moveState = 'jump';
      return true;
    }
    return false;
  }

  public launchVertical(impulse: number): void {
    this.vel.y = Math.max(this.vel.y, impulse);
    this.grounded = false;
    this.moveState = 'jump';
  }

  public triggerDash(): boolean {
    if (this.dashTimer > 0) return false;
    this.dashTimer = 0.28;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.vel.x = fx * 13.5;
    this.vel.z = fz * 13.5;
    return true;
  }

  public step(
    dt: number,
    inputX: number,
    inputZ: number,
    sprint: boolean,
    camera: THREE.Camera,
  ): LocomotionSnapshot {
    const safeDt = Math.min(dt, 0.05);
    const wasGrounded = this.grounded;
    let justLanded = false;

    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - safeDt);
    if (this.landTimer > 0) this.landTimer = Math.max(0, this.landTimer - safeDt);

    const rawMag = Math.hypot(inputX, inputZ);
    const maxSpeed = this.dashTimer > 0 ? 13.2 : sprint ? 8.6 : 5.1;

    _wishDir.set(0, 0, 0);

    if (rawMag > 0.08) {
      this.clickTarget = null;
      camera.getWorldDirection(_camForward);
      _camForward.y = 0;
      if (_camForward.lengthSq() < 1e-5) _camForward.set(0, 0, -1);
      _camForward.normalize();
      _camRight.crossVectors(_camForward, _worldUp).normalize();

      const norm = Math.max(1, rawMag);
      _wishDir
        .addScaledVector(_camRight, inputX / norm)
        .addScaledVector(_camForward, -inputZ / norm);

      const wishLen = _wishDir.length();
      if (wishLen > 1e-4) {
        _wishDir.divideScalar(wishLen);
        this.targetYaw = Math.atan2(_wishDir.x, _wishDir.z);
      }
      const throttle = Math.min(1, rawMag);
      const targetVx = _wishDir.x * maxSpeed * throttle;
      const targetVz = _wishDir.z * maxSpeed * throttle;
      const accel = this.grounded ? 14 : 6.5;
      this.vel.x = THREE.MathUtils.damp(this.vel.x, targetVx, accel, safeDt);
      this.vel.z = THREE.MathUtils.damp(this.vel.z, targetVz, accel, safeDt);
    } else if (this.clickTarget) {
      _clickDelta.subVectors(this.clickTarget, this.pos);
      _clickDelta.y = 0;
      const dist = _clickDelta.length();
      if (dist > 0.25) {
        _clickDelta.divideScalar(dist);
        this.targetYaw = Math.atan2(_clickDelta.x, _clickDelta.z);
        const approachScale = dist < 1.2 ? Math.max(0.4, dist / 1.2) : 1.0;
        const cruiseSpeed = (sprint ? 8.0 : 5.0) * approachScale;
        this.vel.x = THREE.MathUtils.damp(this.vel.x, _clickDelta.x * cruiseSpeed, 12, safeDt);
        this.vel.z = THREE.MathUtils.damp(this.vel.z, _clickDelta.z * cruiseSpeed, 12, safeDt);
      } else {
        this.clickTarget = null;
        this.vel.x = THREE.MathUtils.damp(this.vel.x, 0, 16, safeDt);
        this.vel.z = THREE.MathUtils.damp(this.vel.z, 0, 16, safeDt);
      }
    } else if (this.dashTimer <= 0) {
      const friction = this.grounded ? 15 : 3;
      this.vel.x = THREE.MathUtils.damp(this.vel.x, 0, friction, safeDt);
      this.vel.z = THREE.MathUtils.damp(this.vel.z, 0, friction, safeDt);
    }

    // Apply horizontal position
    this.pos.x += this.vel.x * safeDt;
    this.pos.z += this.vel.z * safeDt;

    // Circular sanctuary perimeter clamp
    const rad = Math.hypot(this.pos.x, this.pos.z);
    if (rad > 23.5) {
      this.pos.x = (this.pos.x / rad) * 23.5;
      this.pos.z = (this.pos.z / rad) * 23.5;
    }

    // Vertical gravity & multi-tier surface collision
    const floorHeight = getArenaSurfaceHeight(this.pos.x, this.pos.z, this.pos.y);
    this.vel.y -= 18.5 * safeDt;
    this.pos.y += this.vel.y * safeDt;

    if (this.pos.y <= floorHeight) {
      if (!wasGrounded && this.vel.y < -3.0) {
        this.landTimer = 0.22;
        this.landImpulse = Math.min(1, Math.abs(this.vel.y) / 10);
        justLanded = true;
      }
      this.pos.y = floorHeight;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Smooth shortest-angle yaw interpolation
    const yawDiff = Math.abs(shortestAngleDiff(this.yaw, this.targetYaw));
    if (this.speed > 0.25 || yawDiff > 0.08) {
      this.yaw = dampAngle(this.yaw, this.targetYaw, 13, safeDt);
    }

    // Advance stride phase strictly proportional to ground travel so feet lock without sliding
    if (this.grounded && this.speed > 0.15) {
      this.stridePhase += this.speed * safeDt * 1.48;
    }

    // Compute locomotion state (including turn-in-place when pivoting sharply at low ground speed)
    if (!this.grounded) {
      this.moveState = this.vel.y > 0.6 ? 'jump' : 'fall';
    } else if (this.landTimer > 0 && this.speed < 1.2) {
      this.moveState = 'land';
    } else if (this.speed > 6.4) {
      this.moveState = 'sprint';
    } else if (this.speed > 3.6) {
      this.moveState = 'run';
    } else if (this.speed > 0.35) {
      this.moveState = 'walk';
    } else if (yawDiff > 0.35 && rawMag > 0.08) {
      this.moveState = 'turn';
    } else {
      this.moveState = 'idle';
    }

    return {
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      yaw: this.yaw,
      speed: this.speed,
      moveState: this.moveState,
      stridePhase: this.stridePhase,
      grounded: this.grounded,
      landImpulse: this.landTimer > 0 ? this.landImpulse * (this.landTimer / 0.22) : 0,
      justLanded,
    };
  }
}

export interface ActorAnimationState {
  stridePhase: number;
  smoothedSpeed: number;
  airBlend: number;
  landSquash: number;
  moveState: LocomotionMoveState;
  emote: AvatarEmote;
}

export function createActorAnimState(): ActorAnimationState {
  return {
    stridePhase: 0,
    smoothedSpeed: 0,
    airBlend: 0,
    landSquash: 0,
    moveState: 'idle',
    emote: 'idle',
  };
}

export function updateActorAnimState(
  anim: ActorAnimationState,
  targetSpeed: number,
  moveState: LocomotionMoveState,
  emote: AvatarEmote,
  dt: number,
): void {
  const safeDt = Math.min(dt, 0.05);
  anim.smoothedSpeed = THREE.MathUtils.damp(anim.smoothedSpeed, targetSpeed, 11, safeDt);
  anim.moveState = moveState;
  anim.emote = emote;

  const targetAir = moveState === 'jump' || moveState === 'fall' ? 1 : 0;
  anim.airBlend = THREE.MathUtils.damp(anim.airBlend, targetAir, 12, safeDt);

  const targetLand = moveState === 'land' ? 1 : 0;
  anim.landSquash = THREE.MathUtils.damp(anim.landSquash, targetLand, 16, safeDt);

  if (anim.smoothedSpeed > 0.12 && anim.airBlend < 0.6) {
    anim.stridePhase += anim.smoothedSpeed * safeDt * 1.48;
  }
}

/**
 * Post-mixer stance-foot grounding pass:
 * Samples real arena terrain elevation beneath left/right feet and applies lightweight
 * 2-bone leg IK whenever a grounded foot would sink below floor/dais height or float on a step edge.
 */
export function applyFootPlacementIK(
  actorRoot: THREE.Object3D,
  bonesByName: Map<string, THREE.Bone>,
  actorY: number,
  actorYaw: number,
  grounded: boolean,
): void {
  if (!grounded || bonesByName.size === 0) return;

  let lUpLeg: THREE.Bone | undefined;
  let lLeg: THREE.Bone | undefined;
  let lFoot: THREE.Bone | undefined;
  let rUpLeg: THREE.Bone | undefined;
  let rLeg: THREE.Bone | undefined;
  let rFoot: THREE.Bone | undefined;

  for (const [name, bone] of bonesByName.entries()) {
    const role = resolveHumanoidRole(name);
    if (role === 'leftUpLeg' && !lUpLeg) lUpLeg = bone;
    else if (role === 'leftLeg' && !lLeg) lLeg = bone;
    else if (role === 'leftFoot' && !lFoot) lFoot = bone;
    else if (role === 'rightUpLeg' && !rUpLeg) rUpLeg = bone;
    else if (role === 'rightLeg' && !rLeg) rLeg = bone;
    else if (role === 'rightFoot' && !rFoot) rFoot = bone;
  }

  actorRoot.updateMatrixWorld(true);
  _forwardOffset.set(Math.sin(actorYaw), 0, Math.cos(actorYaw));

  const adjustLeg = (up?: THREE.Bone, mid?: THREE.Bone, end?: THREE.Bone) => {
    if (!up || !mid || !end) return;
    end.getWorldPosition(_footWorld);
    const groundY = getArenaSurfaceHeight(_footWorld.x, _footWorld.z, actorY);
    const minFootY = groundY + 0.065;
    const deltaY = minFootY - _footWorld.y;
    if (deltaY > 0.015 && deltaY < 0.42) {
      mid.getWorldPosition(_kneeWorld);
      _poleWorld.copy(_kneeWorld).addScaledVector(_forwardOffset, 0.35);
      _targetFoot.copy(_footWorld);
      _targetFoot.y = minFootY;
      solveTwoBoneIK(up, mid, end, _targetFoot, _poleWorld, 0.72);
    }
  };

  adjustLeg(lUpLeg, lLeg, lFoot);
  adjustLeg(rUpLeg, rLeg, rFoot);
}

