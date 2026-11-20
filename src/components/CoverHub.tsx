import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Users,
  ShoppingBag,
  Clapperboard,
  Wrench,
  Crown,
  Gift,
  Camera,
} from 'lucide-react';
import type {
  AppSection,
  AvatarEmote,
  PlatformMode,
  RiggedModelConfig,
  UserProfile,
} from '../types';
import { COVER_BACKDROP_IMAGE } from '../data/catalog';
import {
  createLuxuryObsidianFloorTexture,
  createStudioBloomComposer,
  createStudioWebGLContext,
  type StudioBloomHandle,
} from '../three/riggingEngine';
import { applyAvatarAnimation } from '../three/proceduralAvatars';
import { resolveAvatarInstance, type ResolvedAvatar } from '../three/avatarResolver';

interface CoverHubProps {
  profile: UserProfile;
  riggedModels: RiggedModelConfig[];
  onNavigate: (section: AppSection) => void;
  onChangeEmote: (emote: AvatarEmote) => void;
  onSwitchPlatform: (p: PlatformMode) => void;
  onClaimDaily: () => Promise<boolean>;
  dailyClaimedToday: boolean;
  onCaptureToFeed: (dataUrl: string) => void;
}

const EMOTES: Array<{ id: AvatarEmote; label: string }> = [
  { id: 'hero', label: 'Hero Stance' },
  { id: 'idle', label: 'Standby' },
  { id: 'wave', label: 'Salute' },
  { id: 'dance', label: 'Pulse Groove' },
  { id: 'walk', label: 'Patrol Stride' },
];

export const CoverHub: React.FC<CoverHubProps> = ({
  profile,
  riggedModels,
  onNavigate,
  onChangeEmote,
  onSwitchPlatform,
  onClaimDaily,
  dailyClaimedToday,
  onCaptureToFeed,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<ResolvedAvatar | null>(null);
  const emoteRef = useRef<AvatarEmote>(profile.equippedEmote);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [webglLost, setWebglLost] = useState(false);

  useEffect(() => {
    emoteRef.current = profile.equippedEmote;
  }, [profile.equippedEmote]);

  // Swap avatar dynamically when equippedAvatarId or loyaltyRank changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;

    void resolveAvatarInstance(
      profile.equippedAvatarId,
      profile.loyaltyRank,
      riggedModels,
    ).then((resolved) => {
      if (cancelled) {
        resolved.dispose();
        return;
      }
      if (avatarRef.current) {
        scene.remove(avatarRef.current.root);
        avatarRef.current.dispose();
      }
      resolved.root.position.set(0, 0.14, 0);
      scene.add(resolved.root);
      avatarRef.current = resolved;
    });

    return () => {
      cancelled = true;
    };
  }, [profile.equippedAvatarId, profile.loyaltyRank, riggedModels]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const studio = createStudioWebGLContext(container);
    const { renderer, isSoftwareGl, setupEnvironment, afterDraw } = studio;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080e);
    scene.fog = new THREE.FogExp2(0x06080e, 0.045);
    setupEnvironment(scene);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      46,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.1,
      80,
    );
    camera.position.set(0, 1.95, 5.4);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.15, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.6;
    controls.maxDistance = 8.5;
    controls.minPolarAngle = 0.55;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.autoRotate = !isSoftwareGl;
    controls.autoRotateSpeed = 0.45;

    // 3-Point Studio Lighting Rig
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x090d16, 0.75);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.2);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x3b82f6, 2.4);
    rimLight.position.set(-4.5, 4, -5);
    scene.add(rimLight);

    // PS5 Sanctuary Pedestal + Luxury Obsidian-Gold Stage + Monolith Wings
    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    const floorTex = createLuxuryObsidianFloorTexture(renderer);
    const floorGeo = new THREE.CircleGeometry(14, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0b101b,
      map: floorTex,
      metalness: 0.78,
      roughness: 0.24,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    stageGroup.add(floor);

    const daisGeo = new THREE.CylinderGeometry(1.45, 1.65, 0.14, 48);
    const daisMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d1322,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 1.0,
    });
    const dais = new THREE.Mesh(daisGeo, daisMat);
    dais.position.y = 0.07;
    dais.receiveShadow = true;
    stageGroup.add(dais);

    const daisRingGeo = new THREE.TorusGeometry(1.46, 0.02, 12, 64);
    const daisRingMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x2563eb,
      emissiveIntensity: 2.0,
    });
    const daisRing = new THREE.Mesh(daisRingGeo, daisRingMat);
    daisRing.rotation.x = Math.PI / 2;
    daisRing.position.y = 0.145;
    stageGroup.add(daisRing);

    const goldDaisRingGeo = new THREE.TorusGeometry(1.66, 0.018, 12, 64);
    const goldDaisRingMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      emissive: 0x92400e,
      emissiveIntensity: 1.0,
      metalness: 0.95,
      roughness: 0.18,
    });
    const goldDaisRing = new THREE.Mesh(goldDaisRingGeo, goldDaisRingMat);
    goldDaisRing.rotation.x = Math.PI / 2;
    goldDaisRing.position.y = 0.025;
    stageGroup.add(goldDaisRing);

    // Iconic curved PS5-style obsidian & cobalt/gold light monolith wings behind avatar
    const wingGeo = new THREE.BoxGeometry(0.14, 3.6, 0.9);
    const wingMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0f1c,
      metalness: 0.92,
      roughness: 0.14,
      clearcoat: 1.0,
    });
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-2.3, 1.8, -1.6);
    leftWing.rotation.y = 0.35;
    leftWing.rotation.z = -0.1;
    stageGroup.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(2.3, 1.8, -1.6);
    rightWing.rotation.y = -0.35;
    rightWing.rotation.z = 0.1;
    stageGroup.add(rightWing);

    // Cobalt edge strips + subtle gold spine accents on monolith wings
    const stripGeo = new THREE.BoxGeometry(0.03, 3.55, 0.05);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x3b82f6,
      emissiveIntensity: 2.2,
    });
    const leftStrip = new THREE.Mesh(stripGeo, stripMat);
    leftStrip.position.set(0.07, 0, 0.45);
    leftWing.add(leftStrip);

    const rightStrip = new THREE.Mesh(stripGeo, stripMat);
    rightStrip.position.set(-0.07, 0, 0.45);
    rightWing.add(rightStrip);

    const leftGoldTrim = new THREE.Mesh(stripGeo, goldDaisRingMat);
    leftGoldTrim.position.set(0.07, 0, -0.45);
    leftWing.add(leftGoldTrim);

    const rightGoldTrim = new THREE.Mesh(stripGeo, goldDaisRingMat);
    rightGoldTrim.position.set(-0.07, 0, -0.45);
    rightWing.add(rightGoldTrim);

    // Subtle translucent volumetric light shafts behind monolith wings
    const shaftGeo = new THREE.PlaneGeometry(1.4, 5.2);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const leftShaft = new THREE.Mesh(shaftGeo, shaftMat);
    leftShaft.position.set(-2.3, 2.5, -2.1);
    leftShaft.rotation.y = 0.25;
    leftShaft.rotation.z = -0.14;
    stageGroup.add(leftShaft);

    const rightShaft = new THREE.Mesh(shaftGeo, shaftMat);
    rightShaft.position.set(2.3, 2.5, -2.1);
    rightShaft.rotation.y = -0.25;
    rightShaft.rotation.z = 0.14;
    stageGroup.add(rightShaft);

    // Orbiting spatial feature monoliths (Instanced particles for atmosphere)
    const particleCount = 60;
    const pGeo = new THREE.OctahedronGeometry(0.025, 0);
    const pMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    const particles = new THREE.InstancedMesh(pGeo, pMat, particleCount);
    const dummy = new THREE.Object3D();
    const particleSeeds = Array.from({ length: particleCount }, (_, i) => ({
      angle: (i / particleCount) * Math.PI * 2,
      radius: 2.5 + (i % 7) * 0.6,
      yBase: 0.4 + (i % 11) * 0.32,
      speed: 0.15 + (i % 5) * 0.04,
    }));
    for (let i = 0; i < particleCount; i++) {
      const s = particleSeeds[i];
      dummy.position.set(Math.cos(s.angle) * s.radius, s.yBase, Math.sin(s.angle) * s.radius);
      dummy.updateMatrix();
      particles.setMatrixAt(i, dummy.matrix);
    }
    particles.computeBoundingSphere();
    particles.frustumCulled = false;
    scene.add(particles);

    // Initial avatar
    void resolveAvatarInstance(
      profile.equippedAvatarId,
      profile.loyaltyRank,
      riggedModels,
    ).then((resolved) => {
      resolved.root.position.set(0, 0.14, 0);
      scene.add(resolved.root);
      avatarRef.current = resolved;
    });

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => setWebglLost(false);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const bloom = createStudioBloomComposer(
      renderer,
      scene,
      camera,
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
      isSoftwareGl,
      0.28,
      0.45,
      0.88,
    );

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

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    let lastElapsed = 0;

    const tick = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      const dt = Math.min(Math.max(elapsed - lastElapsed, 0.001), 0.05);
      lastElapsed = elapsed;
      controls.update();

      if (avatarRef.current) {
        if (avatarRef.current.stateMachine) {
          avatarRef.current.stateMachine.update(dt, 'idle', 0, emoteRef.current);
        } else {
          applyAvatarAnimation(
            avatarRef.current.bonesByName,
            emoteRef.current,
            elapsed,
            avatarRef.current.restPositions,
            avatarRef.current.restRotations,
          );
        }
      }

      for (let i = 0; i < particleCount; i++) {
        const s = particleSeeds[i];
        const a = s.angle + elapsed * s.speed;
        dummy.position.set(
          Math.cos(a) * s.radius,
          s.yBase + Math.sin(elapsed * 1.4 + i) * 0.15,
          Math.sin(a) * s.radius,
        );
        dummy.rotation.y = elapsed + i;
        dummy.updateMatrix();
        particles.setMatrixAt(i, dummy.matrix);
      }
      particles.instanceMatrix.needsUpdate = true;

      if (bloom) bloom.composer.render();
      else renderer.render(scene, camera);
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
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      if (avatarRef.current) {
        avatarRef.current.dispose();
        avatarRef.current = null;
      }
      bloom?.dispose();
      controls.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      floorTex.dispose();
      daisGeo.dispose();
      daisMat.dispose();
      daisRingGeo.dispose();
      daisRingMat.dispose();
      goldDaisRingGeo.dispose();
      goldDaisRingMat.dispose();
      wingGeo.dispose();
      wingMat.dispose();
      stripGeo.dispose();
      stripMat.dispose();
      shaftGeo.dispose();
      shaftMat.dispose();
      pGeo.dispose();
      pMat.dispose();
      studio.dispose();
    };
  }, []);

  const handleSnapCover = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL('image/jpeg', 0.85);
    onCaptureToFeed(dataUrl);
  };

  return (
    <section className="relative w-full h-[calc(100vh-64px)] min-h-[620px] overflow-hidden bg-[#06080E]">
      {/* Isolated WebGL Mount */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Resilient Static Fallback if WebGL Context Unavailable */}
      {webglLost && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#06080E]">
          <img
            src={COVER_BACKDROP_IMAGE}
            alt="Sovereign X Sanctuary Cover"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-50"
          />
        </div>
      )}

      {/* Top-Left Minimal Hero Title Overlay (Solid dark rgba surface, NO backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-6 left-6 right-6 z-20 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="pointer-events-auto max-w-md bg-[#080B13]/92 border border-[#D4AF37]/30 rounded-xl p-5 shadow-2xl">
          <div className="text-xs text-[#FDE68A] font-medium">
            {profile.loyaltyRank} Crest · {profile.streakDays}d Loyal Streak ·{' '}
            <span className="font-mono tabular-nums">{profile.credits.toLocaleString()} Credits</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-white mt-1.5 leading-tight">
            Sovereign Social Sanctuary
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1.5 leading-relaxed">
            Step into the live 3D Lounge across PC, Mobile, or Console, browse the Royal Vault Shop, or rig custom GLB skeletons.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => onNavigate('lounge')}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold transition-colors whitespace-nowrap"
            >
              Enter 3D Lounge
            </button>
            <button
              type="button"
              disabled={dailyClaimedToday || claiming}
              onClick={async () => {
                setClaiming(true);
                try {
                  await onClaimDaily();
                } finally {
                  setClaiming(false);
                }
              }}
              className="px-4 py-2 rounded-lg bg-[#141C2F] hover:bg-[#1D2842] border border-[#D4AF37]/40 disabled:opacity-50 text-[#FDE68A] text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Gift className="w-3.5 h-3.5" />
              <span>{dailyClaimedToday ? 'Daily Claimed' : 'Claim +250 Credits'}</span>
            </button>
            <button
              type="button"
              onClick={handleSnapCover}
              title="Snapshot 3D avatar to Media Pulse"
              className="px-3 py-2 rounded-lg bg-[#111829] hover:bg-[#1B253D] border border-white/10 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Snap 3D</span>
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible PS5-Style Cover Dock (Bottom-Center) */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-20 transition-transform duration-200 w-[min(960px,95vw)] ${
          dockCollapsed ? 'bottom-0 translate-y-[calc(100%-36px)]' : 'bottom-4 translate-y-0'
        }`}
      >
        <div className="flex justify-center mb-1.5">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="px-4 py-1.5 rounded-t-lg bg-[#090D17]/95 border border-b-0 border-[#D4AF37]/30 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{dockCollapsed ? 'Show Cover Deck' : 'Hide Controls'}</span>
          </button>
        </div>

        <div className="bg-[#090D17]/95 border border-[#D4AF37]/25 rounded-2xl p-4 space-y-3 shadow-2xl">
          {/* PS5 Cover Launch Tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('lounge')}
              className="group p-3 rounded-xl bg-[#121A2D] hover:bg-[#1A2540] border border-white/10 hover:border-[#3B82F6]/60 text-left transition-colors"
            >
              <div className="flex items-center justify-between text-[#60A5FA]">
                <Users className="w-4 h-4" />
                <span className="text-[11px] font-mono text-slate-400">Cross-Play</span>
              </div>
              <div className="text-sm font-semibold text-white mt-2">3D Lounge</div>
              <div className="text-xs text-slate-400 truncate">PC · Mobile · Console</div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('media')}
              className="group p-3 rounded-xl bg-[#121A2D] hover:bg-[#1A2540] border border-white/10 hover:border-[#3B82F6]/60 text-left transition-colors"
            >
              <div className="flex items-center justify-between text-[#60A5FA]">
                <Clapperboard className="w-4 h-4" />
                <span className="text-[11px] font-mono text-slate-400">Social</span>
              </div>
              <div className="text-sm font-semibold text-white mt-2">Media Pulse</div>
              <div className="text-xs text-slate-400 truncate">Reels · Feed · Snaps</div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('shop')}
              className="group p-3 rounded-xl bg-[#121A2D] hover:bg-[#1A2540] border border-white/10 hover:border-[#D4AF37]/60 text-left transition-colors"
            >
              <div className="flex items-center justify-between text-[#D4AF37]">
                <ShoppingBag className="w-4 h-4" />
                <span className="text-[11px] font-mono text-slate-400">Daily Shop</span>
              </div>
              <div className="text-sm font-semibold text-white mt-2">Item Shop</div>
              <div className="text-xs text-slate-400 truncate">Avatars · Emotes · Auras</div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('studio')}
              className="group p-3 rounded-xl bg-[#121A2D] hover:bg-[#1A2540] border border-white/10 hover:border-[#3B82F6]/60 text-left transition-colors"
            >
              <div className="flex items-center justify-between text-[#60A5FA]">
                <Wrench className="w-4 h-4" />
                <span className="text-[11px] font-mono text-slate-400">GLB Forge</span>
              </div>
              <div className="text-sm font-semibold text-white mt-2">Rigging Studio</div>
              <div className="text-xs text-slate-400 truncate">Skeleton · Heat Map</div>
            </button>
          </div>

          {/* Emote & Platform Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="text-xs text-slate-400 mr-1 flex items-center gap-1 whitespace-nowrap">
                <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                Emote:
              </span>
              {EMOTES.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onChangeEmote(e.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    profile.equippedEmote === e.id
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#141C2E] text-slate-300 hover:text-white'
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-[#141C2E] p-1 rounded-lg">
              {(['pc', 'mobile', 'console'] as const).map((plat) => (
                <button
                  key={plat}
                  type="button"
                  onClick={() => onSwitchPlatform(plat)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold uppercase transition-colors whitespace-nowrap ${
                    profile.platform === plat
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {plat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
