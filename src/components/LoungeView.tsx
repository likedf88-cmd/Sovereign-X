import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ChevronDown,
  ChevronUp,
  Send,
  Monitor,
  Smartphone,
  Gamepad2,
  Users,
  Flag,
  X,
  Crown,
  Volume2,
  VolumeX,
  Compass,
  Zap,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type {
  AvatarEmote,
  LoungeChatMessage,
  LoungeMember,
  ReportReason,
  ReportTargetType,
  RiggedModelConfig,
  UserProfile,
  PlatformMode,
} from '../types';
import { DEFAULT_AVATAR_PRESETS } from '../data/catalog';
import {
  createLuxuryObsidianFloorTexture,
  createStudioBloomComposer,
  createStudioWebGLContext,
} from '../three/riggingEngine';
import { applyLocomotionPose } from '../three/proceduralAvatars';
import {
  ARENA_SURFACES,
  LocomotionController,
  applyFootPlacementIK,
  createActorAnimState,
  dampAngle,
  updateActorAnimState,
  type LocomotionMoveState,
} from '../three/locomotion';
import { CharacterSpawner } from '../three/characterSpawner';
import { MultiplayerCharacterSync } from '../three/multiplayerSync';
import { useGlobalAudio } from '../utils/audioEngine';

interface LoungeViewProps {
  profile: UserProfile;
  riggedModels: RiggedModelConfig[];
  onSwitchPlatform: (p: PlatformMode) => void;
  onChangeEmote: (emote: AvatarEmote) => void;
  onEquipAvatar?: (avatarId: string) => void;
  onEarnArenaReward?: (credits: number, xp: number) => Promise<void> | void;
  onCreateReport?: (input: {
    targetType: ReportTargetType;
    targetId: string;
    targetAuthorId?: string;
    targetAuthorName: string;
    targetExcerpt: string;
    reason: ReportReason;
    details?: string;
  }) => Promise<void>;
}

interface ProjectedLabel {
  clientId: string;
  displayName: string;
  platform: PlatformMode;
  loyaltyRank: string;
  chatText?: string;
  x: number;
  y: number;
  visible: boolean;
}

interface ArenaShardNode {
  id: number;
  x: number;
  y: number;
  z: number;
  mythic: boolean;
  points: number;
  respawnAt: number;
  mesh: THREE.Mesh;
}

interface JumpPadNode {
  x: number;
  z: number;
  impulse: number;
  cooldownUntil: number;
  ring: THREE.Mesh;
}

const LOUNGE_EMOTES: Array<{ id: AvatarEmote; label: string }> = [
  { id: 'idle', label: 'Stand' },
  { id: 'wave', label: 'Wave' },
  { id: 'dance', label: 'Dance' },
  { id: 'hero', label: 'Hero' },
  { id: 'jump', label: 'Jump' },
];

const _projVec = new THREE.Vector3();
const _gpCamOffset = new THREE.Vector3();
const _worldYAxis = new THREE.Vector3(0, 1, 0);

type ArenaSfxKind = 'jump' | 'land' | 'pad' | 'dash' | 'shard' | 'reward';

export const LoungeView: React.FC<LoungeViewProps> = ({
  profile,
  riggedModels,
  onSwitchPlatform,
  onChangeEmote,
  onEquipAvatar,
  onEarnArenaReward,
  onCreateReport,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const netSyncRef = useRef<MultiplayerCharacterSync | null>(null);
  const spawnerRef = useRef<CharacterSpawner>(new CharacterSpawner());
  const selfClientIdRef = useRef<string>(
    `member_${profile.uid.slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}`,
  );

  const profileRef = useRef(profile);
  const riggedModelsRef = useRef(riggedModels);
  const onEarnRewardRef = useRef(onEarnArenaReward);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    riggedModelsRef.current = riggedModels;
  }, [riggedModels]);
  useEffect(() => {
    onEarnRewardRef.current = onEarnArenaReward;
  }, [onEarnArenaReward]);

  // Smooth locomotion physics & input refs (zero React re-renders inside render loop)
  const keysRef = useRef<Record<string, boolean>>({});
  const joystickRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const jumpQueuedRef = useRef(false);
  const dashQueuedRef = useRef(false);
  const locoRef = useRef<LocomotionController>(new LocomotionController());

  // Procedural Web Audio synthesizer synced with global persisted mute state
  const { isMuted: sfxMuted, toggleMute: toggleGlobalMute, getAudioContext } = useGlobalAudio();
  const sfxMutedRef = useRef(sfxMuted);
  useEffect(() => {
    sfxMutedRef.current = sfxMuted;
  }, [sfxMuted]);

  const playArenaSfx = (kind: ArenaSfxKind) => {
    if (sfxMutedRef.current) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (kind === 'jump') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.14);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (kind === 'land') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(62, now + 0.11);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (kind === 'pad') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(860, now + 0.25);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
        osc.start(now);
        osc.stop(now + 0.28);
      } else if (kind === 'dash') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (kind === 'shard') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(990, now + 0.06);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        osc.frequency.setValueAtTime(1046.5, now + 0.24);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.start(now);
        osc.stop(now + 0.44);
      }
    } catch {
      // Audio playback blocked or unavailable
    }
  };

  const [members, setMembers] = useState<LoungeMember[]>([]);
  const [chatFeed, setChatFeed] = useState<LoungeChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [reportingMsg, setReportingMsg] = useState<LoungeChatMessage | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSentNote, setReportSentNote] = useState<string | null>(null);

  // Arena Game & Avatar Switcher HUD states
  const [arenaScore, setArenaScore] = useState(0);
  const [shardsCollected, setShardsCollected] = useState(0);
  const [arenaBanner, setArenaBanner] = useState<string | null>(null);
  const [loadingAvatarName, setLoadingAvatarName] = useState<string | null>(null);
  const [avatarWarning, setAvatarWarning] = useState<string | null>(null);

  const arenaStatsRef = useRef({ score: 0, shards: 0 });

  // Refs for 3D scene
  const sceneRef = useRef<THREE.Scene | null>(null);

  const avatarOptions = useMemo(() => {
    const customList = riggedModels.map((rm) => ({
      id: rm.id,
      name: rm.name,
      isCustomGLB: rm.sourceType === 'glb-custom',
    }));
    const seen = new Set<string>();
    const combined: Array<{ id: string; name: string; tag: string }> = [];
    for (const c of customList) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      combined.push({
        id: c.id,
        name: c.name,
        tag: c.isCustomGLB ? 'Custom GLB' : 'Custom Rig',
      });
    }
    for (const p of DEFAULT_AVATAR_PRESETS) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      combined.push({ id: p.id, name: p.name, tag: 'Chassis' });
    }
    return combined;
  }, [riggedModels]);

  // Broadcast avatar/emote/platform changes over WebSocket & reflect immediately on local member
  useEffect(() => {
    setMembers((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((m) =>
        m.clientId === selfClientIdRef.current
          ? {
              ...m,
              displayName: profile.displayName,
              platform: profile.platform,
              loyaltyRank: profile.loyaltyRank,
              equippedAvatarId: profile.equippedAvatarId,
              emote: profile.equippedEmote,
            }
          : m,
      );
    });

    netSyncRef.current?.sendState({
      displayName: profile.displayName,
      platform: profile.platform,
      loyaltyRank: profile.loyaltyRank,
      equippedAvatarId: profile.equippedAvatarId,
      emote: profile.equippedEmote,
    });
  }, [
    profile.displayName,
    profile.platform,
    profile.loyaltyRank,
    profile.equippedAvatarId,
    profile.equippedEmote,
  ]);

  // WebSocket Connection to /ws via MultiplayerCharacterSync
  useEffect(() => {
    const sync = new MultiplayerCharacterSync(
      selfClientIdRef.current,
      () => {
        const p = profileRef.current;
        const loco = locoRef.current;
        return {
          uid: p.uid,
          displayName: p.displayName,
          handle: p.handle,
          platform: p.platform,
          loyaltyRank: p.loyaltyRank,
          equippedAvatarId: p.equippedAvatarId,
          emote: p.equippedEmote,
          x: loco.pos.x,
          y: loco.pos.y,
          z: loco.pos.z,
          yaw: loco.yaw,
        };
      },
      {
        onInit: (list) => setMembers(list),
        onUserJoined: (member) =>
          setMembers((prev) =>
            prev.some((m) => m.clientId === member.clientId) ? prev : [...prev, member],
          ),
        onUserMoved: (patch) => {
          const actor = spawnerRef.current.actors.get(patch.clientId);
          if (actor) {
            actor.targetPos.set(patch.x, patch.y, patch.z);
            actor.targetYaw = patch.yaw;
            actor.member.emote = patch.emote;
            actor.targetMoveState = patch.moveState;
            actor.targetSpeed = patch.speed;
          }
        },
        onUserUpdated: (member) =>
          setMembers((prev) =>
            prev.some((m) => m.clientId === member.clientId)
              ? prev.map((m) => (m.clientId === member.clientId ? member : m))
              : [...prev, member],
          ),
        onUserLeft: (clientId) =>
          setMembers((prev) => prev.filter((m) => m.clientId !== clientId)),
        onChatMessage: (msg) => {
          setChatFeed((prev) => [...prev.slice(-24), msg]);
          const actor = spawnerRef.current.actors.get(msg.clientId);
          if (actor) {
            actor.member.chatText = msg.text;
            actor.member.chatExpiresAt = Date.now() + 7000;
          }
        },
        onConnectionChange: (online) => setWsConnected(online),
      },
    );
    netSyncRef.current = sync;
    sync.connect();

    return () => {
      sync.dispose();
      netSyncRef.current = null;
    };
  }, []);

  // Ensure local player spawns in 3D scene immediately even if WebSocket is offline/slow
  useEffect(() => {
    setMembers((prev) => {
      if (prev.some((m) => m.clientId === selfClientIdRef.current)) return prev;
      return [
        {
          clientId: selfClientIdRef.current,
          uid: profile.uid,
          displayName: profile.displayName,
          handle: profile.handle,
          platform: profile.platform,
          loyaltyRank: profile.loyaltyRank,
          equippedAvatarId: profile.equippedAvatarId,
          emote: profile.equippedEmote,
          moveState: 'idle',
          speed: 0,
          x: locoRef.current.pos.x,
          y: locoRef.current.pos.y,
          z: locoRef.current.pos.z,
          yaw: locoRef.current.yaw,
          updatedAt: Date.now(),
        },
        ...prev,
      ];
    });
  }, [profile.uid]);

  // Sync member list + riggedModels updates with CharacterSpawner (upgrades fallback -> Custom GLB automatically)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    spawnerRef.current.syncMembers(
      scene,
      members,
      riggedModels,
      selfClientIdRef.current,
      {
        onLoadingChange: setLoadingAvatarName,
        onWarning: setAvatarWarning,
      },
    );
  }, [members, riggedModels]);

  // Main Three.js 3D Sanctuary Lounge + Arena Scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const studio = createStudioWebGLContext(container);
    const { renderer, isSoftwareGl, setupEnvironment, afterDraw } = studio;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060911);
    scene.fog = new THREE.FogExp2(0x060911, 0.02);
    setupEnvironment(scene);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      52,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.1,
      140,
    );
    camera.position.set(0, 4.4, 12.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, 6.0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = 3.0;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    // 3-Point Sanctuary Lighting Rig
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x090d16, 0.85);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.15);
    sun.position.set(8, 18, 10);
    sun.castShadow = !isSoftwareGl;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    const backRim = new THREE.DirectionalLight(0x3b82f6, 1.9);
    backRim.position.set(-10, 9, -14);
    scene.add(backRim);

    const loungeGroup = new THREE.Group();
    scene.add(loungeGroup);

    // Luxury Obsidian Marble Floor
    const floorTex = createLuxuryObsidianFloorTexture(renderer);
    floorTex.repeat.set(12, 12);
    const floorGeo = new THREE.CircleGeometry(28, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0b101b,
      map: floorTex,
      metalness: 0.78,
      roughness: 0.24,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    loungeGroup.add(floor);

    const gridHelper = new THREE.PolarGridHelper(22, 12, 6, 64, 0xd4af37, 0x1e293b);
    gridHelper.position.y = 0.02;
    loungeGroup.add(gridHelper);

    const goldAccentMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      emissive: 0xb45309,
      emissiveIntensity: 1.4,
      metalness: 0.94,
      roughness: 0.2,
    });

    const cobaltGlowMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x2563eb,
      emissiveIntensity: 2.0,
      metalness: 0.4,
      roughness: 0.2,
    });

    // Raised Sovereign VIP Dais (ARENA_SURFACES[0]: y=0.36 at (0, -7.5) r=4.2)
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.8, 0.36, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0x0e1424,
        metalness: 0.88,
        roughness: 0.18,
        clearcoat: 1.0,
      }),
    );
    dais.position.set(0, 0.18, -7.5);
    dais.receiveShadow = true;
    loungeGroup.add(dais);

    const daisTrim = new THREE.Mesh(
      new THREE.TorusGeometry(4.22, 0.04, 12, 64),
      goldAccentMat,
    );
    daisTrim.rotation.x = Math.PI / 2;
    daisTrim.position.set(0, 0.37, -7.5);
    loungeGroup.add(daisTrim);

    // Holo-Dance Aura Ring on VIP Dais
    const holoDanceRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.035, 10, 64),
      cobaltGlowMat,
    );
    holoDanceRing.rotation.x = Math.PI / 2;
    holoDanceRing.position.set(0, 0.38, -7.5);
    loungeGroup.add(holoDanceRing);

    // Elevated Sky Platforms & Central Upper Sanctuary Bridge (synced 1:1 with ARENA_SURFACES)
    const platformMat = new THREE.MeshPhysicalMaterial({
      color: 0x10182b,
      metalness: 0.86,
      roughness: 0.18,
      clearcoat: 1.0,
    });

    ARENA_SURFACES.slice(1).forEach((surf) => {
      if (surf.type === 'circle' && surf.radius !== undefined) {
        const deck = new THREE.Mesh(
          new THREE.CylinderGeometry(surf.radius, surf.radius * 0.85, 0.24, 36),
          platformMat,
        );
        deck.position.set(surf.x, surf.y - 0.12, surf.z);
        deck.castShadow = true;
        deck.receiveShadow = true;
        loungeGroup.add(deck);

        const trim = new THREE.Mesh(
          new THREE.TorusGeometry(surf.radius + 0.02, 0.035, 10, 48),
          cobaltGlowMat,
        );
        trim.rotation.x = Math.PI / 2;
        trim.position.set(surf.x, surf.y + 0.01, surf.z);
        loungeGroup.add(trim);
      } else if (surf.type === 'box' && surf.halfW !== undefined && surf.halfD !== undefined) {
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(surf.halfW * 2, 0.24, surf.halfD * 2),
          platformMat,
        );
        bridge.position.set(surf.x, surf.y - 0.12, surf.z);
        bridge.castShadow = true;
        bridge.receiveShadow = true;
        loungeGroup.add(bridge);

        const bridgeTrim = new THREE.Mesh(
          new THREE.BoxGeometry(surf.halfW * 2 + 0.08, 0.05, surf.halfD * 2 + 0.08),
          goldAccentMat,
        );
        bridgeTrim.position.set(surf.x, surf.y - 0.01, surf.z);
        loungeGroup.add(bridgeTrim);
      }
    });

    // Colossal Monolith Towers behind Dais
    const monolithMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b101d,
      metalness: 0.92,
      roughness: 0.12,
      clearcoat: 1.0,
    });
    [-4.8, 0, 4.8].forEach((mx, idx) => {
      const h = idx === 1 ? 6.4 : 4.8;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.8, h, 0.4), monolithMat);
      tower.position.set(mx, h / 2, -13.5);
      tower.castShadow = true;
      loungeGroup.add(tower);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.08, 0.44), goldAccentMat);
      strip.position.set(mx, h - 0.5, -13.5);
      loungeGroup.add(strip);
    });

    // Composite Lounge Seating Alcoves (4 alcoves around the hall)
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x151e32, roughness: 0.6, metalness: 0.22 });
    const tableMat = new THREE.MeshPhysicalMaterial({ color: 0x090d16, roughness: 0.14, metalness: 0.9, clearcoat: 1 });
    const alcovePositions: Array<[number, number, number]> = [
      [-8.5, 0, 2],
      [8.5, 0, 2],
      [-7.5, 0, -4.5],
      [7.5, 0, -4.5],
    ];
    alcovePositions.forEach(([ax, ay, az]) => {
      const alcove = new THREE.Group();
      alcove.position.set(ax, ay, az);
      alcove.lookAt(0, 0, 0);

      const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.42, 1.1), sofaMat);
      base.position.set(0, 0.21, -0.7);
      base.castShadow = true;
      base.receiveShadow = true;
      alcove.add(base);

      const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.65, 0.25), sofaMat);
      back.position.set(0, 0.55, -1.15);
      back.castShadow = true;
      alcove.add(back);

      const table = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.55, 0.35, 24), tableMat);
      table.position.set(0, 0.175, 0.45);
      table.castShadow = true;
      alcove.add(table);

      const tableGlow = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.015, 8, 32), goldAccentMat);
      tableGlow.rotation.x = Math.PI / 2;
      tableGlow.position.set(0, 0.355, 0.45);
      alcove.add(tableGlow);

      loungeGroup.add(alcove);
    });

    // 4 Anti-Gravity Jump Pads launching players onto the Sky Platforms & Upper Bridge
    const padCoords: Array<{ x: number; z: number; impulse: number }> = [
      { x: -6.8, z: -5.2, impulse: 11.8 },
      { x: 6.8, z: -5.2, impulse: 11.8 },
      { x: -4.2, z: 1.4, impulse: 10.6 },
      { x: 4.2, z: 1.4, impulse: 10.6 },
    ];
    const padGeo = new THREE.CylinderGeometry(0.95, 1.05, 0.08, 32);
    const padRingGeo = new THREE.TorusGeometry(0.92, 0.04, 10, 36);
    const jumpPads: JumpPadNode[] = padCoords.map((p) => {
      const base = new THREE.Mesh(padGeo, platformMat);
      base.position.set(p.x, 0.04, p.z);
      loungeGroup.add(base);

      const ring = new THREE.Mesh(padRingGeo, cobaltGlowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.1, p.z);
      loungeGroup.add(ring);

      return { x: p.x, z: p.z, impulse: p.impulse, cooldownUntil: 0, ring };
    });

    // 12 Collectible Crown Shards (Cobalt +50 pts around hall, Mythic Gold +150 pts on Sky Platforms & Upper Bridge)
    const shardGeo = new THREE.OctahedronGeometry(0.28, 0);
    const cobaltShardMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x2563eb,
      emissiveIntensity: 1.8,
      metalness: 0.6,
      roughness: 0.18,
    });
    const mythicShardMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xd97706,
      emissiveIntensity: 2.2,
      metalness: 0.85,
      roughness: 0.12,
    });

    const shardSpots: Array<{ x: number; y: number; z: number; mythic: boolean }> = [
      { x: 0, y: 1.35, z: -7.5, mythic: false },
      { x: -5.5, y: 1.15, z: 4.5, mythic: false },
      { x: 5.5, y: 1.15, z: 4.5, mythic: false },
      { x: -11.5, y: 1.15, z: -1.0, mythic: false },
      { x: 11.5, y: 1.15, z: -1.0, mythic: false },
      { x: 0, y: 1.15, z: -1.5, mythic: false },
      { x: -7.5, y: 1.15, z: 8.5, mythic: false },
      { x: 7.5, y: 1.15, z: 8.5, mythic: false },
      { x: 0, y: 1.15, z: 11.2, mythic: false },
      // Sky Platform & Upper Bridge Mythic Shards
      { x: -9.5, y: 4.2, z: -8.5, mythic: true },
      { x: 9.5, y: 4.2, z: -8.5, mythic: true },
      { x: 0, y: 5.6, z: -10.5, mythic: true },
    ];

    const arenaShards: ArenaShardNode[] = shardSpots.map((sp, idx) => {
      const mesh = new THREE.Mesh(shardGeo, sp.mythic ? mythicShardMat : cobaltShardMat);
      mesh.position.set(sp.x, sp.y, sp.z);
      loungeGroup.add(mesh);
      return {
        id: idx,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        mythic: sp.mythic,
        points: sp.mythic ? 150 : 50,
        respawnAt: 0,
        mesh,
      };
    });

    // Bloom Post-Processing Composer (GPU-guarded)
    const bloom = createStudioBloomComposer(
      renderer,
      scene,
      camera,
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
      isSoftwareGl,
      0.26,
      0.45,
      0.88,
    );

    // Click-to-Move Raycaster on Lounge Floor
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const distMoved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (distMoved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(floor, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const clampedLen = Math.min(22, Math.hypot(pt.x, pt.z));
        const angle = Math.atan2(pt.z, pt.x);
        locoRef.current.clickTarget = new THREE.Vector3(
          Math.cos(angle) * clampedLen,
          0,
          Math.sin(angle) * clampedLen,
        );
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Keyboard Listeners (PC: WASD/Arrows, Space Jump, Shift Sprint, E Dash)
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'SELECT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      keysRef.current[e.code] = true;
      if (e.code === 'Space') jumpQueuedRef.current = true;
      if (e.code === 'KeyE') dashQueuedRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Gamepad connect detection (Console)
    const onGamepadConnect = () => setGamepadConnected(true);
    const onGamepadDisconnect = () => setGamepadConnected(false);
    window.addEventListener('gamepadconnected', onGamepadConnect);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnect);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      bloom?.resize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let lastLabelSync = 0;
    let lastGamepadBtnTime = 0;
    const localAnimState = createActorAnimState();

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      // Poll Console Gamepad (Web Gamepad API)
      let gpMoveX = 0;
      let gpMoveY = 0;
      let gpCamX = 0;
      let gpSprint = false;
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads.find((g) => g && g.connected);
      if (gp) {
        if (!gamepadConnected) setGamepadConnected(true);
        gpMoveX = Math.abs(gp.axes[0] || 0) > 0.16 ? gp.axes[0] : 0;
        gpMoveY = Math.abs(gp.axes[1] || 0) > 0.16 ? gp.axes[1] : 0;
        gpCamX = Math.abs(gp.axes[2] || 0) > 0.16 ? gp.axes[2] : 0;
        gpSprint = Boolean(gp.buttons[10]?.pressed || gp.buttons[7]?.pressed);
        if (gp.buttons[0]?.pressed) jumpQueuedRef.current = true;
        if (gp.buttons[5]?.pressed) dashQueuedRef.current = true;
        if (elapsed - lastGamepadBtnTime > 0.4) {
          if (gp.buttons[1]?.pressed) {
            onChangeEmote('wave');
            lastGamepadBtnTime = elapsed;
          } else if (gp.buttons[2]?.pressed) {
            onChangeEmote('dance');
            lastGamepadBtnTime = elapsed;
          } else if (gp.buttons[3]?.pressed) {
            onChangeEmote('hero');
            lastGamepadBtnTime = elapsed;
          }
        }
      }

      const loco = locoRef.current;

      // Queued Jump & Dash triggers
      if (jumpQueuedRef.current) {
        if (loco.triggerJump(7.6)) {
          playArenaSfx('jump');
        }
        jumpQueuedRef.current = false;
      }
      if (dashQueuedRef.current) {
        if (loco.triggerDash()) {
          playArenaSfx('dash');
        }
        dashQueuedRef.current = false;
      }

      // Compute movement input & step smoothed locomotion controller
      const keys = keysRef.current;
      let inputX = Number(Boolean(keys.KeyD || keys.ArrowRight)) - Number(Boolean(keys.KeyA || keys.ArrowLeft));
      let inputZ = Number(Boolean(keys.KeyS || keys.ArrowDown)) - Number(Boolean(keys.KeyW || keys.ArrowUp));
      inputX += joystickRef.current.dx + gpMoveX;
      inputZ += joystickRef.current.dy + gpMoveY;
      const sprint = Boolean(keys.ShiftLeft || keys.ShiftRight || gpSprint);

      const snap = loco.step(dt, inputX, inputZ, sprint, camera);
      if (snap.justLanded) {
        playArenaSfx('land');
      }

      // Jump Pad triggers
      for (let i = 0; i < jumpPads.length; i++) {
        const pad = jumpPads[i];
        pad.ring.position.y = 0.11 + Math.sin(elapsed * 4.5 + i) * 0.04;
        if (elapsed > pad.cooldownUntil && loco.pos.y < 0.6) {
          const dx = loco.pos.x - pad.x;
          const dz = loco.pos.z - pad.z;
          if (dx * dx + dz * dz < 1.05 * 1.05) {
            loco.launchVertical(pad.impulse);
            pad.cooldownUntil = elapsed + 0.65;
            playArenaSfx('pad');
          }
        }
      }

      // Holo-Dance Floor visual pulse
      holoDanceRing.scale.setScalar(1 + Math.sin(elapsed * 2.5) * 0.03);

      // Crown Shard rotation, respawn, and collection physics
      for (let i = 0; i < arenaShards.length; i++) {
        const s = arenaShards[i];
        if (!s.mesh.visible) {
          if (elapsed >= s.respawnAt) {
            s.mesh.visible = true;
          }
          continue;
        }
        s.mesh.rotation.y = elapsed * 2.2 + i;
        s.mesh.position.y = s.y + Math.sin(elapsed * 2.8 + i) * 0.14;

        const dx = loco.pos.x - s.x;
        const dz = loco.pos.z - s.z;
        const dy = Math.abs(loco.pos.y + 0.95 - s.y);
        if (dx * dx + dz * dz < 1.25 * 1.25 && dy < 1.55) {
          s.mesh.visible = false;
          s.respawnAt = elapsed + 14;
          const onDaisDance =
            Math.hypot(loco.pos.x, loco.pos.z + 7.5) < 4.3 &&
            profileRef.current.equippedEmote === 'dance';
          const earnedPts = onDaisDance ? s.points * 2 : s.points;
          arenaStatsRef.current.score += earnedPts;
          arenaStatsRef.current.shards += 1;
          setArenaScore(arenaStatsRef.current.score);
          setShardsCollected(arenaStatsRef.current.shards);

          if (arenaStatsRef.current.shards % 5 === 0) {
            playArenaSfx('reward');
            setArenaBanner('+100 Sovereign Credits & +50 XP Earned!');
            window.setTimeout(() => setArenaBanner(null), 3200);
            void onEarnRewardRef.current?.(100, 50);
          } else {
            playArenaSfx('shard');
          }
        }
      }

      // Console Right Stick Camera Orbit (zero vector allocations)
      if (Math.abs(gpCamX) > 0) {
        _gpCamOffset.subVectors(camera.position, controls.target);
        _gpCamOffset.applyAxisAngle(_worldYAxis, -gpCamX * 2.2 * dt);
        camera.position.copy(controls.target).add(_gpCamOffset);
      }

      // Smoothly track local player with camera target
      const desiredTargetY = snap.y + 1.35;
      controls.target.x = THREE.MathUtils.damp(controls.target.x, snap.x, 9, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, desiredTargetY, 9, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, snap.z, 9, dt);
      controls.update();

      const activeEmote: AvatarEmote =
        snap.moveState === 'jump' || snap.moveState === 'fall'
          ? 'jump'
          : snap.moveState === 'sprint' || snap.moveState === 'run'
            ? 'run'
            : snap.moveState === 'walk'
              ? 'walk'
              : profileRef.current.equippedEmote;

      localAnimState.stridePhase = snap.stridePhase;
      localAnimState.smoothedSpeed = snap.speed;
      localAnimState.airBlend = snap.grounded ? 0 : 1;
      localAnimState.landSquash = snap.landImpulse;
      localAnimState.moveState = snap.moveState;
      localAnimState.emote = profileRef.current.equippedEmote;

      const selfActor = spawnerRef.current.actors.get(selfClientIdRef.current);
      if (selfActor) {
        selfActor.currentPos.set(snap.x, snap.y, snap.z);
        selfActor.avatar.root.position.set(snap.x, snap.y, snap.z);
        selfActor.avatar.root.rotation.y = snap.yaw;
        selfActor.member.emote = activeEmote;
      }

      for (const [id, actor] of spawnerRef.current.actors.entries()) {
        if (id !== selfClientIdRef.current) {
          actor.currentPos.x = THREE.MathUtils.damp(actor.currentPos.x, actor.targetPos.x, 10, dt);
          actor.currentPos.y = THREE.MathUtils.damp(actor.currentPos.y, actor.targetPos.y, 10, dt);
          actor.currentPos.z = THREE.MathUtils.damp(actor.currentPos.z, actor.targetPos.z, 10, dt);
          actor.avatar.root.position.copy(actor.currentPos);
          actor.avatar.root.rotation.y = dampAngle(
            actor.avatar.root.rotation.y,
            actor.targetYaw,
            12,
            dt,
          );
          updateActorAnimState(
            actor.animState,
            actor.targetSpeed,
            actor.targetMoveState,
            actor.member.emote || 'idle',
            dt,
          );
          if (actor.avatar.stateMachine) {
            actor.avatar.stateMachine.update(
              dt,
              actor.targetMoveState,
              actor.animState.smoothedSpeed,
              actor.member.emote || 'idle',
            );
          } else {
            applyLocomotionPose(
              actor.avatar.bonesByName,
              actor.animState,
              elapsed,
              actor.avatar.restPositions,
              actor.avatar.restRotations,
            );
          }
          applyFootPlacementIK(
            actor.avatar.root,
            actor.avatar.bonesByName,
            actor.currentPos.y,
            actor.avatar.root.rotation.y,
            actor.targetMoveState !== 'jump' && actor.targetMoveState !== 'fall',
          );
        } else {
          if (actor.avatar.stateMachine) {
            actor.avatar.stateMachine.update(
              dt,
              snap.moveState,
              snap.speed,
              profileRef.current.equippedEmote,
            );
          } else {
            applyLocomotionPose(
              actor.avatar.bonesByName,
              localAnimState,
              elapsed,
              actor.avatar.restPositions,
              actor.avatar.restRotations,
            );
          }
          applyFootPlacementIK(
            actor.avatar.root,
            actor.avatar.bonesByName,
            snap.y,
            snap.yaw,
            snap.grounded,
          );
        }
      }

      // Throttled WebSocket Position & Locomotion Sync (15Hz)
      netSyncRef.current?.sendMove({
        x: snap.x,
        y: snap.y,
        z: snap.z,
        yaw: snap.yaw,
        emote: activeEmote,
        moveState: snap.moveState,
        speed: snap.speed,
      });

      if (bloom) bloom.composer.render();
      else renderer.render(scene, camera);

      // Project floating DOM nameplates & speech bubbles (~20fps)
      const now = performance.now();
      if (now - lastLabelSync > 50) {
        lastLabelSync = now;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        const nextLabels: ProjectedLabel[] = [];
        for (const actor of spawnerRef.current.actors.values()) {
          _projVec.copy(actor.currentPos);
          _projVec.y += 2.28;
          _projVec.project(camera);
          const visible = _projVec.z < 1 && _projVec.z > -1;
          const chatValid =
            actor.member.chatText && (!actor.member.chatExpiresAt || actor.member.chatExpiresAt > Date.now());
          nextLabels.push({
            clientId: actor.member.clientId,
            displayName: actor.member.displayName,
            platform: actor.member.platform,
            loyaltyRank: actor.member.loyaltyRank,
            chatText: chatValid ? actor.member.chatText : undefined,
            x: ((_projVec.x + 1) / 2) * w,
            y: ((-_projVec.y + 1) / 2) * h,
            visible,
          });
        }
        setProjectedLabels(nextLabels);
      }

      if (isSoftwareGl) {
        frameId = afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('gamepadconnected', onGamepadConnect);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnect);
      window.removeEventListener('resize', handleResize);
      spawnerRef.current.disposeAll(scene);
      bloom?.dispose();
      floorTex.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      goldAccentMat.dispose();
      cobaltGlowMat.dispose();
      platformMat.dispose();
      monolithMat.dispose();
      sofaMat.dispose();
      tableMat.dispose();
      padGeo.dispose();
      padRingGeo.dispose();
      shardGeo.dispose();
      cobaltShardMat.dispose();
      mythicShardMat.dispose();
      controls.dispose();
      studio.dispose();
    };
  }, [onChangeEmote]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !netSyncRef.current?.sendChat(text)) return;
    setChatInput('');
  };

  const handleResetToSpawn = () => {
    locoRef.current.pos.set(0, 0, 6.0);
    locoRef.current.vel.set(0, 0, 0);
    locoRef.current.yaw = Math.PI;
    locoRef.current.targetYaw = Math.PI;
    locoRef.current.clickTarget = null;
  };

  // Virtual Mobile Joystick Handlers
  const joystickCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });

  const handleJoystickStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    joystickCenterRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const handleJoystickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickCenterRef.current) return;
    const maxR = 36;
    const dx = e.clientX - joystickCenterRef.current.x;
    const dy = e.clientY - joystickCenterRef.current.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(maxR, dist);
    const angle = Math.atan2(dy, dx);
    const ox = Math.cos(angle) * clamped;
    const oy = Math.sin(angle) * clamped;
    setKnobOffset({ x: ox, y: oy });
    joystickRef.current = { dx: ox / maxR, dy: oy / maxR };
  };

  const handleJoystickEnd = () => {
    joystickCenterRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    joystickRef.current = { dx: 0, dy: 0 };
  };

  return (
    <section className="relative w-full h-[calc(100vh-64px)] min-h-[620px] overflow-hidden bg-[#060911]">
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Projected DOM Avatar Nameplates & Live Spatial Chat Bubbles */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {projectedLabels.map(
          (lbl) =>
            lbl.visible && (
              <div
                key={lbl.clientId}
                className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center gap-1"
                style={{ left: `${lbl.x}px`, top: `${lbl.y}px` }}
              >
                {lbl.chatText && (
                  <div className="max-w-[200px] px-2.5 py-1 rounded-lg bg-[#0D1322]/95 border border-[#3B82F6]/40 text-xs text-white text-center shadow-lg">
                    {lbl.chatText}
                  </div>
                )}
                <div className="px-2 py-0.5 rounded bg-[#080C16]/90 border border-white/10 text-[11px] font-medium text-slate-100 whitespace-nowrap">
                  {lbl.displayName} · <span className="text-[#60A5FA] uppercase">{lbl.platform}</span>
                </div>
              </div>
            ),
        )}
      </div>

      {/* Top-Left Compact Lounge + Arena Game HUD */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2">
        <div className="bg-[#080B13]/92 border border-[#D4AF37]/25 rounded-xl px-3.5 py-2 flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-white font-semibold">
            <Users className="w-4 h-4 text-[#D4AF37]" />
            <span className="tabular-nums">{Math.max(1, members.length)}</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {wsConnected ? 'Live' : 'Sync'} · {profile.platform.toUpperCase()}
            {gamepadConnected ? ' · Pad' : ''}
          </span>
        </div>

        <div
          className="bg-[#080B13]/92 border border-[#3B82F6]/35 rounded-xl px-3.5 py-2 flex items-center gap-3 text-xs tabular-nums"
          title="Collect Cobalt (+50) & Sky Platform Mythic Gold (+150) Crown Shards. Every 5 shards earns +100 Credits!"
        >
          <div className="flex items-center gap-1.5 text-[#FDE68A] font-bold">
            <Crown className="w-4 h-4 text-[#D4AF37]" />
            <span>{arenaScore.toLocaleString()} pts</span>
          </div>
          <span className="text-slate-400">Shards: {shardsCollected}</span>
          <button
            type="button"
            onClick={handleResetToSpawn}
            title="Reset to Spawn"
            className="text-slate-300 hover:text-white p-0.5"
          >
            <Compass className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleGlobalMute}
            title={sfxMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            aria-label={sfxMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            className="text-slate-300 hover:text-white p-0.5"
          >
            {sfxMuted ? <VolumeX className="w-3.5 h-3.5 text-slate-500" /> : <Volume2 className="w-3.5 h-3.5 text-[#60A5FA]" />}
          </button>
        </div>
      </div>

      {/* Top-Right Quick Avatar Switcher (includes Custom GLBs!) + Status Pills */}
      <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
        {onEquipAvatar && (
          <div className="bg-[#080B13]/92 border border-[#D4AF37]/30 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs">
            <span className="text-slate-400 text-[11px] font-medium">Avatar:</span>
            <select
              aria-label="Quick Switch Lounge Avatar"
              value={profile.equippedAvatarId}
              onChange={(e) => onEquipAvatar(e.target.value)}
              className="bg-[#111829] border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#D4AF37] max-w-[200px]"
            >
              {avatarOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} ({opt.tag})
                </option>
              ))}
            </select>
          </div>
        )}

        {loadingAvatarName && (
          <div className="bg-[#0B1222]/95 border border-[#3B82F6]/40 rounded-lg px-3 py-1.5 text-[11px] text-[#93C5FD] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading {loadingAvatarName}...</span>
          </div>
        )}

        {avatarWarning && (
          <div className="bg-amber-950/95 border border-amber-500/40 rounded-lg px-3 py-1.5 text-[11px] text-amber-200 flex items-center gap-2 max-w-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">{avatarWarning}</span>
            <button type="button" onClick={() => setAvatarWarning(null)}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {arenaBanner && (
          <div className="bg-[#181307]/95 border border-[#D4AF37]/60 rounded-lg px-3.5 py-2 text-xs font-semibold text-[#FDE68A] shadow-xl">
            {arenaBanner}
          </div>
        )}

        {profile.platform === 'console' && (
          <div className="bg-[#080C16]/90 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-200 flex items-center gap-2.5">
            <span>L-Stick Move</span>
            <span>·</span>
            <span>R-Stick Orbit</span>
            <span>·</span>
            <span>Cross Jump</span>
            <span>·</span>
            <span>RB Dash</span>
          </div>
        )}
      </div>

      {/* Mobile Virtual Touch Controls (Visible when Platform === 'mobile') */}
      {profile.platform === 'mobile' && (
        <>
          <div
            onPointerDown={handleJoystickStart}
            onPointerMove={handleJoystickMove}
            onPointerUp={handleJoystickEnd}
            onPointerCancel={handleJoystickEnd}
            className="absolute bottom-28 left-6 z-20 w-28 h-28 rounded-full bg-[#0B101D]/85 border border-white/20 flex items-center justify-center touch-none select-none"
            aria-label="Mobile movement joystick"
          >
            <div
              className="w-12 h-12 rounded-full bg-[#2563EB] border border-white/30 shadow-lg"
              style={{ transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)` }}
            />
          </div>

          <div className="absolute bottom-28 right-6 z-20 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => {
                jumpQueuedRef.current = true;
              }}
              className="w-16 h-16 rounded-full bg-[#2563EB]/90 active:bg-[#1D4ED8] border border-white/25 text-white text-xs font-bold shadow-lg"
            >
              Jump
            </button>
            <button
              type="button"
              onClick={() => {
                dashQueuedRef.current = true;
              }}
              className="w-16 h-11 rounded-xl bg-[#D4AF37]/90 active:bg-[#B45309] border border-white/25 text-slate-950 text-xs font-bold flex items-center justify-center gap-1"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Dash</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeEmote(profile.equippedEmote === 'dance' ? 'idle' : 'dance')}
              className="w-16 h-11 rounded-xl bg-[#0B101D]/90 border border-white/20 text-white text-xs font-semibold"
            >
              Dance
            </button>
          </div>
        </>
      )}

      {/* Collapsible Bottom Control & Chat Dock */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-20 transition-transform duration-200 w-[min(960px,95vw)] ${
          dockCollapsed ? 'bottom-0 translate-y-[calc(100%-36px)]' : 'bottom-4 translate-y-0'
        }`}
      >
        <div className="flex justify-center mb-1.5">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="px-4 py-1.5 rounded-t-lg bg-[#090D17]/95 border border-b-0 border-[#D4AF37]/25 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{dockCollapsed ? 'Show Lounge Dock' : 'Hide Controls'}</span>
          </button>
        </div>

        <div className="bg-[#090D17]/95 border border-[#D4AF37]/25 rounded-2xl p-3.5 space-y-2.5 shadow-2xl">
          {reportSentNote && (
            <div className="text-[11px] text-[#FDE68A] px-1">{reportSentNote}</div>
          )}

          {chatFeed.length > 0 && (
            <div className="max-h-20 overflow-y-auto space-y-1 text-xs px-1">
              {chatFeed.slice(-4).map((m) => (
                <div key={m.id} className="text-slate-300 flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-white">{m.displayName}</span>{' '}
                    <span className="text-slate-500">({m.platform})</span>: {m.text}
                  </div>
                  {onCreateReport && m.clientId !== selfClientIdRef.current && (
                    <button
                      type="button"
                      onClick={() => {
                        setReportingMsg(m);
                        setReportReason('harassment');
                        setReportDetails('');
                      }}
                      title="Report message"
                      className="text-slate-500 hover:text-amber-300 shrink-0 p-0.5"
                    >
                      <Flag className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Emotes + PC hint */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {LOUNGE_EMOTES.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    if (e.id === 'jump') jumpQueuedRef.current = true;
                    onChangeEmote(e.id);
                  }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    profile.equippedEmote === e.id
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#141C2E] text-slate-300 hover:text-white'
                  }`}
                >
                  {e.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  dashQueuedRef.current = true;
                }}
                title="Sprint: Shift · Dash: E · Jump Pads launch to Sky Platforms"
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#2B2518] hover:bg-[#3A311D] border border-[#D4AF37]/30 text-[#FDE68A] flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Zap className="w-3 h-3 text-[#D4AF37]" />
                <span>Dash (E)</span>
              </button>
            </div>

            {/* Chat Form */}
            <form onSubmit={handleSendChat} className="flex-1 min-w-[200px] flex items-center gap-1.5">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={180}
                placeholder="Say something to the lounge..."
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#141C2E] border border-white/10 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#3B82F6]"
              />
              <button
                type="submit"
                aria-label="Send lounge message"
                className="px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>

            {/* Cross-Platform Input Switcher */}
            <div className="flex items-center gap-1 bg-[#141C2E] p-1 rounded-lg shrink-0">
              {(
                [
                  { id: 'pc', Icon: Monitor, label: 'PC' },
                  { id: 'mobile', Icon: Smartphone, label: 'Mobile' },
                  { id: 'console', Icon: Gamepad2, label: 'Console' },
                ] as const
              ).map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSwitchPlatform(id)}
                  className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
                    profile.platform === id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Report Lounge Message Modal */}
      {reportingMsg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[#0B101D] border border-[#D4AF37]/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold font-display text-white">Report Lounge Message</h3>
              <button
                type="button"
                onClick={() => setReportingMsg(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <blockquote className="p-3 rounded-xl bg-[#111829] border border-white/10 text-xs text-slate-200">
              <span className="font-semibold text-white">{reportingMsg.displayName}:</span> “{reportingMsg.text}”
            </blockquote>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!onCreateReport) return;
                await onCreateReport({
                  targetType: 'lounge-message',
                  targetId: reportingMsg.id,
                  targetAuthorId: reportingMsg.uid,
                  targetAuthorName: reportingMsg.displayName,
                  targetExcerpt: reportingMsg.text || '(empty message)',
                  reason: reportReason,
                  details: reportDetails.trim() || undefined,
                });
                setReportingMsg(null);
                setReportSentNote('Message report submitted to Sovereign Admins.');
                window.setTimeout(() => setReportSentNote(null), 3500);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs text-slate-300 mb-1">Reason</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as ReportReason)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                >
                  <option value="harassment">Harassment or Abuse</option>
                  <option value="spam">Spam or Scam</option>
                  <option value="inappropriate">Inappropriate Content</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Details (Optional)</label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold"
              >
                Submit Report
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
