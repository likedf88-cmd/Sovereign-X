import * as THREE from 'three';
import type { AnimationBoneKey, AnimationKeyframe, AvatarEmote } from '../types';
import { applyAvatarAnimation } from './proceduralAvatars';

/**
 * Samples a procedural AvatarEmote over [0..duration] into a genuine THREE.AnimationClip
 * (QuaternionKeyframeTrack + VectorKeyframeTrack) ready for AnimationMixer playback and GLB/GLTF export.
 */
export function compileClipFromPreset(
  bonesByName: Map<string, THREE.Bone>,
  restPositions: Map<string, THREE.Vector3>,
  restRotations: Map<string, THREE.Euler>,
  emote: AvatarEmote,
  duration = 2.0,
  fps = 24,
): THREE.AnimationClip {
  const boneNames = Array.from(bonesByName.keys());
  const sampleCount = Math.max(4, Math.round(duration * fps) + 1);
  const times: number[] = [];

  const rotValuesByBone = new Map<string, number[]>();
  const hipsPosValues: number[] = [];
  boneNames.forEach((n) => rotValuesByBone.set(n, []));

  // Save live rotations/positions before sampling
  const savedRot = new Map<string, THREE.Euler>();
  const savedPos = new Map<string, THREE.Vector3>();
  for (const [name, bone] of bonesByName.entries()) {
    savedRot.set(name, bone.rotation.clone());
    savedPos.set(name, bone.position.clone());
  }

  const q = new THREE.Quaternion();
  for (let s = 0; s < sampleCount; s++) {
    const t = (s / (sampleCount - 1)) * duration;
    times.push(t);
    applyAvatarAnimation(bonesByName, emote, t, restPositions, restRotations);

    for (const [name, bone] of bonesByName.entries()) {
      q.setFromEuler(bone.rotation);
      const arr = rotValuesByBone.get(name)!;
      arr.push(q.x, q.y, q.z, q.w);
      if (name === 'Hips' || name === 'Root') {
        hipsPosValues.push(bone.position.x, bone.position.y, bone.position.z);
      }
    }
  }

  // Restore original live pose
  for (const [name, bone] of bonesByName.entries()) {
    const sr = savedRot.get(name);
    const sp = savedPos.get(name);
    if (sr) bone.rotation.copy(sr);
    if (sp) bone.position.copy(sp);
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const name of boneNames) {
    const arr = rotValuesByBone.get(name)!;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, arr));
  }
  const rootName = bonesByName.has('Hips') ? 'Hips' : bonesByName.has('Root') ? 'Root' : null;
  if (rootName && hipsPosValues.length === times.length * 3) {
    tracks.push(new THREE.VectorKeyframeTrack(`${rootName}.position`, times, hipsPosValues));
  }

  return new THREE.AnimationClip(`Sovereign_${emote}`, duration, tracks);
}

/**
 * Compiles user-authored timeline keyframes into a real THREE.AnimationClip
 * playable by AnimationMixer and included directly inside exported .GLB / .GLTF files.
 */
export function compileClipFromKeyframes(
  keyframes: AnimationKeyframe[],
  boneNames: string[],
  restPositions: Map<string, THREE.Vector3>,
  restRotations: Map<string, THREE.Euler>,
  clipName = 'Custom_Pose_Sequence',
  duration = 3.0,
): THREE.AnimationClip {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) {
    return new THREE.AnimationClip(clipName, duration, []);
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();

  for (const bName of boneNames) {
    const times: number[] = [];
    const quats: number[] = [];
    const posTimes: number[] = [];
    const posVals: number[] = [];

    const restRot = restRotations.get(bName) || new THREE.Euler(0, 0, 0);
    const restPos = restPositions.get(bName) || new THREE.Vector3(0, 0, 0);

    for (const kf of sorted) {
      const k = kf.boneTransforms[bName];
      if (!k) continue;
      times.push(kf.time);
      euler.set(restRot.x + k.rotation[0], restRot.y + k.rotation[1], restRot.z + k.rotation[2]);
      q.setFromEuler(euler);
      quats.push(q.x, q.y, q.z, q.w);

      if (k.position) {
        posTimes.push(kf.time);
        posVals.push(restPos.x + k.position[0], restPos.y + k.position[1], restPos.z + k.position[2]);
      }
    }

    // Ensure at least 2 key samples if only 1 keyframe exists so Three.js AnimationClip interpolates cleanly
    if (times.length === 1) {
      times.push(Math.max(times[0] + 0.1, duration));
      quats.push(quats[0], quats[1], quats[2], quats[3]);
    }
    if (times.length >= 2) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bName}.quaternion`, times, quats));
    }
    if (posTimes.length === 1) {
      posTimes.push(Math.max(posTimes[0] + 0.1, duration));
      posVals.push(posVals[0], posVals[1], posVals[2]);
    }
    if (posTimes.length >= 2) {
      tracks.push(new THREE.VectorKeyframeTrack(`${bName}.position`, posTimes, posVals));
    }
  }

  const maxTime = Math.max(duration, sorted[sorted.length - 1]?.time ?? duration);
  return new THREE.AnimationClip(clipName, maxTime, tracks);
}

/**
 * Snapshots all live bone rotations and position offsets relative to bind rest pose.
 */
export function captureCurrentPoseAsKey(
  bonesByName: Map<string, THREE.Bone>,
  restPositions: Map<string, THREE.Vector3>,
  restRotations: Map<string, THREE.Euler>,
): Record<string, AnimationBoneKey> {
  const result: Record<string, AnimationBoneKey> = {};
  for (const [name, bone] of bonesByName.entries()) {
    const rr = restRotations.get(name);
    const rp = restPositions.get(name);
    result[name] = {
      rotation: [
        Number((bone.rotation.x - (rr?.x ?? 0)).toFixed(4)),
        Number((bone.rotation.y - (rr?.y ?? 0)).toFixed(4)),
        Number((bone.rotation.z - (rr?.z ?? 0)).toFixed(4)),
      ],
      ...(rp
        ? {
            position: [
              Number((bone.position.x - rp.x).toFixed(4)),
              Number((bone.position.y - rp.y).toFixed(4)),
              Number((bone.position.z - rp.z).toFixed(4)),
            ],
          }
        : {}),
    };
  }
  return result;
}

export interface SerializedAnimationClip {
  version: 1;
  name: string;
  duration: number;
  keyframes: AnimationKeyframe[];
}

export function serializeAnimationClipJSON(
  clipName: string,
  duration: number,
  keyframes: AnimationKeyframe[],
): string {
  const payload: SerializedAnimationClip = {
    version: 1,
    name: clipName,
    duration,
    keyframes,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Imports either a Sovereign JSON animation sequence or extracts the first AnimationClip
 * from a binary .GLB / .GLTF file into editable Studio keyframes.
 */
export async function parseImportedAnimationFile(
  file: File,
  restRotations: Map<string, THREE.Euler>,
): Promise<{ name: string; duration: number; keyframes: AnimationKeyframe[] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.json')) {
    const raw = JSON.parse(await file.text()) as Partial<SerializedAnimationClip>;
    if (!Array.isArray(raw.keyframes) || raw.keyframes.length === 0) {
      throw new Error('JSON file contains no animation keyframes.');
    }
    const cleanKeyframes: AnimationKeyframe[] = raw.keyframes.map((kf, i) => ({
      id: kf.id || `imp_${Date.now()}_${i}`,
      time: Number(kf.time) || 0,
      boneTransforms: kf.boneTransforms || {},
    }));
    const dur = Math.max(
      1,
      Number(raw.duration) || cleanKeyframes[cleanKeyframes.length - 1]?.time || 3,
    );
    return {
      name: raw.name || file.name.replace(/\.json$/i, ''),
      duration: dur,
      keyframes: cleanKeyframes,
    };
  }

  // GLB / GLTF clip extraction
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const buf = await file.arrayBuffer();
  const gltf = await new Promise<{ animations: THREE.AnimationClip[] }>((resolve, reject) => {
    loader.parse(buf, '', (res) => resolve(res), (err) => reject(err));
  });

  if (!gltf.animations || gltf.animations.length === 0) {
    throw new Error('GLB/GLTF file contains no embedded animation clips.');
  }

  const clip = gltf.animations[0];
  const duration = Math.max(1, Number(clip.duration.toFixed(2)));
  const sampleCount = Math.min(24, Math.max(5, Math.round(duration * 6) + 1));

  // Sample tracks cleanly into Studio AnimationKeyframe sequence
  const dummyQ = new THREE.Quaternion();
  const dummyEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const keyframes: AnimationKeyframe[] = [];

  for (let s = 0; s < sampleCount; s++) {
    const t = Number(((s / (sampleCount - 1)) * duration).toFixed(3));
    const boneTransforms: Record<string, AnimationBoneKey> = {};

    for (const track of clip.tracks) {
      if (!track.name.endsWith('.quaternion')) continue;
      const boneName = track.name.split('.')[0];
      const times = track.times;
      const vals = track.values;
      if (times.length === 0) continue;

      // Nearest-or-lerp sample along track
      let idx = 0;
      while (idx + 1 < times.length && times[idx + 1] <= t) idx++;
      const base = idx * 4;
      dummyQ.set(vals[base], vals[base + 1], vals[base + 2], vals[base + 3]);
      if (idx + 1 < times.length && times[idx + 1] > times[idx]) {
        const nextBase = (idx + 1) * 4;
        const alpha = (t - times[idx]) / (times[idx + 1] - times[idx]);
        const q2 = new THREE.Quaternion(
          vals[nextBase],
          vals[nextBase + 1],
          vals[nextBase + 2],
          vals[nextBase + 3],
        );
        dummyQ.slerp(q2, THREE.MathUtils.clamp(alpha, 0, 1));
      }
      dummyEuler.setFromQuaternion(dummyQ, 'XYZ');
      const rr = restRotations.get(boneName);
      boneTransforms[boneName] = {
        rotation: [
          Number((dummyEuler.x - (rr?.x ?? 0)).toFixed(4)),
          Number((dummyEuler.y - (rr?.y ?? 0)).toFixed(4)),
          Number((dummyEuler.z - (rr?.z ?? 0)).toFixed(4)),
        ],
      };
    }

    keyframes.push({
      id: `glb_kf_${s}_${Date.now()}`,
      time: t,
      boneTransforms,
    });
  }

  return {
    name: clip.name || file.name.replace(/\.(glb|gltf)$/i, ''),
    duration,
    keyframes,
  };
}

