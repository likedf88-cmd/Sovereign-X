import * as THREE from 'three';
import type { BoneControlShape, BoneNode, IKLimbId, IKLimbState } from '../types';
import { resolveHumanoidRole, type CanonicalHumanoidRole } from './riggingEngine';

const _posA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _posC = new THREE.Vector3();
const _dirAB = new THREE.Vector3();
const _dirAC = new THREE.Vector3();
const _dirPole = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _desiredAB = new THREE.Vector3();
const _desiredBC = new THREE.Vector3();
const _curDir = new THREE.Vector3();
const _deltaQ = new THREE.Quaternion();
const _parentWorldQ = new THREE.Quaternion();
const _worldQ = new THREE.Quaternion();

const r3 = (n: number) => Number(n.toFixed(3));

export function createDefaultIKLimbs(bones: BoneNode[]): Record<IKLimbId, IKLimbState> {
  const map = new Map<string, [number, number, number]>();
  const roleMap = new Map<CanonicalHumanoidRole, BoneNode>();
  bones.forEach((b) => {
    map.set(b.name, b.position);
    const role = resolveHumanoidRole(b.name);
    if (role !== 'other' && !roleMap.has(role)) roleMap.set(role, b);
  });

  const resolveName = (exact: string, role: CanonicalHumanoidRole): string =>
    map.has(exact) ? exact : roleMap.get(role)?.name ?? exact;

  const getPos = (name: string, role: CanonicalHumanoidRole, fallback: [number, number, number]): [number, number, number] =>
    map.get(resolveName(name, role)) ?? fallback;

  const lArmName = resolveName('LeftArm', 'leftArm');
  const lForearmName = resolveName('LeftForearm', 'leftForearm');
  const lHandName = resolveName('LeftHand', 'leftHand');
  const rArmName = resolveName('RightArm', 'rightArm');
  const rForearmName = resolveName('RightForearm', 'rightForearm');
  const rHandName = resolveName('RightHand', 'rightHand');
  const lUpLegName = resolveName('LeftUpLeg', 'leftUpLeg');
  const lLegName = resolveName('LeftLeg', 'leftLeg');
  const lFootName = resolveName('LeftFoot', 'leftFoot');
  const rUpLegName = resolveName('RightUpLeg', 'rightUpLeg');
  const rLegName = resolveName('RightLeg', 'rightLeg');
  const rFootName = resolveName('RightFoot', 'rightFoot');

  const lHand = getPos('LeftHand', 'leftHand', [0.46, 0.95, 0]);
  const lElbow = getPos('LeftForearm', 'leftForearm', [0.36, 1.2, -0.05]);
  const rHand = getPos('RightHand', 'rightHand', [-0.46, 0.95, 0]);
  const rElbow = getPos('RightForearm', 'rightForearm', [-0.36, 1.2, -0.05]);
  const lFoot = getPos('LeftFoot', 'leftFoot', [0.14, 0.08, 0.02]);
  const lKnee = getPos('LeftLeg', 'leftLeg', [0.14, 0.45, 0.04]);
  const rFoot = getPos('RightFoot', 'rightFoot', [-0.14, 0.08, 0.02]);
  const rKnee = getPos('RightLeg', 'rightLeg', [-0.14, 0.45, 0.04]);

  return {
    leftArm: {
      id: 'leftArm',
      label: 'Left Arm IK',
      enabled: false,
      blend: 1.0,
      rootBone: lArmName,
      midBone: lForearmName,
      endBone: lHandName,
      targetPos: [r3(lHand[0]), r3(lHand[1]), r3(lHand[2])],
      polePos: [r3(lElbow[0]), r3(lElbow[1]), r3(lElbow[2] - 0.35)],
    },
    rightArm: {
      id: 'rightArm',
      label: 'Right Arm IK',
      enabled: false,
      blend: 1.0,
      rootBone: rArmName,
      midBone: rForearmName,
      endBone: rHandName,
      targetPos: [r3(rHand[0]), r3(rHand[1]), r3(rHand[2])],
      polePos: [r3(rElbow[0]), r3(rElbow[1]), r3(rElbow[2] - 0.35)],
    },
    leftLeg: {
      id: 'leftLeg',
      label: 'Left Leg IK',
      enabled: false,
      blend: 1.0,
      rootBone: lUpLegName,
      midBone: lLegName,
      endBone: lFootName,
      targetPos: [r3(lFoot[0]), r3(lFoot[1]), r3(lFoot[2])],
      polePos: [r3(lKnee[0]), r3(lKnee[1]), r3(lKnee[2] + 0.42)],
    },
    rightLeg: {
      id: 'rightLeg',
      label: 'Right Leg IK',
      enabled: false,
      blend: 1.0,
      rootBone: rUpLegName,
      midBone: rLegName,
      endBone: rFootName,
      targetPos: [r3(rFoot[0]), r3(rFoot[1]), r3(rFoot[2])],
      polePos: [r3(rKnee[0]), r3(rKnee[1]), r3(rKnee[2] + 0.42)],
    },
  };
}

function alignBoneSegmentWorld(bone: THREE.Bone, nextWorldTarget: THREE.Vector3, currentChildWorld: THREE.Vector3, blend: number): void {
  bone.updateMatrixWorld(true);
  bone.getWorldPosition(_posA);
  _curDir.copy(currentChildWorld).sub(_posA);
  _desiredAB.copy(nextWorldTarget).sub(_posA);
  if (_curDir.lengthSq() < 1e-7 || _desiredAB.lengthSq() < 1e-7) return;
  _curDir.normalize();
  _desiredAB.normalize();

  _deltaQ.setFromUnitVectors(_curDir, _desiredAB);
  bone.getWorldQuaternion(_worldQ);
  const targetWorldQ = _deltaQ.clone().multiply(_worldQ);

  if (bone.parent) {
    bone.parent.updateMatrixWorld(true);
    bone.parent.getWorldQuaternion(_parentWorldQ);
    const targetLocalQ = _parentWorldQ.invert().multiply(targetWorldQ);
    bone.quaternion.slerp(targetLocalQ, THREE.MathUtils.clamp(blend, 0, 1));
  } else {
    bone.quaternion.slerp(targetWorldQ, THREE.MathUtils.clamp(blend, 0, 1));
  }
  bone.updateMatrixWorld(true);
}

/**
 * Real analytical 2-bone Inverse Kinematics solver with interactive Pole Vector bending plane.
 */
export function solveTwoBoneIK(
  rootBone: THREE.Bone,
  midBone: THREE.Bone,
  endBone: THREE.Bone,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  blend = 1.0,
): void {
  if (blend <= 0.001) return;

  rootBone.updateMatrixWorld(true);
  rootBone.getWorldPosition(_posA);
  midBone.getWorldPosition(_posB);
  endBone.getWorldPosition(_posC);

  const lenA = Math.max(0.02, _posA.distanceTo(_posB));
  const lenB = Math.max(0.02, _posB.distanceTo(_posC));

  _dirAC.copy(targetWorld).sub(_posA);
  const rawDist = _dirAC.length();
  const maxReach = Math.max(0.03, (lenA + lenB) * 0.996);
  const minReach = Math.max(0.02, Math.abs(lenA - lenB) + 0.015);
  const d = THREE.MathUtils.clamp(rawDist, minReach, maxReach);
  if (rawDist < 1e-5) {
    _dirAC.set(0, -1, 0);
  } else {
    _dirAC.divideScalar(rawDist);
  }

  // Law of cosines for interior angle at rootBone (A)
  const cosAngleA = THREE.MathUtils.clamp(
    (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d),
    -1,
    1,
  );
  const angleA = Math.acos(cosAngleA);

  // Build orthonormal basis around target direction & pole vector
  _dirPole.copy(poleWorld).sub(_posA);
  // Orthogonalize pole direction against _dirAC
  const proj = _dirPole.dot(_dirAC);
  _dirPole.addScaledVector(_dirAC, -proj);
  if (_dirPole.lengthSq() < 1e-6) {
    _dirPole.set(0, 0, 1);
    const p2 = _dirPole.dot(_dirAC);
    _dirPole.addScaledVector(_dirAC, -p2);
    if (_dirPole.lengthSq() < 1e-6) _dirPole.set(1, 0, 0);
  }
  _dirPole.normalize();

  // Compute desired world position of mid joint (B_target)
  _desiredAB
    .copy(_dirAC)
    .multiplyScalar(Math.cos(angleA) * lenA)
    .addScaledVector(_dirPole, Math.sin(angleA) * lenA)
    .add(_posA);

  // Align rootBone segment (A -> B) toward _desiredAB
  alignBoneSegmentWorld(rootBone, _desiredAB, _posB, blend);

  // Re-read mid & end world positions after rotating rootBone, then align (B -> C) toward targetWorld
  midBone.updateMatrixWorld(true);
  midBone.getWorldPosition(_posB);
  endBone.getWorldPosition(_posC);
  _desiredBC.copy(_posA).addScaledVector(_dirAC, d);
  alignBoneSegmentWorld(midBone, _desiredBC, _posC, blend);

  // Stabilize twist on rootBone so midBone pole aligns cleanly with poleWorld
  midBone.getWorldPosition(_posB);
  _normal.copy(_posB).sub(_posA);
  const projB = _normal.dot(_dirAC);
  _normal.addScaledVector(_dirAC, -projB);
  if (_normal.lengthSq() > 1e-5) {
    _normal.normalize();
    _dirAB.copy(poleWorld).sub(_posA);
    _dirAB.addScaledVector(_dirAC, -_dirAB.dot(_dirAC));
    if (_dirAB.lengthSq() > 1e-5) {
      _dirAB.normalize();
      const twistAngle = _normal.angleTo(_dirAB);
      if (twistAngle > 0.01 && twistAngle < Math.PI - 0.01) {
        const cross = new THREE.Vector3().crossVectors(_normal, _dirAB);
        const sign = cross.dot(_dirAC) >= 0 ? 1 : -1;
        const twistQ = new THREE.Quaternion().setFromAxisAngle(_dirAC, sign * twistAngle * blend * 0.65);
        rootBone.getWorldQuaternion(_worldQ);
        const twistedWorld = twistQ.multiply(_worldQ);
        if (rootBone.parent) {
          rootBone.parent.getWorldQuaternion(_parentWorldQ);
          rootBone.quaternion.copy(_parentWorldQ.invert().multiply(twistedWorld));
        } else {
          rootBone.quaternion.copy(twistedWorld);
        }
        rootBone.updateMatrixWorld(true);
      }
    }
  }
}

/**
 * Enforces per-bone Euler rotation limits & position locks relative to rest pose.
 */
export function applyBoneConstraints(
  bonesByName: Map<string, THREE.Bone>,
  boneNodes: BoneNode[],
  restRotations?: Map<string, THREE.Euler>,
  restPositions?: Map<string, THREE.Vector3>,
): void {
  for (const node of boneNodes) {
    const c = node.constraint;
    if (!c || !c.enabled) continue;
    const bone = bonesByName.get(node.name);
    if (!bone) continue;

    const restRot = restRotations?.get(node.name);
    const rx = bone.rotation.x - (restRot?.x ?? 0);
    const ry = bone.rotation.y - (restRot?.y ?? 0);
    const rz = bone.rotation.z - (restRot?.z ?? 0);

    const minX = THREE.MathUtils.degToRad(c.minDeg[0]);
    const minY = THREE.MathUtils.degToRad(c.minDeg[1]);
    const minZ = THREE.MathUtils.degToRad(c.minDeg[2]);
    const maxX = THREE.MathUtils.degToRad(c.maxDeg[0]);
    const maxY = THREE.MathUtils.degToRad(c.maxDeg[1]);
    const maxZ = THREE.MathUtils.degToRad(c.maxDeg[2]);

    bone.rotation.set(
      (restRot?.x ?? 0) + THREE.MathUtils.clamp(rx, minX, maxX),
      (restRot?.y ?? 0) + THREE.MathUtils.clamp(ry, minY, maxY),
      (restRot?.z ?? 0) + THREE.MathUtils.clamp(rz, minZ, maxZ),
    );

    if (c.lockPosition && restPositions?.has(node.name)) {
      bone.position.copy(restPositions.get(node.name)!);
    }
  }
}

export function createControlShapeGeometry(
  shape: BoneControlShape = 'sphere',
  radius = 0.03,
): THREE.BufferGeometry {
  if (shape === 'ring') {
    const geo = new THREE.TorusGeometry(radius * 1.45, radius * 0.24, 8, 24);
    geo.rotateX(Math.PI / 2);
    return geo;
  }
  if (shape === 'cube') {
    const s = radius * 1.65;
    return new THREE.BoxGeometry(s, s, s);
  }
  if (shape === 'diamond') {
    return new THREE.OctahedronGeometry(radius * 1.35, 0);
  }
  return new THREE.SphereGeometry(radius, 12, 12);
}
