import * as THREE from 'three';
import type { AvatarEmote, LoyaltyRank } from '../types';
import { resolveHumanoidRole, type CanonicalHumanoidRole } from './riggingEngine';
import type { ActorAnimationState } from './locomotion';

function findBoneByRole(
  bonesByName: Map<string, THREE.Bone>,
  exactName: string,
  role: CanonicalHumanoidRole,
): THREE.Bone | undefined {
  const exact = bonesByName.get(exactName);
  if (exact) return exact;
  for (const [, bone] of bonesByName.entries()) {
    if (resolveHumanoidRole(bone.name) === role) return bone;
  }
  return undefined;
}

export interface AvatarStylePalette {
  armor: number;
  secondary: number;
  accent: number;
  visor: number;
}

const PRESET_PALETTES: Record<string, AvatarStylePalette> = {
  'avatar-sovereign-knight': {
    armor: 0x111827,
    secondary: 0x1e3a8a,
    accent: 0xd4af37,
    visor: 0x38bdf8,
  },
  'avatar-nebula-visor': {
    armor: 0xe2e8f0,
    secondary: 0x1d4ed8,
    accent: 0x60a5fa,
    visor: 0x0ea5e9,
  },
  'avatar-obsidian-sentinel': {
    armor: 0x090d16,
    secondary: 0x334155,
    accent: 0x3b82f6,
    visor: 0x93c5fd,
  },
  'avatar-crimson-apex': {
    armor: 0x1f1215,
    secondary: 0x991b1b,
    accent: 0xf59e0b,
    visor: 0xfbbf24,
  },
};

const RANK_AURA_COLORS: Record<LoyaltyRank, number> = {
  Squire: 0x64748b,
  Sentinel: 0x38bdf8,
  Vanguard: 0x3b82f6,
  Sovereign: 0xd4af37,
};

export interface RiggedAvatarInstance {
  root: THREE.Group;
  bonesByName: Map<string, THREE.Bone>;
  restPositions: Map<string, THREE.Vector3>;
  auraRing: THREE.Mesh;
  dispose: () => void;
}

export function createRiggedProceduralAvatar(
  presetId = 'avatar-sovereign-knight',
  loyaltyRank: LoyaltyRank = 'Vanguard',
): RiggedAvatarInstance {
  const palette = PRESET_PALETTES[presetId] ?? PRESET_PALETTES['avatar-sovereign-knight'];
  const root = new THREE.Group();
  root.name = `Avatar_${presetId}`;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const armorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.armor,
      metalness: 0.72,
      roughness: 0.24,
    }),
  );
  const fabricMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.15,
      roughness: 0.72,
    }),
  );
  const accentMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: palette.accent,
      metalness: 0.92,
      roughness: 0.16,
      clearcoat: 0.8,
    }),
  );
  const visorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.visor,
      emissive: palette.visor,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      metalness: 0.2,
    }),
  );

  // Full 33-bone articulated skeletal hierarchy (Head, Jaw, Hands, 5 Fingers/hand, Feet, Toes)
  const bonesByName = new Map<string, THREE.Bone>();
  const restPositions = new Map<string, THREE.Vector3>();

  const makeBone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bonesByName.set(name, b);
    restPositions.set(name, b.position.clone());
    return b;
  };

  const hips = makeBone('Hips', root, 0, 0.98, 0);
  const spine = makeBone('Spine', hips, 0, 0.18, 0);
  const chest = makeBone('Chest', spine, 0, 0.22, 0);
  const neck = makeBone('Neck', chest, 0, 0.2, 0);
  const head = makeBone('Head', neck, 0, 0.12, 0);
  const jaw = makeBone('Jaw', head, 0, 0.02, 0.06);

  const lShoulder = makeBone('LeftShoulder', chest, 0.14, 0.14, 0);
  const lArm = makeBone('LeftArm', lShoulder, 0.12, -0.02, 0);
  const lForearm = makeBone('LeftForearm', lArm, 0, -0.28, 0);
  const lHand = makeBone('LeftHand', lForearm, 0, -0.26, 0);
  const lThumb = makeBone('LeftThumb', lHand, 0.02, -0.02, 0.04);
  const lIndex = makeBone('LeftIndex', lHand, 0.012, -0.055, 0.03);
  const lMiddle = makeBone('LeftMiddle', lHand, 0.012, -0.06, 0.008);
  const lRing = makeBone('LeftRing', lHand, 0.012, -0.056, -0.014);
  const lPinky = makeBone('LeftPinky', lHand, 0.01, -0.048, -0.034);

  const rShoulder = makeBone('RightShoulder', chest, -0.14, 0.14, 0);
  const rArm = makeBone('RightArm', rShoulder, -0.12, -0.02, 0);
  const rForearm = makeBone('RightForearm', rArm, 0, -0.28, 0);
  const rHand = makeBone('RightHand', rForearm, 0, -0.26, 0);
  const rThumb = makeBone('RightThumb', rHand, -0.02, -0.02, 0.04);
  const rIndex = makeBone('RightIndex', rHand, -0.012, -0.055, 0.03);
  const rMiddle = makeBone('RightMiddle', rHand, -0.012, -0.06, 0.008);
  const rRing = makeBone('RightRing', rHand, -0.012, -0.056, -0.014);
  const rPinky = makeBone('RightPinky', rHand, -0.01, -0.048, -0.034);

  const lUpLeg = makeBone('LeftUpLeg', hips, 0.11, -0.06, 0);
  const lLeg = makeBone('LeftLeg', lUpLeg, 0, -0.44, 0);
  const lFoot = makeBone('LeftFoot', lLeg, 0, -0.43, 0);
  const lToe = makeBone('LeftToe', lFoot, 0, -0.03, 0.12);

  const rUpLeg = makeBone('RightUpLeg', hips, -0.11, -0.06, 0);
  const rLeg = makeBone('RightLeg', rUpLeg, 0, -0.44, 0);
  const rFoot = makeBone('RightFoot', rLeg, 0, -0.43, 0);
  const rToe = makeBone('RightToe', rFoot, 0, -0.03, 0.12);

  const attachPart = (
    bone: THREE.Bone,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
  ) => {
    const m = new THREE.Mesh(trackGeo(geo), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    bone.add(m);
    return m;
  };

  // Pelvis / Belt
  attachPart(hips, new THREE.BoxGeometry(0.32, 0.16, 0.22), armorMat, [0, 0, 0]);
  attachPart(hips, new THREE.BoxGeometry(0.12, 0.08, 0.24), accentMat, [0, 0.02, 0]);

  // Spine & Chest armor
  attachPart(spine, new THREE.CylinderGeometry(0.14, 0.13, 0.24, 10), fabricMat, [0, 0.08, 0]);
  attachPart(chest, new THREE.BoxGeometry(0.38, 0.28, 0.25), armorMat, [0, 0.08, 0]);
  attachPart(chest, new THREE.OctahedronGeometry(0.055, 0), visorMat, [0, 0.1, 0.135]);
  attachPart(chest, new THREE.BoxGeometry(0.24, 0.05, 0.27), accentMat, [0, 0.19, 0]);

  // Neck, Helmet Head & Jaw
  attachPart(neck, new THREE.CylinderGeometry(0.065, 0.075, 0.1, 10), fabricMat, [0, 0.04, 0]);
  attachPart(head, new THREE.BoxGeometry(0.22, 0.22, 0.24), armorMat, [0, 0.11, 0]);
  attachPart(head, new THREE.BoxGeometry(0.19, 0.065, 0.05), visorMat, [0, 0.11, 0.115]);
  attachPart(head, new THREE.BoxGeometry(0.05, 0.12, 0.27), accentMat, [0, 0.2, -0.01]);
  attachPart(jaw, new THREE.BoxGeometry(0.14, 0.055, 0.12), accentMat, [0, -0.02, 0.02]);

  // Left & Right Arms, Hands & Articulated Fingers
  attachPart(lShoulder, new THREE.BoxGeometry(0.16, 0.12, 0.18), accentMat, [0.05, 0.02, 0], [0, 0, -0.25]);
  attachPart(lArm, new THREE.CylinderGeometry(0.055, 0.05, 0.26, 10), fabricMat, [0, -0.14, 0]);
  attachPart(lForearm, new THREE.BoxGeometry(0.105, 0.24, 0.11), armorMat, [0, -0.13, 0]);
  attachPart(lHand, new THREE.BoxGeometry(0.055, 0.07, 0.095), accentMat, [0, -0.03, 0]);
  attachPart(lThumb, new THREE.CapsuleGeometry(0.01, 0.032, 4, 6), armorMat, [0, -0.018, 0.01]);
  attachPart(lIndex, new THREE.CapsuleGeometry(0.009, 0.042, 4, 6), armorMat, [0, -0.025, 0]);
  attachPart(lMiddle, new THREE.CapsuleGeometry(0.009, 0.046, 4, 6), armorMat, [0, -0.027, 0]);
  attachPart(lRing, new THREE.CapsuleGeometry(0.009, 0.042, 4, 6), armorMat, [0, -0.025, 0]);
  attachPart(lPinky, new THREE.CapsuleGeometry(0.008, 0.034, 4, 6), armorMat, [0, -0.02, 0]);

  attachPart(rShoulder, new THREE.BoxGeometry(0.16, 0.12, 0.18), accentMat, [-0.05, 0.02, 0], [0, 0, 0.25]);
  attachPart(rArm, new THREE.CylinderGeometry(0.055, 0.05, 0.26, 10), fabricMat, [0, -0.14, 0]);
  attachPart(rForearm, new THREE.BoxGeometry(0.105, 0.24, 0.11), armorMat, [0, -0.13, 0]);
  attachPart(rHand, new THREE.BoxGeometry(0.055, 0.07, 0.095), accentMat, [0, -0.03, 0]);
  attachPart(rThumb, new THREE.CapsuleGeometry(0.01, 0.032, 4, 6), armorMat, [0, -0.018, 0.01]);
  attachPart(rIndex, new THREE.CapsuleGeometry(0.009, 0.042, 4, 6), armorMat, [0, -0.025, 0]);
  attachPart(rMiddle, new THREE.CapsuleGeometry(0.009, 0.046, 4, 6), armorMat, [0, -0.027, 0]);
  attachPart(rRing, new THREE.CapsuleGeometry(0.009, 0.042, 4, 6), armorMat, [0, -0.025, 0]);
  attachPart(rPinky, new THREE.CapsuleGeometry(0.008, 0.034, 4, 6), armorMat, [0, -0.02, 0]);

  // Left & Right Legs, Feet & Toes
  attachPart(lUpLeg, new THREE.CylinderGeometry(0.075, 0.065, 0.4, 10), fabricMat, [0, -0.21, 0]);
  attachPart(lUpLeg, new THREE.BoxGeometry(0.13, 0.24, 0.15), armorMat, [0, -0.18, 0]);
  attachPart(lLeg, new THREE.BoxGeometry(0.13, 0.38, 0.15), armorMat, [0, -0.2, 0]);
  attachPart(lFoot, new THREE.BoxGeometry(0.13, 0.075, 0.17), accentMat, [0, -0.025, 0.02]);
  attachPart(lToe, new THREE.BoxGeometry(0.12, 0.05, 0.085), armorMat, [0, -0.01, 0.02]);

  attachPart(rUpLeg, new THREE.CylinderGeometry(0.075, 0.065, 0.4, 10), fabricMat, [0, -0.21, 0]);
  attachPart(rUpLeg, new THREE.BoxGeometry(0.13, 0.24, 0.15), armorMat, [0, -0.18, 0]);
  attachPart(rLeg, new THREE.BoxGeometry(0.13, 0.38, 0.15), armorMat, [0, -0.2, 0]);
  attachPart(rFoot, new THREE.BoxGeometry(0.13, 0.075, 0.17), accentMat, [0, -0.025, 0.02]);
  attachPart(rToe, new THREE.BoxGeometry(0.12, 0.05, 0.085), armorMat, [0, -0.01, 0.02]);

  // Loyalty Rank Ground Aura Ring
  const auraColor = RANK_AURA_COLORS[loyaltyRank] ?? 0x3b82f6;
  const auraGeo = trackGeo(new THREE.RingGeometry(0.42, 0.49, 48));
  const auraMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: auraColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    }),
  );
  const auraRing = new THREE.Mesh(auraGeo, auraMat);
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.025;
  root.add(auraRing);

  return {
    root,
    bonesByName,
    restPositions,
    auraRing,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

/**
 * Creates a detailed multi-mesh unrigged humanoid statue for the Rigging Studio
 * complete with sculpted Head, Jaw, Hands, 5 individual Fingers per hand, and Feet + Toes,
 * aligned directly to the 33-bone & 45-bone proportional humanoid rig.
 */
export function createStarterRiggingSubject(variant: 'knight' | 'vanguard' = 'knight'): THREE.Group {
  const group = new THREE.Group();
  group.name = variant === 'knight' ? 'Starter_Sovereign_Knight' : 'Starter_Vanguard_Mech';

  const primaryColor = variant === 'knight' ? 0x3b475c : 0xdbeafe;
  const accentColor = variant === 'knight' ? 0xd4af37 : 0x3b82f6;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: primaryColor,
    roughness: 0.42,
    metalness: 0.48,
    vertexColors: false,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.24,
    metalness: 0.82,
    vertexColors: false,
  });

  const addSeg = (
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rz = 0,
  ) => {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Pelvis, Torso, Chest & Neck
  addSeg('Pelvis_Mesh', new THREE.BoxGeometry(0.3, 0.14, 0.2, 4, 2, 4), trimMat, 0, 0.96, 0);
  addSeg('Torso_Mesh', new THREE.CapsuleGeometry(0.16, 0.38, 12, 24), bodyMat, 0, 1.22, 0);
  addSeg('ChestPlate_Mesh', new THREE.BoxGeometry(0.38, 0.25, 0.24, 8, 6, 6), trimMat, 0, 1.38, 0.01);
  addSeg('Neck_Mesh', new THREE.CylinderGeometry(0.062, 0.078, 0.14, 12, 4), bodyMat, 0, 1.61, 0);

  // Sculpted Head, Visor & Jaw
  addSeg('Head_Mesh', new THREE.SphereGeometry(0.14, 24, 20), bodyMat, 0, 1.77, 0);
  addSeg('Visor_Mesh', new THREE.BoxGeometry(0.18, 0.055, 0.11, 4, 2, 2), trimMat, 0, 1.78, 0.09);
  addSeg('Jaw_Mesh', new THREE.BoxGeometry(0.125, 0.06, 0.105, 4, 2, 2), trimMat, 0, 1.66, 0.06);

  // Shoulders & Arms angled downward in clean A-pose
  addSeg('LeftShoulder_Mesh', new THREE.SphereGeometry(0.082, 16, 12), trimMat, 0.23, 1.48, 0);
  addSeg('RightShoulder_Mesh', new THREE.SphereGeometry(0.082, 16, 12), trimMat, -0.23, 1.48, 0);
  addSeg('LeftArm_Mesh', new THREE.CapsuleGeometry(0.056, 0.42, 10, 18), bodyMat, 0.34, 1.28, 0, 0.24);
  addSeg('RightArm_Mesh', new THREE.CapsuleGeometry(0.056, 0.42, 10, 18), bodyMat, -0.34, 1.28, 0, -0.24);

  // Sculpted Hands + 5 Distinct Fingers per Hand matching full-33 coordinates
  const addHandWithFingers = (side: 1 | -1) => {
    const prefix = side === 1 ? 'Left' : 'Right';
    const hx = side * 0.43;
    const hy = 0.96;
    addSeg(`${prefix}Hand_Mesh`, new THREE.BoxGeometry(0.055, 0.085, 0.1, 4, 4, 4), trimMat, hx, hy, 0);
    // Thumb + 4 Fingers with subdivisions so 2-segment ultra-45 rigs bend cleanly too
    addSeg(`${prefix}Thumb_Mesh`, new THREE.CapsuleGeometry(0.011, 0.048, 6, 8), bodyMat, hx + side * 0.025, hy - 0.035, 0.055, side * 0.25);
    addSeg(`${prefix}Index_Mesh`, new THREE.CapsuleGeometry(0.01, 0.065, 6, 8), bodyMat, hx + side * 0.045, hy - 0.095, 0.035, side * 0.12);
    addSeg(`${prefix}Middle_Mesh`, new THREE.CapsuleGeometry(0.01, 0.072, 6, 8), bodyMat, hx + side * 0.048, hy - 0.102, 0.01, side * 0.12);
    addSeg(`${prefix}Ring_Mesh`, new THREE.CapsuleGeometry(0.01, 0.066, 6, 8), bodyMat, hx + side * 0.046, hy - 0.096, -0.015, side * 0.12);
    addSeg(`${prefix}Pinky_Mesh`, new THREE.CapsuleGeometry(0.009, 0.054, 6, 8), bodyMat, hx + side * 0.04, hy - 0.088, -0.038, side * 0.12);
  };
  addHandWithFingers(1);
  addHandWithFingers(-1);

  // Legs + Sculpted Feet & Toes
  addSeg('LeftLeg_Mesh', new THREE.CapsuleGeometry(0.08, 0.72, 12, 20), bodyMat, 0.13, 0.5, 0);
  addSeg('LeftFoot_Mesh', new THREE.BoxGeometry(0.13, 0.075, 0.18, 6, 4, 6), trimMat, 0.13, 0.065, 0.04);
  addSeg('LeftToe_Mesh', new THREE.BoxGeometry(0.12, 0.052, 0.09, 6, 4, 4), bodyMat, 0.13, 0.045, 0.15);

  addSeg('RightLeg_Mesh', new THREE.CapsuleGeometry(0.08, 0.72, 12, 20), bodyMat, -0.13, 0.5, 0);
  addSeg('RightFoot_Mesh', new THREE.BoxGeometry(0.13, 0.075, 0.18, 6, 4, 6), trimMat, -0.13, 0.065, 0.04);
  addSeg('RightToe_Mesh', new THREE.BoxGeometry(0.12, 0.052, 0.09, 6, 4, 4), bodyMat, -0.13, 0.045, 0.15);

  return group;
}

const HUMANOID_BONE_NAMES = new Set([
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'HeadTop',
  'Jaw',
  'LeftEye',
  'RightEye',
  'Brow',
  'LeftShoulder',
  'LeftArm',
  'LeftForearm',
  'LeftHand',
  'LeftThumb',
  'LeftThumb2',
  'LeftIndex',
  'LeftIndex2',
  'LeftMiddle',
  'LeftMiddle2',
  'LeftRing',
  'LeftRing2',
  'LeftPinky',
  'LeftPinky2',
  'RightShoulder',
  'RightArm',
  'RightForearm',
  'RightHand',
  'RightThumb',
  'RightThumb2',
  'RightIndex',
  'RightIndex2',
  'RightMiddle',
  'RightMiddle2',
  'RightRing',
  'RightRing2',
  'RightPinky',
  'RightPinky2',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToe',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToe',
]);

function applyFingerCurl(
  bonesByName: Map<string, THREE.Bone>,
  side: 'Left' | 'Right',
  curlAmount: number,
  spread = 0,
): void {
  const sign = side === 'Left' ? -1 : 1;
  const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  fingers.forEach((f, idx) => {
    const b1 = bonesByName.get(`${side}${f}`);
    const b2 = bonesByName.get(`${side}${f}2`);
    const factor = f === 'Thumb' ? 0.55 : 1.0;
    if (b1) {
      if (f === 'Thumb') {
        b1.rotation.z += sign * curlAmount * 0.45;
        b1.rotation.x += curlAmount * 0.25;
      } else {
        b1.rotation.z += sign * curlAmount * factor;
        b1.rotation.y += (idx - 2) * spread;
      }
    }
    if (b2) {
      b2.rotation.z += sign * curlAmount * 0.9 * factor;
    }
  });
}

/**
 * Drives any humanoid or custom-boned skeleton (procedural OR user-rigged GLB)
 * with smooth full-body kinematics including Neck, Jaw, Hands, Fingers, Feet & Toes.
 */
export function applyAvatarAnimation(
  bonesByName: Map<string, THREE.Bone>,
  emote: AvatarEmote,
  t: number,
  restPositions?: Map<string, THREE.Vector3>,
  restRotations?: Map<string, THREE.Euler>,
): void {
  for (const [name, bone] of bonesByName.entries()) {
    const restRot = restRotations?.get(name);
    if (restRot) {
      bone.rotation.copy(restRot);
    } else {
      bone.rotation.set(0, 0, 0);
    }
    const rest = restPositions?.get(name);
    if (rest) {
      bone.position.copy(rest);
    }
  }

  const hips = findBoneByRole(bonesByName, 'Hips', 'hips');
  const spine = findBoneByRole(bonesByName, 'Spine', 'spine');
  const chest = findBoneByRole(bonesByName, 'Chest', 'chest');
  const neck = findBoneByRole(bonesByName, 'Neck', 'neck');
  const head = findBoneByRole(bonesByName, 'Head', 'head');
  const jaw = findBoneByRole(bonesByName, 'Jaw', 'jaw');
  const lArm = findBoneByRole(bonesByName, 'LeftArm', 'leftArm');
  const lForearm = findBoneByRole(bonesByName, 'LeftForearm', 'leftForearm');
  const lHand = findBoneByRole(bonesByName, 'LeftHand', 'leftHand');
  const rArm = findBoneByRole(bonesByName, 'RightArm', 'rightArm');
  const rForearm = findBoneByRole(bonesByName, 'RightForearm', 'rightForearm');
  const rHand = findBoneByRole(bonesByName, 'RightHand', 'rightHand');
  const lUpLeg = findBoneByRole(bonesByName, 'LeftUpLeg', 'leftUpLeg');
  const lLeg = findBoneByRole(bonesByName, 'LeftLeg', 'leftLeg');
  const lFoot = findBoneByRole(bonesByName, 'LeftFoot', 'leftFoot');
  const lToe = findBoneByRole(bonesByName, 'LeftToe', 'leftToe');
  const rUpLeg = findBoneByRole(bonesByName, 'RightUpLeg', 'rightUpLeg');
  const rLeg = findBoneByRole(bonesByName, 'RightLeg', 'rightLeg');
  const rFoot = findBoneByRole(bonesByName, 'RightFoot', 'rightFoot');
  const rToe = findBoneByRole(bonesByName, 'RightToe', 'rightToe');

  // Secondary motion ONLY for truly custom user bones (skip standard humanoid roles even if Mixamo/Unreal named)
  let customIdx = 0;
  for (const [name, bone] of bonesByName.entries()) {
    if (HUMANOID_BONE_NAMES.has(name) || resolveHumanoidRole(name) !== 'other') continue;
    customIdx += 1;
    const isRight = /right|_r\b|\.r\b/i.test(name);
    const sign = isRight ? -1 : 1;
    const speed = emote === 'run' ? 8.5 : emote === 'dance' ? 6.2 : emote === 'walk' ? 5.2 : 2.2;
    const amp = emote === 'dance' || emote === 'run' ? 0.34 : emote === 'hero' ? 0.16 : 0.22;
    bone.rotation.z += sign * Math.sin(t * speed + customIdx * 0.7) * amp;
    bone.rotation.x += Math.cos(t * speed * 0.75 + customIdx * 0.5) * (amp * 0.55);
  }

  if (emote === 'walk' || emote === 'run') {
    const freq = emote === 'run' ? 9.5 : 5.8;
    const amp = emote === 'run' ? 0.85 : 0.48;
    const swing = Math.sin(t * freq);
    if (hips) {
      hips.position.y += Math.abs(Math.cos(t * freq)) * (emote === 'run' ? 0.08 : 0.035);
      hips.rotation.y += swing * 0.08;
    }
    if (spine) spine.rotation.x += emote === 'run' ? 0.18 : 0.06;
    if (chest) chest.rotation.y += -swing * 0.12;
    if (neck) neck.rotation.y += swing * 0.05;
    if (lUpLeg) lUpLeg.rotation.x += swing * amp;
    if (rUpLeg) rUpLeg.rotation.x += -swing * amp;
    if (lLeg) lLeg.rotation.x += Math.max(0, -swing * amp * 1.1);
    if (rLeg) rLeg.rotation.x += Math.max(0, swing * amp * 1.1);
    if (lFoot) lFoot.rotation.x += -swing * 0.32;
    if (rFoot) rFoot.rotation.x += swing * 0.32;
    if (lToe) lToe.rotation.x += Math.max(0, swing * 0.42);
    if (rToe) rToe.rotation.x += Math.max(0, -swing * 0.42);
    if (lArm) lArm.rotation.x += -swing * amp * 0.85;
    if (rArm) rArm.rotation.x += swing * amp * 0.85;
    if (lForearm) lForearm.rotation.x += -0.35 - Math.max(0, swing * 0.4);
    if (rForearm) rForearm.rotation.x += -0.35 - Math.max(0, -swing * 0.4);
    if (lHand) lHand.rotation.x += -0.15;
    if (rHand) rHand.rotation.x += -0.15;
    const curl = emote === 'run' ? 0.78 : 0.36;
    applyFingerCurl(bonesByName, 'Left', curl);
    applyFingerCurl(bonesByName, 'Right', curl);
    return;
  }

  if (emote === 'wave') {
    if (hips) hips.rotation.z += Math.sin(t * 2.5) * 0.04;
    if (chest) chest.rotation.z += -0.08;
    if (neck) neck.rotation.y += Math.sin(t * 2) * 0.08;
    if (head) head.rotation.y += Math.sin(t * 2) * 0.15;
    if (jaw) jaw.rotation.x += Math.max(0, Math.sin(t * 4.5)) * 0.14;
    if (rArm) {
      rArm.rotation.z += -2.45 + Math.sin(t * 7) * 0.28;
      rArm.rotation.x += -0.2;
    }
    if (rForearm) {
      rForearm.rotation.z += -0.4 + Math.sin(t * 7 + 0.4) * 0.35;
    }
    if (rHand) rHand.rotation.z += Math.sin(t * 7 + 0.8) * 0.28;
    applyFingerCurl(bonesByName, 'Right', 0.06, 0.09);
    applyFingerCurl(bonesByName, 'Left', 0.32);
    if (lArm) lArm.rotation.z += 0.15;
    return;
  }

  if (emote === 'dance') {
    const beat = t * 6.2;
    if (hips) {
      hips.position.y += Math.abs(Math.sin(beat)) * 0.09;
      hips.rotation.y += Math.sin(beat * 0.5) * 0.32;
      hips.rotation.z += Math.cos(beat * 0.5) * 0.1;
    }
    if (chest) {
      chest.rotation.y += -Math.sin(beat * 0.5) * 0.24;
      chest.rotation.x += Math.sin(beat) * 0.12;
    }
    if (head) head.rotation.z += Math.sin(beat) * 0.12;
    if (jaw) jaw.rotation.x += Math.max(0, Math.sin(beat)) * 0.16;
    if (lArm) {
      lArm.rotation.z += 1.1 + Math.sin(beat) * 0.65;
      lArm.rotation.x += Math.cos(beat * 0.5) * 0.45;
    }
    if (rArm) {
      rArm.rotation.z += -1.1 - Math.cos(beat) * 0.65;
      rArm.rotation.x += -Math.sin(beat * 0.5) * 0.45;
    }
    if (lForearm) lForearm.rotation.x += -0.9;
    if (rForearm) rForearm.rotation.x += -0.9;
    if (lHand) lHand.rotation.y += Math.sin(beat * 2) * 0.35;
    if (rHand) rHand.rotation.y += -Math.sin(beat * 2) * 0.35;
    applyFingerCurl(bonesByName, 'Left', 0.35 + Math.sin(beat) * 0.25);
    applyFingerCurl(bonesByName, 'Right', 0.35 + Math.cos(beat) * 0.25);
    if (lUpLeg) lUpLeg.rotation.x += Math.max(0, Math.sin(beat)) * 0.35;
    if (rUpLeg) rUpLeg.rotation.x += Math.max(0, -Math.sin(beat)) * 0.35;
    if (lLeg) lLeg.rotation.x += Math.max(0, Math.sin(beat)) * 0.5;
    if (rLeg) rLeg.rotation.x += Math.max(0, -Math.sin(beat)) * 0.5;
    if (lFoot) lFoot.rotation.x += -Math.max(0, Math.sin(beat)) * 0.25;
    if (rFoot) rFoot.rotation.x += -Math.max(0, -Math.sin(beat)) * 0.25;
    return;
  }

  if (emote === 'hero') {
    const breath = Math.sin(t * 2.4);
    if (hips) hips.rotation.y += -0.25;
    if (chest) {
      chest.rotation.x += -0.1;
      chest.rotation.y += 0.25;
    }
    if (head) head.rotation.y += 0.1;
    if (rArm) {
      rArm.rotation.z += -1.25 + breath * 0.05;
      rArm.rotation.x += -0.45;
    }
    if (rForearm) rForearm.rotation.x += -0.85;
    if (lArm) lArm.rotation.z += 0.35;
    if (lForearm) lForearm.rotation.z += 0.25;
    applyFingerCurl(bonesByName, 'Right', 0.85);
    applyFingerCurl(bonesByName, 'Left', 0.45);
    if (lUpLeg) lUpLeg.rotation.x += -0.18;
    if (rUpLeg) rUpLeg.rotation.x += 0.18;
    if (lFoot) lFoot.rotation.x += 0.15;
    if (rFoot) rFoot.rotation.x += -0.12;
    return;
  }

  if (emote === 'jump') {
    const cycle = (t * 2.2) % 1;
    const arc = Math.sin(cycle * Math.PI);
    if (hips) hips.position.y += arc * 0.55;
    if (lArm) lArm.rotation.z += 0.4 + arc * 1.8;
    if (rArm) rArm.rotation.z += -0.4 - arc * 1.8;
    if (lUpLeg) lUpLeg.rotation.x += -arc * 0.55;
    if (rUpLeg) rUpLeg.rotation.x += -arc * 0.55;
    if (lLeg) lLeg.rotation.x += arc * 0.85;
    if (rLeg) rLeg.rotation.x += arc * 0.85;
    if (lFoot) lFoot.rotation.x += arc * 0.45;
    if (rFoot) rFoot.rotation.x += arc * 0.45;
    if (lToe) lToe.rotation.x += arc * 0.3;
    if (rToe) rToe.rotation.x += arc * 0.3;
    applyFingerCurl(bonesByName, 'Left', 0.12, 0.08);
    applyFingerCurl(bonesByName, 'Right', 0.12, 0.08);
    return;
  }

  if (emote === 'combat') {
    const beat = t * 5.2;
    const punch = Math.max(0, Math.sin(beat));
    const hook = Math.max(0, Math.sin(beat + Math.PI));
    if (hips) {
      hips.rotation.y += -0.42 + (punch - hook) * 0.25;
      hips.position.y += -0.05 + Math.abs(Math.sin(beat * 0.5)) * 0.02;
    }
    if (spine) spine.rotation.x += 0.14;
    if (chest) {
      chest.rotation.y += 0.22 + (punch - hook) * 0.35;
      chest.rotation.x += 0.08;
    }
    if (head) head.rotation.y += -0.15;
    if (lArm) {
      lArm.rotation.x += -1.05 - hook * 0.45;
      lArm.rotation.z += 0.32;
    }
    if (lForearm) lForearm.rotation.x += -1.35 + hook * 0.95;
    if (rArm) {
      rArm.rotation.x += -1.0 - punch * 0.55;
      rArm.rotation.z += -0.28;
    }
    if (rForearm) rForearm.rotation.x += -1.25 + punch * 1.1;
    applyFingerCurl(bonesByName, 'Left', 0.92);
    applyFingerCurl(bonesByName, 'Right', 0.92);
    if (lUpLeg) lUpLeg.rotation.x += -0.28;
    if (lLeg) lLeg.rotation.x += 0.35;
    if (rUpLeg) rUpLeg.rotation.x += 0.32;
    if (rLeg) rLeg.rotation.x += 0.38;
    if (lFoot) lFoot.rotation.x += -0.12;
    if (rFoot) rFoot.rotation.x += -0.15;
    return;
  }

  // Default: calm heroic idle breathing with gentle finger relax & head scan
  const breath = Math.sin(t * 2.0);
  if (hips) hips.position.y += breath * 0.012;
  if (chest) chest.rotation.x += breath * 0.03;
  if (neck) neck.rotation.y += Math.sin(t * 0.7) * 0.04;
  if (head) head.rotation.y += Math.sin(t * 0.7) * 0.08;
  if (lArm) lArm.rotation.z += 0.14 + breath * 0.025;
  if (rArm) rArm.rotation.z += -0.14 - breath * 0.025;
  if (lForearm) lForearm.rotation.x += -0.18;
  if (rForearm) rForearm.rotation.x += -0.18;
  applyFingerCurl(bonesByName, 'Left', 0.25 + breath * 0.04);
  applyFingerCurl(bonesByName, 'Right', 0.25 + breath * 0.04);
}

/**
 * Smooth multi-state locomotion & emote driver synchronized to actual ground speed & stridePhase.
 * Blends Idle -> Walk -> Run -> Sprint -> Jump/Fall -> Landing Squash cleanly across procedural
 * avatars and custom rigged GLB humanoids without foot sliding.
 */
export function applyLocomotionPose(
  bonesByName: Map<string, THREE.Bone>,
  state: ActorAnimationState,
  elapsed: number,
  restPositions?: Map<string, THREE.Vector3>,
  restRotations?: Map<string, THREE.Euler>,
): void {
  // If airborne or moving, drive full multi-state locomotion; otherwise blend into active emote or calm idle
  const speed = state.smoothedSpeed;
  const isMoving = speed > 0.22;
  const isAirborne = state.airBlend > 0.12;

  if (!isMoving && !isAirborne && state.landSquash < 0.05 && state.emote !== 'idle' && state.emote !== 'walk' && state.emote !== 'run' && state.emote !== 'jump') {
    applyAvatarAnimation(bonesByName, state.emote, elapsed, restPositions, restRotations);
    return;
  }

  // Reset to exact bind rest pose
  for (const [name, bone] of bonesByName.entries()) {
    const restRot = restRotations?.get(name);
    if (restRot) bone.rotation.copy(restRot);
    else bone.rotation.set(0, 0, 0);
    const restPos = restPositions?.get(name);
    if (restPos) bone.position.copy(restPos);
  }

  const hips = findBoneByRole(bonesByName, 'Hips', 'hips');
  const spine = findBoneByRole(bonesByName, 'Spine', 'spine');
  const chest = findBoneByRole(bonesByName, 'Chest', 'chest');
  const neck = findBoneByRole(bonesByName, 'Neck', 'neck');
  const head = findBoneByRole(bonesByName, 'Head', 'head');
  const lShoulder = findBoneByRole(bonesByName, 'LeftShoulder', 'leftShoulder');
  const lArm = findBoneByRole(bonesByName, 'LeftArm', 'leftArm');
  const lForearm = findBoneByRole(bonesByName, 'LeftForearm', 'leftForearm');
  const lHand = findBoneByRole(bonesByName, 'LeftHand', 'leftHand');
  const rShoulder = findBoneByRole(bonesByName, 'RightShoulder', 'rightShoulder');
  const rArm = findBoneByRole(bonesByName, 'RightArm', 'rightArm');
  const rForearm = findBoneByRole(bonesByName, 'RightForearm', 'rightForearm');
  const rHand = findBoneByRole(bonesByName, 'RightHand', 'rightHand');
  const lUpLeg = findBoneByRole(bonesByName, 'LeftUpLeg', 'leftUpLeg');
  const lLeg = findBoneByRole(bonesByName, 'LeftLeg', 'leftLeg');
  const lFoot = findBoneByRole(bonesByName, 'LeftFoot', 'leftFoot');
  const lToe = findBoneByRole(bonesByName, 'LeftToe', 'leftToe');
  const rUpLeg = findBoneByRole(bonesByName, 'RightUpLeg', 'rightUpLeg');
  const rLeg = findBoneByRole(bonesByName, 'RightLeg', 'rightLeg');
  const rFoot = findBoneByRole(bonesByName, 'RightFoot', 'rightFoot');
  const rToe = findBoneByRole(bonesByName, 'RightToe', 'rightToe');

  const moveBlend = THREE.MathUtils.clamp(speed / 2.2, 0, 1);
  const runBlend = THREE.MathUtils.clamp((speed - 3.6) / 4.2, 0, 1);
  const groundBlend = (1 - state.airBlend) * moveBlend;

  const phase = state.stridePhase;
  const sinP = Math.sin(phase);
  const cosP = Math.cos(phase);

  // Idle breathing component
  const idleFactor = (1 - moveBlend) * (1 - state.airBlend);
  const breath = Math.sin(elapsed * 2.1);

  // Locomotion amplitude scales naturally from Walk -> Run -> Sprint
  const legAmp = THREE.MathUtils.lerp(0.46, 0.88, runBlend) * groundBlend;
  const armAmp = THREE.MathUtils.lerp(0.42, 0.92, runBlend) * groundBlend;
  const bounceAmp = THREE.MathUtils.lerp(0.032, 0.085, runBlend) * groundBlend;

  // Natural leg & foot stride kinematics (lift knee smoothly in swing phase, plant heel/toe in stance)
  const lLegSwing = sinP * legAmp;
  const rLegSwing = -sinP * legAmp;
  const lKneeFlex = (Math.max(0, -cosP) * 0.65 + Math.max(0, -sinP) * 0.45) * (0.65 + runBlend * 0.55) * groundBlend;
  const rKneeFlex = (Math.max(0, cosP) * 0.65 + Math.max(0, sinP) * 0.45) * (0.65 + runBlend * 0.55) * groundBlend;

  if (hips) {
    const strideBob = Math.abs(cosP) * bounceAmp - bounceAmp * 0.35;
    const landDrop = -state.landSquash * 0.14;
    hips.position.y += breath * 0.012 * idleFactor + strideBob + landDrop;
    hips.rotation.y += sinP * (0.08 + runBlend * 0.07) * groundBlend;
    hips.rotation.z += cosP * 0.035 * groundBlend;
  }

  if (spine) {
    spine.rotation.x += (0.06 + runBlend * 0.16) * groundBlend + state.landSquash * 0.22;
    spine.rotation.y += -sinP * 0.06 * groundBlend;
  }
  if (chest) {
    chest.rotation.x += breath * 0.03 * idleFactor + (0.04 + runBlend * 0.09) * groundBlend;
    chest.rotation.y += -sinP * (0.1 + runBlend * 0.08) * groundBlend;
  }
  if (neck) {
    neck.rotation.x += -0.05 * groundBlend;
    neck.rotation.y += Math.sin(elapsed * 0.7) * 0.04 * idleFactor + sinP * 0.04 * groundBlend;
  }
  if (head) {
    head.rotation.y += Math.sin(elapsed * 0.7) * 0.07 * idleFactor;
    head.rotation.x += -state.landSquash * 0.1;
  }

  if (lShoulder) lShoulder.rotation.y += -sinP * 0.06 * groundBlend;
  if (rShoulder) rShoulder.rotation.y += -sinP * 0.06 * groundBlend;

  // Ground locomotion + Landing crouch + Airborne jump/fall pose blending
  const airWeight = state.airBlend;
  const landCrouch = state.landSquash * 0.48;
  const isRising = state.moveState === 'jump';

  if (lUpLeg) {
    lUpLeg.rotation.x += lLegSwing - landCrouch - airWeight * (isRising ? 0.52 : 0.28);
  }
  if (rUpLeg) {
    rUpLeg.rotation.x += rLegSwing - landCrouch - airWeight * (isRising ? 0.22 : 0.42);
  }
  if (lLeg) {
    lLeg.rotation.x += lKneeFlex + landCrouch * 1.85 + airWeight * (isRising ? 0.85 : 0.55);
  }
  if (rLeg) {
    rLeg.rotation.x += rKneeFlex + landCrouch * 1.85 + airWeight * (isRising ? 0.45 : 0.82);
  }
  if (lFoot) {
    lFoot.rotation.x += (-sinP * 0.26 - lKneeFlex * 0.28) * groundBlend - landCrouch * 0.65 + airWeight * 0.38;
  }
  if (rFoot) {
    rFoot.rotation.x += (sinP * 0.26 - rKneeFlex * 0.28) * groundBlend - landCrouch * 0.65 + airWeight * 0.38;
  }
  if (lToe) {
    lToe.rotation.x += Math.max(0, sinP * 0.38) * groundBlend + airWeight * 0.22;
  }
  if (rToe) {
    rToe.rotation.x += Math.max(0, -sinP * 0.38) * groundBlend + airWeight * 0.22;
  }

  // Arms: smooth transition from relaxed idle stance to athletic arm pump to airborne balance
  if (lArm) {
    lArm.rotation.z += (0.14 + breath * 0.025) * idleFactor + 0.08 * groundBlend + airWeight * 0.95;
    lArm.rotation.x += -sinP * armAmp - airWeight * 0.35;
  }
  if (rArm) {
    rArm.rotation.z += -(0.14 + breath * 0.025) * idleFactor - 0.08 * groundBlend - airWeight * 0.95;
    rArm.rotation.x += sinP * armAmp - airWeight * 0.35;
  }
  if (lForearm) {
    lForearm.rotation.x +=
      -0.18 * idleFactor +
      (-0.32 - runBlend * 0.55 - Math.max(0, sinP) * 0.35) * groundBlend -
      airWeight * 0.45;
  }
  if (rForearm) {
    rForearm.rotation.x +=
      -0.18 * idleFactor +
      (-0.32 - runBlend * 0.55 - Math.max(0, -sinP) * 0.35) * groundBlend -
      airWeight * 0.45;
  }
  if (lHand) lHand.rotation.x += -0.1 * groundBlend;
  if (rHand) rHand.rotation.x += -0.1 * groundBlend;

  const fingerCurl = THREE.MathUtils.lerp(0.24, 0.72, runBlend) * (1 - airWeight * 0.5);
  applyFingerCurl(bonesByName, 'Left', fingerCurl, airWeight * 0.06);
  applyFingerCurl(bonesByName, 'Right', fingerCurl, airWeight * 0.06);
}
