import * as THREE from 'three';
import type { AvatarEmote } from '../types';
import type { LocomotionMoveState } from './locomotion';
import {
  buildRetargetedClipSet,
  resolveDesiredMotionState,
  type AnimationMotionState,
} from './animationRetargeter';

/**
 * Production AnimationMixer state machine supporting smooth crossFadeTo transitions,
 * speed-proportional stride timeScale, and automatic fallback-safe rest restoration.
 */
export class AnimationStateMachine {
  public readonly mixer: THREE.AnimationMixer;
  public readonly actions = new Map<AnimationMotionState, THREE.AnimationAction>();
  private currentState: AnimationMotionState = 'idle';
  private initialized = false;

  constructor(
    root: THREE.Object3D,
    bonesByName: Map<string, THREE.Bone>,
    restPositions?: Map<string, THREE.Vector3>,
    restRotations?: Map<string, THREE.Euler>,
    nativeClips: THREE.AnimationClip[] = [],
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const clips = buildRetargetedClipSet(
      root,
      bonesByName,
      restPositions,
      restRotations,
      nativeClips,
      true,
    );

    for (const [state, clip] of clips.entries()) {
      const action = this.mixer.clipAction(clip);
      if (state === 'land') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(state, action);
    }

    const initial = this.actions.get('idle');
    if (initial) {
      initial.reset().play();
      this.initialized = true;
    }
  }

  public getState(): AnimationMotionState {
    return this.currentState;
  }

  public transitionTo(nextState: AnimationMotionState, fadeDuration = 0.18): void {
    const nextAction = this.actions.get(nextState) ?? this.actions.get('idle');
    if (!nextAction) return;

    if (!this.initialized) {
      nextAction.reset().play();
      this.currentState = nextState;
      this.initialized = true;
      return;
    }

    if (nextState === this.currentState) return;

    const prevAction = this.actions.get(this.currentState);
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveWeight(1);
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, fadeDuration, false);
    }

    this.currentState = nextState;
  }

  public update(
    dt: number,
    moveState: LocomotionMoveState,
    speed: number,
    emote: AvatarEmote,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.001), 0.05);
    const target = resolveDesiredMotionState(moveState, emote);

    const fadeDuration =
      target === 'jump' || target === 'land'
        ? 0.1
        : target === 'fall'
          ? 0.14
          : 0.2;

    this.transitionTo(target, fadeDuration);

    const activeAction = this.actions.get(this.currentState);
    if (activeAction) {
      // Scale stride cycle speed cleanly by actual ground velocity so feet lock without skating
      if (this.currentState === 'walk') {
        activeAction.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 3.4, 0.55, 1.55));
      } else if (this.currentState === 'run') {
        activeAction.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 5.4, 0.75, 1.45));
      } else if (this.currentState === 'sprint') {
        activeAction.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 8.0, 0.85, 1.5));
      } else {
        activeAction.setEffectiveTimeScale(1.0);
      }
    }

    this.mixer.update(safeDt);
  }

  public dispose(): void {
    this.mixer.stopAllAction();
  }
}
