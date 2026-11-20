import * as THREE from 'three';
import type { AvatarEmote } from '../types';
import type { LocomotionMoveState } from './locomotion';
import { resolveHumanoidRole, type CanonicalHumanoidRole } from './riggingEngine';

export type AnimationMotionState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'land'
  | 'turn'
  | 'wave'
  | 'dance'
  | 'hero'
  | 'combat';

export interface AnalyzedSkeletonMap {
  roleToBone: Map<CanonicalHumanoidRole, THREE.Bone>;
  boneToRole: Map<string, CanonicalHumanoidRole>;
  restWorldQuatByBone: Map<string, THREE.Quaternion>;
  restLocalQuatByBone: Map<string, THREE.Quaternion>;
  restLocalPosByBone: Map<string, THREE.Vector3>;
  /** Rest arm elevation angle from straight-down (-Y) in radians (0 = arms down, ~1.57 = T-pose) */
  leftArmRestSpreadRad: number;
  rightArmRestSpreadRad: number;
  hipsRestHeight: number;
}

const _vParent = new THREE.Vector3();
const _vChild = new THREE.Vector3();
const _vLimb = new THREE.Vector3();
const _downVec = new THREE.Vector3(0, -1, 0);
const _qWorldRest = new THREE.Quaternion();
const _qWorldRestInv = new THREE.Quaternion();
const _qCharDelta = new THREE.Quaternion();
const _qLocalDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _eulerTmp = new THREE.Euler(0, 0, 0, 'XYZ');

function measureArmSpreadFromDown(upperBone: THREE.Bone | undefined, childBone: THREE.Bone | undefined): number {
  if (!upperBone || !childBone) return 0.16;
  upperBone.updateMatrixWorld(true);
  childBone.updateMatrixWorld(true);
  upperBone.getWorldPosition(_vParent);
  childBone.getWorldPosition(_vChild);
  _vLimb.subVectors(_vChild, _vParent);
  if (_vLimb.lengthSq() < 1e-6) return 0.16;
  _vLimb.normalize();
  return THREE.MathUtils.clamp(_vLimb.angleTo(_downVec), 0, Math.PI * 0.65);
}

/**
 * Inspects any live Three.js bone map (native GLB or auto-rigged) in its current rest pose
 * and computes per-bone world/local rest orientations + T-pose arm spread angles.
 */
export function analyzeSkeletonForRetargeting(
  root: THREE.Object3D,
  bonesByName: Map<string, THREE.Bone>,
  restPositions?: Map<string, THREE.Vector3>,
  restRotations?: Map<string, THREE.Euler>,
): AnalyzedSkeletonMap {
  // Temporarily ensure bones are strictly in rest pose before capturing rest world quaternions
  for (const [name, bone] of bonesByName.entries()) {
    const rr = restRotations?.get(name);
    if (rr) bone.rotation.copy(rr);
    const rp = restPositions?.get(name);
    if (rp) bone.position.copy(rp);
  }
  root.updateMatrixWorld(true);

  const roleToBone = new Map<CanonicalHumanoidRole, THREE.Bone>();
  const boneToRole = new Map<string, CanonicalHumanoidRole>();
  const restWorldQuatByBone = new Map<string, THREE.Quaternion>();
  const restLocalQuatByBone = new Map<string, THREE.Quaternion>();
  const restLocalPosByBone = new Map<string, THREE.Vector3>();

  for (const [name, bone] of bonesByName.entries()) {
    const role = resolveHumanoidRole(name);
    if (role !== 'other') {
      boneToRole.set(name, role);
      if (!roleToBone.has(role)) {
        roleToBone.set(role, bone);
      }
    }
    const wq = new THREE.Quaternion();
    bone.getWorldQuaternion(wq);
    restWorldQuatByBone.set(name, wq);
    restLocalQuatByBone.set(name, bone.quaternion.clone());
    restLocalPosByBone.set(name, bone.position.clone());
  }

  const lArm = roleToBone.get('leftArm');
  const lForearm = roleToBone.get('leftForearm');
  const rArm = roleToBone.get('rightArm');
  const rForearm = roleToBone.get('rightForearm');
  const hips = roleToBone.get('hips');

  let hipsRestHeight = 0.96;
  if (hips) {
    const hp = new THREE.Vector3();
    hips.getWorldPosition(hp);
    const rp = new THREE.Vector3();
    root.getWorldPosition(rp);
    hipsRestHeight = Math.max(0.45, hp.y - rp.y);
  }

  return {
    roleToBone,
    boneToRole,
    restWorldQuatByBone,
    restLocalQuatByBone,
    restLocalPosByBone,
    leftArmRestSpreadRad: measureArmSpreadFromDown(lArm, lForearm),
    rightArmRestSpreadRad: measureArmSpreadFromDown(rArm, rForearm),
    hipsRestHeight,
  };
}

/**
 * Transforms a canonical humanoid character-space rotation `(rx, ry, rz)`
 * (+X = limb swing forward / torso pitch forward, +Y = turn left, +Z = left abduction / roll)
 * into the target bone's exact local quaternion space:
 *   Q_local = Q_local_rest * (R_world_rest^-1 * D_char * R_world_rest)
 */
function characterEulerToBoneLocalQuat(
  boneName: string,
  rx: number,
  ry: number,
  rz: number,
  analyzed: AnalyzedSkeletonMap,
): THREE.Quaternion {
  const localRest = analyzed.restLocalQuatByBone.get(boneName);
  const worldRest = analyzed.restWorldQuatByBone.get(boneName);
  if (!localRest || !worldRest) {
    _eulerTmp.set(rx, ry, rz, 'XYZ');
    return _qOut.setFromEuler(_eulerTmp).clone();
  }

  _eulerTmp.set(rx, ry, rz, 'XYZ');
  _qCharDelta.setFromEuler(_eulerTmp);
  _qWorldRest.copy(worldRest);
  _qWorldRestInv.copy(worldRest).invert();

  _qLocalDelta.copy(_qWorldRestInv).multiply(_qCharDelta).multiply(_qWorldRest);
  return _qOut.copy(localRest).multiply(_qLocalDelta).clone();
}

interface CanonicalFramePose {
  hipsOffsetY?: number;
  hipsRot?: [number, number, number];
  spineRot?: [number, number, number];
  chestRot?: [number, number, number];
  neckRot?: [number, number, number];
  headRot?: [number, number, number];
  leftShoulderRot?: [number, number, number];
  rightShoulderRot?: [number, number, number];
  leftArmRot?: [number, number, number];
  rightArmRot?: [number, number, number];
  leftForearmRot?: [number, number, number];
  rightForearmRot?: [number, number, number];
  leftHandRot?: [number, number, number];
  rightHandRot?: [number, number, number];
  leftUpLegRot?: [number, number, number];
  rightUpLegRot?: [number, number, number];
  leftLegRot?: [number, number, number];
  rightLegRot?: [number, number, number];
  leftFootRot?: [number, number, number];
  rightFootRot?: [number, number, number];
  leftToeRot?: [number, number, number];
  rightToeRot?: [number, number, number];
}

function evaluateCanonicalStatePose(
  state: AnimationMotionState,
  u: number, // normalized clip phase [0, 1]
  lArmDownComp: number,
  rArmDownComp: number,
): CanonicalFramePose {
  const twoPi = Math.PI * 2;
  const p = u * twoPi;
  const sinP = Math.sin(p);
  const cosP = Math.cos(p);

  switch (state) {
    case 'idle': {
      const breath = Math.sin(p);
      return {
        hipsOffsetY: breath * 0.012,
        spineRot: [breath * 0.015, 0, 0],
        chestRot: [breath * 0.025, Math.sin(p * 0.5) * 0.02, 0],
        neckRot: [-breath * 0.015, Math.sin(p * 0.5) * 0.03, 0],
        headRot: [breath * 0.01, Math.sin(p * 0.5) * 0.05, 0],
        leftArmRot: [0.04, 0, -lArmDownComp + 0.08 + breath * 0.02],
        rightArmRot: [0.04, 0, rArmDownComp - 0.08 - breath * 0.02],
        leftForearmRot: [-0.22, 0, 0],
        rightForearmRot: [-0.22, 0, 0],
        leftUpLegRot: [-0.03, 0.04, 0.03],
        rightUpLegRot: [-0.03, -0.04, -0.03],
        leftLegRot: [0.06, 0, 0],
        rightLegRot: [0.06, 0, 0],
      };
    }

    case 'turn': {
      const shift = Math.sin(p);
      return {
        hipsOffsetY: -0.02 + Math.abs(shift) * 0.02,
        hipsRot: [0.02, shift * 0.14, 0],
        spineRot: [0.04, -shift * 0.08, 0],
        chestRot: [0.04, -shift * 0.12, 0],
        headRot: [0, shift * 0.16, 0],
        leftArmRot: [-shift * 0.14, 0, -lArmDownComp + 0.12],
        rightArmRot: [shift * 0.14, 0, rArmDownComp - 0.12],
        leftForearmRot: [-0.28, 0, 0],
        rightForearmRot: [-0.28, 0, 0],
        leftUpLegRot: [shift * 0.22, 0.06, 0.04],
        rightUpLegRot: [-shift * 0.22, -0.06, -0.04],
        leftLegRot: [Math.max(0, shift) * 0.42 + 0.08, 0, 0],
        rightLegRot: [Math.max(0, -shift) * 0.42 + 0.08, 0, 0],
      };
    }

    case 'walk':
    case 'run':
    case 'sprint': {
      const isRun = state === 'run';
      const isSprint = state === 'sprint';
      const legAmp = isSprint ? 0.92 : isRun ? 0.72 : 0.46;
      const armAmp = isSprint ? 0.98 : isRun ? 0.78 : 0.44;
      const leanX = isSprint ? 0.26 : isRun ? 0.16 : 0.05;
      const bounce = isSprint ? 0.075 : isRun ? 0.055 : 0.026;
      const kneeBase = isSprint ? 1.05 : isRun ? 0.85 : 0.56;

      // Three.js humanoid legs bend forward at thigh (+X or -X? In Three.js +Z forward: rotating right-side X negative swings leg forward!)
      // Keep sign convention matching proceduralAvatars.ts: negative X rotation on UpLeg brings thigh FORWARD toward +Z; positive X rotation on Leg bends knee BACKWARD.
      const lKnee = Math.max(0, -cosP) * kneeBase + Math.max(0, -sinP) * 0.35;
      const rKnee = Math.max(0, cosP) * kneeBase + Math.max(0, sinP) * 0.35;

      return {
        hipsOffsetY: Math.abs(cosP) * bounce - bounce * 0.45,
        hipsRot: [0, sinP * (isRun || isSprint ? 0.14 : 0.08), cosP * 0.035],
        spineRot: [leanX * 0.65, -sinP * 0.06, 0],
        chestRot: [leanX * 0.45, -sinP * (isRun || isSprint ? 0.16 : 0.09), 0],
        neckRot: [-leanX * 0.35, sinP * 0.04, 0],
        headRot: [-leanX * 0.25, 0, 0],
        leftShoulderRot: [0, -sinP * 0.06, 0],
        rightShoulderRot: [0, -sinP * 0.06, 0],
        leftUpLegRot: [-sinP * legAmp, 0, 0],
        rightUpLegRot: [sinP * legAmp, 0, 0],
        leftLegRot: [lKnee, 0, 0],
        rightLegRot: [rKnee, 0, 0],
        leftFootRot: [sinP * 0.24 - lKnee * 0.28, 0, 0],
        rightFootRot: [-sinP * 0.24 - rKnee * 0.28, 0, 0],
        leftToeRot: [Math.max(0, -sinP * 0.32), 0, 0],
        rightToeRot: [Math.max(0, sinP * 0.32), 0, 0],
        leftArmRot: [sinP * armAmp, 0, -lArmDownComp + 0.08],
        rightArmRot: [-sinP * armAmp, 0, rArmDownComp - 0.08],
        leftForearmRot: [-0.36 - (isSprint ? 0.65 : isRun ? 0.45 : 0.15) - Math.max(0, -sinP) * 0.3, 0, 0],
        rightForearmRot: [-0.36 - (isSprint ? 0.65 : isRun ? 0.45 : 0.15) - Math.max(0, sinP) * 0.3, 0, 0],
      };
    }

    case 'jump': {
      const sway = Math.sin(p) * 0.06;
      return {
        hipsOffsetY: 0.04,
        spineRot: [-0.08, 0, 0],
        chestRot: [-0.08, 0, 0],
        headRot: [-0.1, 0, 0],
        leftUpLegRot: [-0.55 + sway, 0, 0.08],
        rightUpLegRot: [-0.24 - sway, 0, -0.08],
        leftLegRot: [0.92, 0, 0],
        rightLegRot: [0.46, 0, 0],
        leftFootRot: [0.35, 0, 0],
        rightFootRot: [0.28, 0, 0],
        leftArmRot: [-0.45, 0, -lArmDownComp + 0.85 + sway],
        rightArmRot: [-0.45, 0, rArmDownComp - 0.85 - sway],
        leftForearmRot: [-0.55, 0, 0],
        rightForearmRot: [-0.55, 0, 0],
      };
    }

    case 'fall': {
      const flutter = Math.sin(p) * 0.08;
      return {
        hipsOffsetY: 0.02,
        spineRot: [0.1, 0, 0],
        chestRot: [0.06, 0, 0],
        headRot: [0.12, 0, 0],
        leftUpLegRot: [-0.32 + flutter, 0, 0.12],
        rightUpLegRot: [-0.44 - flutter, 0, -0.12],
        leftLegRot: [0.58, 0, 0],
        rightLegRot: [0.82, 0, 0],
        leftFootRot: [0.32, 0, 0],
        rightFootRot: [0.32, 0, 0],
        leftArmRot: [-0.22, 0, -lArmDownComp + 1.05 + flutter],
        rightArmRot: [-0.22, 0, rArmDownComp - 1.05 - flutter],
        leftForearmRot: [-0.42, 0, 0],
        rightForearmRot: [-0.42, 0, 0],
      };
    }

    case 'land': {
      const env = Math.sin(Math.min(1, u) * Math.PI);
      return {
        hipsOffsetY: -0.16 * env,
        spineRot: [0.22 * env, 0, 0],
        chestRot: [0.14 * env, 0, 0],
        headRot: [-0.14 * env, 0, 0],
        leftUpLegRot: [-0.52 * env, 0, 0.06],
        rightUpLegRot: [-0.52 * env, 0, -0.06],
        leftLegRot: [0.98 * env, 0, 0],
        rightLegRot: [0.98 * env, 0, 0],
        leftFootRot: [-0.42 * env, 0, 0],
        rightFootRot: [-0.42 * env, 0, 0],
        leftArmRot: [0.25 * env, 0, -lArmDownComp + 0.35 * env],
        rightArmRot: [0.25 * env, 0, rArmDownComp - 0.35 * env],
        leftForearmRot: [-0.55 * env, 0, 0],
        rightForearmRot: [-0.55 * env, 0, 0],
      };
    }

    case 'wave': {
      const waveSwing = Math.sin(p * 2);
      return {
        hipsOffsetY: Math.sin(p) * 0.015,
        chestRot: [0, -0.16, 0.05],
        headRot: [-0.06, 0.14, 0.04],
        leftArmRot: [0.05, 0, -lArmDownComp + 0.12],
        rightArmRot: [-0.35, 0, rArmDownComp - 2.35 + waveSwing * 0.18],
        leftForearmRot: [-0.2, 0, 0],
        rightForearmRot: [-0.28, 0, -0.62 - waveSwing * 0.42],
        rightHandRot: [0, 0, waveSwing * 0.3],
      };
    }

    case 'dance': {
      const groove = Math.sin(p * 2);
      const step = Math.cos(p);
      return {
        hipsOffsetY: -Math.abs(groove) * 0.055,
        hipsRot: [0, Math.sin(p) * 0.24, groove * 0.09],
        spineRot: [0.05, -Math.sin(p) * 0.14, 0],
        chestRot: [0.06, Math.sin(p) * 0.18, -groove * 0.08],
        headRot: [Math.sin(p * 2) * 0.08, Math.sin(p) * 0.12, 0],
        leftUpLegRot: [-0.14 - Math.max(0, step) * 0.24, 0, 0.06],
        rightUpLegRot: [-0.14 - Math.max(0, -step) * 0.24, 0, -0.06],
        leftLegRot: [0.28 + Math.max(0, step) * 0.38, 0, 0],
        rightLegRot: [0.28 + Math.max(0, -step) * 0.38, 0, 0],
        leftArmRot: [-0.45 + Math.sin(p) * 0.35, 0, -lArmDownComp + 0.85],
        rightArmRot: [-0.45 - Math.sin(p) * 0.35, 0, rArmDownComp - 0.85],
        leftForearmRot: [-0.72 + groove * 0.22, 0, 0],
        rightForearmRot: [-0.72 - groove * 0.22, 0, 0],
      };
    }

    case 'hero': {
      const breath = Math.sin(p);
      return {
        hipsOffsetY: breath * 0.01,
        hipsRot: [0, 0.14, 0],
        chestRot: [-0.08 + breath * 0.02, -0.14, 0],
        headRot: [-0.04, 0.08, 0],
        leftArmRot: [0.1, 0, -lArmDownComp + 0.22],
        rightArmRot: [0.16, 0, rArmDownComp - 0.22],
        leftForearmRot: [-0.42, 0, 0],
        rightForearmRot: [-0.46, 0, 0],
        leftUpLegRot: [-0.08, 0.08, 0.12],
        rightUpLegRot: [0.12, -0.08, -0.12],
        leftLegRot: [0.14, 0, 0],
        rightLegRot: [0.08, 0, 0],
      };
    }

    case 'combat': {
      const pulse = Math.sin(p);
      return {
        hipsOffsetY: -0.06 + Math.abs(pulse) * 0.018,
        hipsRot: [0.06, 0.42, 0],
        spineRot: [0.14, -0.18, 0],
        chestRot: [0.12, -0.22, 0],
        headRot: [-0.14, 0.12, 0],
        leftUpLegRot: [-0.34, 0.12, 0.14],
        rightUpLegRot: [0.22, -0.18, -0.14],
        leftLegRot: [0.56, 0, 0],
        rightLegRot: [0.36, 0, 0],
        leftArmRot: [-0.82 + pulse * 0.08, 0.35, -lArmDownComp + 0.38],
        rightArmRot: [-0.62 - pulse * 0.08, -0.35, rArmDownComp - 0.32],
        leftForearmRot: [-1.18, 0, 0],
        rightForearmRot: [-1.35, 0, 0],
      };
    }
  }
}

const CLIP_DEFINITIONS: Array<{
  state: AnimationMotionState;
  duration: number;
  fps: number;
}> = [
  { state: 'idle', duration: 2.8, fps: 18 },
  { state: 'walk', duration: 1.0, fps: 24 },
  { state: 'run', duration: 0.68, fps: 24 },
  { state: 'sprint', duration: 0.52, fps: 26 },
  { state: 'jump', duration: 0.9, fps: 20 },
  { state: 'fall', duration: 0.8, fps: 20 },
  { state: 'land', duration: 0.32, fps: 24 },
  { state: 'turn', duration: 0.72, fps: 22 },
  { state: 'wave', duration: 1.8, fps: 22 },
  { state: 'dance', duration: 1.6, fps: 24 },
  { state: 'hero', duration: 2.6, fps: 18 },
  { state: 'combat', duration: 1.4, fps: 22 },
];

const ROLE_ROT_KEY_MAP: Array<[CanonicalHumanoidRole, keyof CanonicalFramePose]> = [
  ['hips', 'hipsRot'],
  ['spine', 'spineRot'],
  ['chest', 'chestRot'],
  ['neck', 'neckRot'],
  ['head', 'headRot'],
  ['leftShoulder', 'leftShoulderRot'],
  ['rightShoulder', 'rightShoulderRot'],
  ['leftArm', 'leftArmRot'],
  ['rightArm', 'rightArmRot'],
  ['leftForearm', 'leftForearmRot'],
  ['rightForearm', 'rightForearmRot'],
  ['leftHand', 'leftHandRot'],
  ['rightHand', 'rightHandRot'],
  ['leftUpLeg', 'leftUpLegRot'],
  ['rightUpLeg', 'rightUpLegRot'],
  ['leftLeg', 'leftLegRot'],
  ['rightLeg', 'rightLegRot'],
  ['leftFoot', 'leftFootRot'],
  ['rightFoot', 'rightFootRot'],
  ['leftToe', 'leftToeRot'],
  ['rightToe', 'rightToeRot'],
];

const NATIVE_CLIP_MATCHERS: Record<AnimationMotionState, RegExp> = {
  idle: /idle|stand|breath/i,
  walk: /walk|stroll/i,
  run: /\brun\b|jog/i,
  sprint: /sprint|dash|fast_run/i,
  jump: /jump|hop/i,
  fall: /fall|air/i,
  land: /land/i,
  turn: /turn|pivot/i,
  wave: /wave|greet|hello/i,
  dance: /dance|groove/i,
  hero: /hero|victory|pose/i,
  combat: /combat|fight|attack|slash|ready/i,
};

function clipHasValidTracksForBones(
  clip: THREE.AnimationClip,
  bonesByName: Map<string, THREE.Bone>,
): boolean {
  let matched = 0;
  for (const track of clip.tracks) {
    const boneName = track.name.split('.')[0];
    if (bonesByName.has(boneName)) matched += 1;
  }
  return matched >= 4;
}

/**
 * Compiles rest-pose-aware retargeted THREE.AnimationClips for every locomotion & emote state,
 * preferring matching native GLB clips when present and valid.
 */
export function buildRetargetedClipSet(
  root: THREE.Object3D,
  bonesByName: Map<string, THREE.Bone>,
  restPositions?: Map<string, THREE.Vector3>,
  restRotations?: Map<string, THREE.Euler>,
  nativeClips: THREE.AnimationClip[] = [],
  preferNativeClips = true,
): Map<AnimationMotionState, THREE.AnimationClip> {
  const analyzed = analyzeSkeletonForRetargeting(root, bonesByName, restPositions, restRotations);

  // Automatic T-pose -> natural arms-down rest compensation:
  // If rest upper arms extend wide (>= 0.35 rad from -Y), compute exact downward rotation offset
  // Note: leftArm sits at +X so rotating around Z by -angle drops it; rightArm at -X drops by +angle.
  const lArmDownComp = Math.max(0, analyzed.leftArmRestSpreadRad - 0.12);
  const rArmDownComp = Math.max(0, analyzed.rightArmRestSpreadRad - 0.12);

  const clips = new Map<AnimationMotionState, THREE.AnimationClip>();

  for (const def of CLIP_DEFINITIONS) {
    if (preferNativeClips && nativeClips.length > 0) {
      const matcher = NATIVE_CLIP_MATCHERS[def.state];
      const nativeMatch = nativeClips.find(
        (c) => matcher.test(c.name) && clipHasValidTracksForBones(c, bonesByName),
      );
      if (nativeMatch) {
        clips.set(def.state, nativeMatch);
        continue;
      }
    }

    const sampleCount = Math.max(6, Math.round(def.duration * def.fps) + 1);
    const times: number[] = [];
    const rotByRole = new Map<CanonicalHumanoidRole, number[]>();
    const hipsPosValues: number[] = [];

    for (const [role] of ROLE_ROT_KEY_MAP) {
      if (analyzed.roleToBone.has(role)) {
        rotByRole.set(role, []);
      }
    }

    const hipsBone = analyzed.roleToBone.get('hips');
    const hipsRestPos = hipsBone ? analyzed.restLocalPosByBone.get(hipsBone.name) : undefined;
    // Scale hips vertical bob relative to bone local units (handles cm vs meter GLBs!)
    const hipsPosScale = hipsRestPos && hipsRestPos.y > 10 ? 100 : 1;

    for (let s = 0; s < sampleCount; s++) {
      const u = s / (sampleCount - 1);
      times.push(u * def.duration);
      const frame = evaluateCanonicalStatePose(def.state, u, lArmDownComp, rArmDownComp);

      for (const [role, key] of ROLE_ROT_KEY_MAP) {
        const bone = analyzed.roleToBone.get(role);
        const arr = rotByRole.get(role);
        if (!bone || !arr) continue;

        const rot = frame[key] as [number, number, number] | undefined;
        const q = rot
          ? characterEulerToBoneLocalQuat(bone.name, rot[0], rot[1], rot[2], analyzed)
          : analyzed.restLocalQuatByBone.get(bone.name) || new THREE.Quaternion();
        arr.push(q.x, q.y, q.z, q.w);
      }

      if (hipsBone && hipsRestPos) {
        const dy = (frame.hipsOffsetY ?? 0) * hipsPosScale;
        hipsPosValues.push(hipsRestPos.x, hipsRestPos.y + dy, hipsRestPos.z);
      }
    }

    const tracks: THREE.KeyframeTrack[] = [];
    for (const [role, arr] of rotByRole.entries()) {
      const bone = analyzed.roleToBone.get(role);
      if (bone && arr.length === times.length * 4) {
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, arr));
      }
    }

    if (hipsBone && hipsPosValues.length === times.length * 3) {
      tracks.push(new THREE.VectorKeyframeTrack(`${hipsBone.name}.position`, times, hipsPosValues));
    }

    clips.set(def.state, new THREE.AnimationClip(`Retarget_${def.state}`, def.duration, tracks));
  }

  return clips;
}

export function resolveDesiredMotionState(
  moveState: LocomotionMoveState,
  emote: AvatarEmote,
): AnimationMotionState {
  if (moveState === 'jump') return 'jump';
  if (moveState === 'fall') return 'fall';
  if (moveState === 'land') return 'land';
  if (moveState === 'sprint') return 'sprint';
  if (moveState === 'run') return 'run';
  if (moveState === 'walk') return 'walk';
  if (moveState === 'turn') return 'turn';

  // Idle locomotion: show equipped emote if active
  if (emote === 'wave' || emote === 'dance' || emote === 'hero' || emote === 'combat') {
    return emote;
  }
  if (emote === 'walk' || emote === 'run' || emote === 'jump') {
    return emote;
  }
  return 'idle';
}
