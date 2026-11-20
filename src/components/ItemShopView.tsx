import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Clock,
  Check,
  ShoppingBag,
  Sparkles,
  Plus,
  Trash2,
  Wrench,
  Crown,
  X,
  Edit3,
  Upload,
  ArrowUpRight,
} from 'lucide-react';
import type {
  AvatarEmote,
  RiggedModelConfig,
  ShopCategory,
  ShopItem,
  ShopRarity,
  ShopSection,
  UserProfile,
  VaultShowcaseConfig,
} from '../types';
import {
  COVER_BACKDROP_IMAGE,
  DEFAULT_AVATAR_PRESETS,
  FEED_ARENA_IMAGE,
  FEED_ROOFTOP_IMAGE,
  SHOP_KNIGHT_IMAGE,
  SHOP_VISOR_IMAGE,
} from '../data/catalog';
import {
  createLuxuryObsidianFloorTexture,
  createStudioBloomComposer,
  createStudioWebGLContext,
  type StudioBloomHandle,
} from '../three/riggingEngine';
import { applyAvatarAnimation } from '../three/proceduralAvatars';
import { resolveAvatarInstance, type ResolvedAvatar } from '../three/avatarResolver';
import { uploadImageFile } from '../utils/uploadImage';

interface ItemShopViewProps {
  profile: UserProfile;
  isAdmin: boolean;
  shopItems: ShopItem[];
  ownedItemIds: string[];
  riggedModels: RiggedModelConfig[];
  awaitingVault: VaultShowcaseConfig;
  onUpdateAwaitingVault?: (cfg: VaultShowcaseConfig) => Promise<void>;
  onPurchaseItem: (item: ShopItem) => Promise<{ ok: boolean; error?: string }>;
  onEquipItem: (item: ShopItem) => Promise<void>;
  onCreateShopItem: (input: {
    name: string;
    description: string;
    category: ShopCategory;
    section: ShopSection;
    rarity: ShopRarity;
    price: number;
    imageUrl: string;
    presetKey?: string;
    riggedModelId?: string;
  }) => Promise<void>;
  onUpdateShopItem?: (itemId: string, patch: Partial<ShopItem>) => Promise<void>;
  onDeleteShopItem: (itemId: string) => Promise<void>;
  onNavigateToStudio: () => void;
}

const RARITY_STYLES: Record<ShopRarity, { border: string; text: string; label: string }> = {
  mythic: { border: 'border-[#D4AF37]/75', text: 'text-[#FDE68A]', label: 'Mythic' },
  legendary: { border: 'border-amber-400/60', text: 'text-amber-300', label: 'Legendary' },
  epic: { border: 'border-indigo-400/60', text: 'text-indigo-300', label: 'Epic' },
  rare: { border: 'border-[#3B82F6]/60', text: 'text-[#93C5FD]', label: 'Rare' },
  uncommon: { border: 'border-emerald-500/50', text: 'text-emerald-300', label: 'Uncommon' },
};

const ARTWORK_OPTIONS = [
  { label: 'Sovereign Knight Gold', url: SHOP_KNIGHT_IMAGE },
  { label: 'Nebula Tactical Visor', url: SHOP_VISOR_IMAGE },
  { label: 'Obsidian Sanctuary', url: COVER_BACKDROP_IMAGE },
  { label: 'Tokyo Rooftop', url: FEED_ROOFTOP_IMAGE },
  { label: 'Arena Monolith', url: FEED_ARENA_IMAGE },
];

function getUtcMidnightCountdown(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  );
  const diff = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const h = String(Math.floor(diff / 3600)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
  const s = String(diff % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const ItemShopView: React.FC<ItemShopViewProps> = ({
  profile,
  isAdmin,
  shopItems,
  ownedItemIds,
  riggedModels,
  awaitingVault,
  onUpdateAwaitingVault,
  onPurchaseItem,
  onEquipItem,
  onCreateShopItem,
  onUpdateShopItem,
  onDeleteShopItem,
  onNavigateToStudio,
}) => {
  const visibleShopItems = isAdmin ? shopItems : shopItems.filter((item) => item.active);

  const [sectionFilter, setSectionFilter] = useState<'all' | ShopSection>('all');
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(visibleShopItems[0] || null);
  const [countdown, setCountdown] = useState(getUtcMidnightCountdown());
  const [buying, setBuying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Admin Create / Edit Luxury Drop modal state
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [dropName, setDropName] = useState('');
  const [dropDesc, setDropDesc] = useState('');
  const [dropCategory, setDropCategory] = useState<ShopCategory>('avatar');
  const [dropSection, setDropSection] = useState<ShopSection>('featured');
  const [dropRarity, setDropRarity] = useState<ShopRarity>('mythic');
  const [dropPrice, setDropPrice] = useState(2400);
  const [dropImageUrl, setDropImageUrl] = useState(SHOP_KNIGHT_IMAGE);
  const [dropActive, setDropActive] = useState(true);
  const [dropTargetKey, setDropTargetKey] = useState<string>(DEFAULT_AVATAR_PRESETS[0].id);
  const [uploadingDropThumb, setUploadingDropThumb] = useState(false);
  const [publishingDrop, setPublishingDrop] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Admin Edit Awaiting Vault Drop modal state
  const [awaitingModalOpen, setAwaitingModalOpen] = useState(false);
  const [awaitingKicker, setAwaitingKicker] = useState(awaitingVault.kicker);
  const [awaitingTitle, setAwaitingTitle] = useState(awaitingVault.title);
  const [awaitingDesc, setAwaitingDesc] = useState(awaitingVault.description);
  const [awaitingAvatarId, setAwaitingAvatarId] = useState(awaitingVault.previewAvatarId);
  const [awaitingImageUrl, setAwaitingImageUrl] = useState(awaitingVault.imageUrl || '');
  const [uploadingAwaitingThumb, setUploadingAwaitingThumb] = useState(false);
  const [savingAwaiting, setSavingAwaiting] = useState(false);
  const [awaitingError, setAwaitingError] = useState<string | null>(null);

  const previewMountRef = useRef<HTMLDivElement | null>(null);
  const previewSceneRef = useRef<THREE.Scene | null>(null);
  const previewAvatarRef = useRef<ResolvedAvatar | null>(null);
  const previewEmoteRef = useRef<AvatarEmote>('hero');

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(getUtcMidnightCountdown()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Keep selectedItem synced with visibleShopItems (including clearing when vault becomes empty)
  useEffect(() => {
    if (visibleShopItems.length === 0) {
      setSelectedItem(null);
      return;
    }
    if (!selectedItem || !visibleShopItems.some((item) => item.id === selectedItem.id)) {
      setSelectedItem(visibleShopItems[0]);
    } else {
      const latest = visibleShopItems.find((item) => item.id === selectedItem.id);
      if (latest && latest !== selectedItem) {
        setSelectedItem(latest);
      }
    }
  }, [visibleShopItems, selectedItem]);

  // Swap 3D preview model when selectedItem or awaitingVault preview target changes
  useEffect(() => {
    const scene = previewSceneRef.current;
    if (!scene) return;
    let cancelled = false;

    const targetAvatar = selectedItem
      ? selectedItem.category === 'emote'
        ? profile.equippedAvatarId
        : selectedItem.riggedModelId || selectedItem.presetKey || 'avatar-sovereign-knight'
      : awaitingVault.previewAvatarId || profile.equippedAvatarId;

    previewEmoteRef.current =
      selectedItem && selectedItem.category === 'emote'
        ? ((selectedItem.presetKey as AvatarEmote) || 'dance')
        : 'hero';

    void resolveAvatarInstance(targetAvatar, profile.loyaltyRank, riggedModels).then((resolved) => {
      if (cancelled) {
        resolved.dispose();
        return;
      }
      if (previewAvatarRef.current) {
        scene.remove(previewAvatarRef.current.root);
        previewAvatarRef.current.dispose();
      }
      resolved.root.position.set(0, 0.14, 0);
      scene.add(resolved.root);
      previewAvatarRef.current = resolved;
    });

    return () => {
      cancelled = true;
    };
  }, [selectedItem, awaitingVault.previewAvatarId, profile.equippedAvatarId, profile.loyaltyRank, riggedModels]);

  useEffect(() => {
    const container = previewMountRef.current;
    if (!container) return;

    const studio = createStudioWebGLContext(container);
    const { renderer, isSoftwareGl, setupEnvironment, afterDraw } = studio;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070c);
    setupEnvironment(scene);
    previewSceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      42,
      (container.clientWidth || 420) / (container.clientHeight || 360),
      0.1,
      50,
    );
    camera.position.set(0, 1.55, 3.85);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.05, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.enablePan = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 6.2;

    const hemi = new THREE.HemisphereLight(0xfde68a, 0x090d16, 0.75);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4dd, 2.3);
    key.position.set(3, 5, 4);
    key.castShadow = !isSoftwareGl;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xd4af37, 1.8);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const overheadSpot = new THREE.SpotLight(0xffe7a3, 4.5, 16, Math.PI / 5, 0.55, 1.2);
    overheadSpot.position.set(0, 5.2, 1.6);
    overheadSpot.target.position.set(0, 0.9, 0);
    scene.add(overheadSpot);
    scene.add(overheadSpot.target);

    const obsidianTex = createLuxuryObsidianFloorTexture(renderer);
    const pedestalGeo = new THREE.CylinderGeometry(1.18, 1.35, 0.14, 48);
    const pedestalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0f18,
      map: obsidianTex,
      metalness: 0.85,
      roughness: 0.18,
      clearcoat: 1.0,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = 0.07;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    const goldTrimGeo = new THREE.TorusGeometry(1.2, 0.022, 12, 64);
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      emissive: 0x92400e,
      emissiveIntensity: 1.2,
      metalness: 0.95,
      roughness: 0.18,
    });
    const goldTrim = new THREE.Mesh(goldTrimGeo, goldTrimMat);
    goldTrim.rotation.x = Math.PI / 2;
    goldTrim.position.y = 0.145;
    scene.add(goldTrim);

    const floorHaloGeo = new THREE.RingGeometry(1.42, 1.65, 64);
    const floorHaloMat = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    const floorHalo = new THREE.Mesh(floorHaloGeo, floorHaloMat);
    floorHalo.rotation.x = -Math.PI / 2;
    floorHalo.position.y = 0.01;
    scene.add(floorHalo);

    const bloomHandle: StudioBloomHandle | null = createStudioBloomComposer(
      renderer,
      scene,
      camera,
      container.clientWidth || 420,
      container.clientHeight || 360,
      isSoftwareGl,
      0.22,
      0.4,
      0.9,
    );

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

      if (previewAvatarRef.current) {
        previewAvatarRef.current.root.rotation.y = elapsed * 0.35;
        if (previewAvatarRef.current.stateMachine) {
          previewAvatarRef.current.stateMachine.update(dt, 'idle', 0, previewEmoteRef.current);
        } else {
          applyAvatarAnimation(
            previewAvatarRef.current.bonesByName,
            previewEmoteRef.current,
            elapsed,
            previewAvatarRef.current.restPositions,
          );
        }
      }

      if (bloomHandle) {
        bloomHandle.composer.render();
      } else {
        renderer.render(scene, camera);
      }
      if (isSoftwareGl) frameId = afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };
    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 420;
      const h = container.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      bloomHandle?.resize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      bloomHandle?.dispose();
      if (previewAvatarRef.current) {
        previewAvatarRef.current.dispose();
        previewAvatarRef.current = null;
      }
      pedestalGeo.dispose();
      pedestalMat.dispose();
      goldTrimGeo.dispose();
      goldTrimMat.dispose();
      floorHaloGeo.dispose();
      floorHaloMat.dispose();
      obsidianTex.dispose();
      controls.dispose();
      studio.dispose();
    };
  }, []);

  const filteredItems =
    sectionFilter === 'all'
      ? visibleShopItems
      : visibleShopItems.filter((item) => item.section === sectionFilter);

  const isOwned = selectedItem ? ownedItemIds.includes(selectedItem.id) : false;

  const handleBuy = async () => {
    if (!selectedItem || buying) return;
    setBuying(true);
    setFeedback(null);
    try {
      const res = await onPurchaseItem(selectedItem);
      if (res.ok) {
        setFeedback(`Unlocked ${selectedItem.name}. Equipped to your Sovereign Locker.`);
      } else {
        setFeedback(res.error || 'Could not complete purchase.');
      }
    } finally {
      setBuying(false);
    }
  };

  const handleDelete = async (item: ShopItem) => {
    if (!isAdmin || deleting) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await onDeleteShopItem(item.id);
      setFeedback(`Removed ${item.name} from the Sovereign Item Shop.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not remove item.');
    } finally {
      setDeleting(false);
    }
  };

  const openCreateDropModal = () => {
    setEditingItemId(null);
    setDropName('');
    setDropDesc('');
    setDropCategory('avatar');
    setDropSection('featured');
    setDropRarity('mythic');
    setDropPrice(2400);
    setDropImageUrl(SHOP_KNIGHT_IMAGE);
    setDropActive(true);
    setDropTargetKey(DEFAULT_AVATAR_PRESETS[0].id);
    setComposerError(null);
    setComposerOpen(true);
  };

  const openEditDropModal = (item: ShopItem) => {
    setEditingItemId(item.id);
    setDropName(item.name);
    setDropDesc(item.description);
    setDropCategory(item.category);
    setDropSection(item.section);
    setDropRarity(item.rarity);
    setDropPrice(item.price);
    setDropImageUrl(item.imageUrl || SHOP_KNIGHT_IMAGE);
    setDropActive(item.active);
    setDropTargetKey(
      item.riggedModelId || item.presetKey || (item.category === 'emote' ? 'dance' : DEFAULT_AVATAR_PRESETS[0].id),
    );
    setComposerError(null);
    setComposerOpen(true);
  };

  const openEditAwaitingModal = () => {
    setAwaitingKicker(awaitingVault.kicker);
    setAwaitingTitle(awaitingVault.title);
    setAwaitingDesc(awaitingVault.description);
    setAwaitingAvatarId(awaitingVault.previewAvatarId);
    setAwaitingImageUrl(awaitingVault.imageUrl || '');
    setAwaitingError(null);
    setAwaitingModalOpen(true);
  };

  const handlePromoteAwaitingToShop = () => {
    setEditingItemId(null);
    setDropName(awaitingVault.title === 'Awaiting Vault Drop' ? 'Sovereign Vanguard Drop' : awaitingVault.title);
    setDropDesc(awaitingVault.description);
    setDropCategory('avatar');
    setDropSection('featured');
    setDropRarity('mythic');
    setDropPrice(2400);
    setDropImageUrl(awaitingVault.imageUrl || SHOP_KNIGHT_IMAGE);
    setDropActive(true);
    setDropTargetKey(awaitingVault.previewAvatarId || DEFAULT_AVATAR_PRESETS[0].id);
    setComposerError(null);
    setComposerOpen(true);
  };

  const handleSaveAwaitingVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateAwaitingVault || savingAwaiting) return;
    if (!awaitingTitle.trim()) {
      setAwaitingError('Enter a title for the Awaiting Vault Drop showcase.');
      return;
    }
    setAwaitingError(null);
    setSavingAwaiting(true);
    try {
      await onUpdateAwaitingVault({
        kicker: awaitingKicker.trim().slice(0, 80) || 'Sovereign Pedestal · Active Chassis Preview',
        title: awaitingTitle.trim().slice(0, 80),
        description:
          awaitingDesc.trim().slice(0, 300) ||
          'Curated 3D character showcase awaiting upcoming Royal Vault release.',
        previewAvatarId: awaitingAvatarId || DEFAULT_AVATAR_PRESETS[0].id,
        ...(awaitingImageUrl.trim() ? { imageUrl: awaitingImageUrl.trim().slice(0, 1024) } : {}),
      });
      setAwaitingModalOpen(false);
      setFeedback('Updated Awaiting Vault Drop showcase.');
    } catch (err) {
      setAwaitingError(err instanceof Error ? err.message : 'Failed to save Awaiting Vault Drop.');
    } finally {
      setSavingAwaiting(false);
    }
  };

  const handlePublishDrop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dropName.trim()) {
      setComposerError('Enter a name for this luxury drop.');
      return;
    }
    setComposerError(null);
    setPublishingDrop(true);
    try {
      const matchedRig = riggedModels.find((m) => m.id === dropTargetKey);
      const cleanDesc =
        dropDesc.trim().slice(0, 300) ||
        'Bespoke Sovereign Obsidian & Champagne Gold release curated for cross-platform lounges.';
      const cleanImage = dropImageUrl.trim().slice(0, 1024) || SHOP_KNIGHT_IMAGE;

      if (editingItemId && onUpdateShopItem) {
        await onUpdateShopItem(editingItemId, {
          name: dropName.trim().slice(0, 80),
          description: cleanDesc,
          category: dropCategory,
          section: dropSection,
          rarity: dropRarity,
          price: dropPrice,
          imageUrl: cleanImage,
          active: dropActive,
          ...(matchedRig ? { riggedModelId: matchedRig.id } : { presetKey: dropTargetKey }),
        });
        setFeedback(`Updated "${dropName.trim()}" in the Item Shop.`);
      } else {
        await onCreateShopItem({
          name: dropName.trim(),
          description: cleanDesc,
          category: dropCategory,
          section: dropSection,
          rarity: dropRarity,
          price: dropPrice,
          imageUrl: cleanImage,
          ...(matchedRig ? { riggedModelId: matchedRig.id } : { presetKey: dropTargetKey }),
        });
        setFeedback(`Published "${dropName.trim()}" to the Royal Vault.`);
      }
      setDropName('');
      setDropDesc('');
      setEditingItemId(null);
      setComposerOpen(false);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to save drop.');
    } finally {
      setPublishingDrop(false);
    }
  };

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Luxury Obsidian & Gold Shop Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#D4AF37]/20">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-white tracking-tight">
            Sovereign <span className="text-[#D4AF37]">Royal Vault</span>
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Admin-curated luxury avatars, custom rigged GLB drops, emotes, and royal guardian auras.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateDropModal}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Post Luxury Drop</span>
            </button>
          )}

          <div className="flex items-center gap-2 text-xs text-slate-300 bg-[#0B0F1A] border border-white/10 rounded-lg px-3.5 py-2">
            <Clock className="w-4 h-4 text-[#D4AF37]" />
            <span>Vault Reset</span>
            <span className="font-mono font-semibold text-white tabular-nums">{countdown}</span>
          </div>

          <div className="text-sm font-mono font-semibold text-[#FDE68A] bg-[#14110A] border border-[#D4AF37]/40 rounded-lg px-3.5 py-1.5 tabular-nums">
            {profile.credits.toLocaleString()} Credits
          </div>
        </div>
      </div>

      {/* Section Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-[#0A0E18] border border-[#D4AF37]/20 rounded-lg w-fit">
        {(
          [
            { id: 'all', label: 'All Drops' },
            { id: 'featured', label: 'Featured' },
            { id: 'daily', label: 'Daily Rotation' },
            { id: 'royal-vault', label: 'Royal Vault' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSectionFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
              sectionFilter === tab.id
                ? 'bg-[#D4AF37] text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Split Layout: Empty Vault / Curated Drops + 3D Inspection Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Empty Vault or Item Grid */}
        <div className="lg:col-span-7">
          {filteredItems.length === 0 ? (
            <div className="rounded-2xl bg-gradient-to-b from-[#0E1320] to-[#080B12] border border-[#D4AF37]/30 p-8 sm:p-10 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-[#1A1409] border border-[#D4AF37]/50 flex items-center justify-center text-[#D4AF37]">
                <Crown className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h2 className="text-xl font-bold font-display text-white">
                  {visibleShopItems.length === 0
                    ? awaitingVault.title || 'The Royal Vault Is Empty'
                    : 'No Drops in This Section Yet'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  {isAdmin
                    ? 'Only Sovereign Admins can curate the storefront. Edit the Awaiting Vault showcase, promote it live, or rig a custom GLB character in Studio.'
                    : awaitingVault.description ||
                      'Curated luxury releases appear here as soon as Sovereign Admins publish new drops.'}
                </p>
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={openCreateDropModal}
                    className="px-4 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Post Luxury Drop</span>
                  </button>
                  <button
                    type="button"
                    onClick={openEditAwaitingModal}
                    className="px-4 py-2.5 rounded-lg bg-[#141C2F] hover:bg-[#1D2842] border border-[#D4AF37]/35 text-[#FDE68A] text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Edit3 className="w-4 h-4" />
                    <span>Edit Awaiting Drop</span>
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateToStudio}
                    className="px-4 py-2.5 rounded-lg bg-[#141C2F] hover:bg-[#1D2842] border border-white/15 text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Wrench className="w-4 h-4 text-[#60A5FA]" />
                    <span>Rig Custom GLB in Studio</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredItems.map((item) => {
                const rarity = RARITY_STYLES[item.rarity] || RARITY_STYLES.rare;
                const owned = ownedItemIds.includes(item.id);
                const isSelected = selectedItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`group relative rounded-2xl overflow-hidden bg-[#0A0E18] border transition-all ${
                      isSelected
                        ? 'border-[#D4AF37] ring-1 ring-[#D4AF37]'
                        : `${rarity.border} hover:brightness-110`
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItem(item);
                        setFeedback(null);
                      }}
                      className="w-full text-left"
                    >
                      <div className="relative aspect-[4/3] bg-[#101624] overflow-hidden">
                        <img
                          src={item.imageUrl || SHOP_KNIGHT_IMAGE}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0E18] via-transparent to-transparent" />
                        {!item.active && (
                          <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/80 border border-amber-400/40 text-[10px] font-semibold text-amber-200">
                            Hidden
                          </span>
                        )}
                      </div>

                      <div className="p-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className={`font-semibold ${rarity.text}`}>
                            {rarity.label} · {item.category}
                          </span>
                          <span className="font-mono text-[#FDE68A] font-semibold tabular-nums">
                            {owned ? 'Owned' : `${item.price.toLocaleString()} Cr`}
                          </span>
                        </div>
                        <div className="text-base font-bold font-display text-white truncate">
                          {item.name}
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openEditDropModal(item)}
                        title="Edit drop details & thumbnail"
                        className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-md bg-black/80 hover:bg-[#D4AF37] hover:text-slate-950 border border-white/20 text-[11px] font-semibold text-white transition-colors flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Luxury Obsidian & Gold 3D Inspection Pedestal */}
        <div className="lg:col-span-5 bg-[#0A0E18] border border-[#D4AF37]/25 rounded-2xl overflow-hidden sticky top-20">
          <div className="relative h-[360px] bg-[#05070C]">
            <div ref={previewMountRef} className="w-full h-full" />
            <div className="pointer-events-none absolute bottom-3 left-4 text-xs text-slate-300">
              Drag to inspect 360°
            </div>
            {!selectedItem && isAdmin && (
              <button
                type="button"
                onClick={openEditAwaitingModal}
                className="absolute top-3 right-3 px-2.5 py-1.5 rounded-lg bg-[#0B101D]/90 hover:bg-[#17130B] border border-[#D4AF37]/45 text-[11px] font-semibold text-[#FDE68A] flex items-center gap-1"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Showcase</span>
              </button>
            )}
          </div>

          {selectedItem ? (
            <div className="p-5 space-y-4 border-t border-[#D4AF37]/20">
              <div>
                <div className={`text-xs font-semibold ${RARITY_STYLES[selectedItem.rarity].text}`}>
                  {RARITY_STYLES[selectedItem.rarity].label} · {selectedItem.category} · by{' '}
                  {selectedItem.creatorName}
                </div>
                <h2 className="text-xl font-bold font-display text-white mt-1">
                  {selectedItem.name}
                </h2>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {selectedItem.description}
                </p>
              </div>

              {feedback && (
                <div className="p-2.5 rounded-lg bg-[#141B2D] border border-[#D4AF37]/40 text-xs text-slate-100">
                  {feedback}
                </div>
              )}

              <div className="flex items-center gap-2">
                {isOwned ? (
                  <button
                    type="button"
                    onClick={() => void onEquipItem(selectedItem)}
                    className="flex-1 py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>Equip to Lounge & Cover</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={buying}
                    onClick={() => void handleBuy()}
                    className="flex-1 py-2.5 px-4 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-slate-950 text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span className="tabular-nums">
                      {buying
                        ? 'Processing...'
                        : `Acquire for ${selectedItem.price.toLocaleString()} Credits`}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    previewEmoteRef.current =
                      previewEmoteRef.current === 'dance' ? 'hero' : 'dance';
                  }}
                  title="Preview Emote"
                  className="py-2.5 px-3 rounded-lg bg-[#141C2E] hover:bg-[#1C2740] border border-white/10 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  <span>Emote</span>
                </button>

                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditDropModal(selectedItem)}
                      title="Edit Drop"
                      className="py-2.5 px-3 rounded-lg bg-[#141C2E] hover:bg-[#1D2842] border border-[#D4AF37]/35 text-[#FDE68A] text-xs font-semibold flex items-center gap-1"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDelete(selectedItem)}
                      title="Remove Drop from Shop"
                      className="py-2.5 px-3 rounded-lg bg-red-950/60 hover:bg-red-900/70 border border-red-500/40 text-red-200 text-xs font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-3 border-t border-[#D4AF37]/20">
              {awaitingVault.imageUrl && (
                <div className="h-28 rounded-xl overflow-hidden border border-[#D4AF37]/25 bg-[#101624]">
                  <img
                    src={awaitingVault.imageUrl}
                    alt={awaitingVault.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div>
                <div className="text-xs font-semibold text-[#D4AF37]">
                  {awaitingVault.kicker}
                </div>
                <h2 className="text-lg font-bold font-display text-white mt-0.5">
                  {awaitingVault.title}
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {awaitingVault.description}
                </p>
              </div>

              {feedback && (
                <div className="p-2.5 rounded-lg bg-[#141B2D] border border-[#D4AF37]/40 text-xs text-slate-100">
                  {feedback}
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={openEditAwaitingModal}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#141C2F] hover:bg-[#1D2842] border border-[#D4AF37]/40 text-[#FDE68A] text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Awaiting Drop</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePromoteAwaitingToShop}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>Promote to Live Shop</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Admin Create / Edit Luxury Drop Modal */}
      {composerOpen && isAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-label={editingItemId ? 'Edit Luxury Vault Drop' : 'Post Luxury Item Shop Drop'}
        >
          <div className="w-full max-w-lg bg-[#0A0E18] border border-[#D4AF37]/40 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold font-display text-white">
                  {editingItemId ? 'Edit Luxury Vault Drop' : 'Post Luxury Vault Drop'}
                </h2>
                <p className="text-xs text-slate-400">
                  {editingItemId
                    ? 'Updates item details, pricing, and thumbnail across the global storefront.'
                    : 'Publishes live to the global Sovereign Item Shop.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublishDrop} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Drop Title
                </label>
                <input
                  type="text"
                  required
                  value={dropName}
                  onChange={(e) => setDropName(e.target.value)}
                  maxLength={80}
                  placeholder="Imperial Obsidian Sovereign"
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Description
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    {dropDesc.length}/300
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={dropDesc}
                  onChange={(e) => setDropDesc(e.target.value)}
                  maxLength={300}
                  placeholder="Handcrafted obsidian armor with brushed 24k gold trim..."
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={dropCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value as ShopCategory;
                      setDropCategory(nextCat);
                      if (nextCat === 'emote') setDropTargetKey('dance');
                      else setDropTargetKey(DEFAULT_AVATAR_PRESETS[0].id);
                    }}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                  >
                    <option value="avatar">Avatar</option>
                    <option value="bundle">Bundle</option>
                    <option value="emote">Emote</option>
                    <option value="aura">Aura</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Section
                  </label>
                  <select
                    value={dropSection}
                    onChange={(e) => setDropSection(e.target.value as ShopSection)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                  >
                    <option value="featured">Featured</option>
                    <option value="daily">Daily</option>
                    <option value="royal-vault">Royal Vault</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Rarity
                  </label>
                  <select
                    value={dropRarity}
                    onChange={(e) => setDropRarity(e.target.value as ShopRarity)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                  >
                    <option value="mythic">Mythic</option>
                    <option value="legendary">Legendary</option>
                    <option value="epic">Epic</option>
                    <option value="rare">Rare</option>
                    <option value="uncommon">Uncommon</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Price (Cr)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    step={50}
                    value={dropPrice}
                    onChange={(e) => setDropPrice(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  3D Model / Rig or Emote Target
                </label>
                <select
                  value={dropTargetKey}
                  onChange={(e) => setDropTargetKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                >
                  {dropCategory === 'emote' ? (
                    <>
                      <option value="hero">Hero Stance</option>
                      <option value="dance">Pulse Sync Groove</option>
                      <option value="wave">Royal Salute</option>
                      <option value="walk">Patrol Stride</option>
                    </>
                  ) : (
                    <>
                      {DEFAULT_AVATAR_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          Chassis: {p.name}
                        </option>
                      ))}
                      {riggedModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          Custom Rig: {m.name} ({m.bones.length} bones)
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Item Thumbnail
                  </label>
                  <label className="px-2.5 py-1 rounded-md bg-[#162340] hover:bg-[#1E3159] border border-[#3B82F6]/40 text-[11px] font-semibold text-[#93C5FD] cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    <span>{uploadingDropThumb ? 'Uploading...' : 'Upload Thumbnail'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      disabled={uploadingDropThumb}
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setComposerError(null);
                        setUploadingDropThumb(true);
                        try {
                          const endpoint = await uploadImageFile(file);
                          setDropImageUrl(endpoint);
                        } catch (err) {
                          setComposerError(
                            err instanceof Error ? err.message : 'Failed to upload thumbnail.',
                          );
                        } finally {
                          setUploadingDropThumb(false);
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-3 mb-2">
                  <img
                    src={dropImageUrl || SHOP_KNIGHT_IMAGE}
                    alt="Drop thumbnail preview"
                    className="w-16 h-16 rounded-xl object-cover border border-[#D4AF37]/35 bg-[#111829] shrink-0"
                  />
                  <input
                    type="text"
                    maxLength={1024}
                    value={dropImageUrl}
                    onChange={(e) => setDropImageUrl(e.target.value)}
                    placeholder="Uploaded thumbnail path or custom image URL..."
                    className="flex-1 px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {ARTWORK_OPTIONS.map((art) => (
                    <button
                      key={art.url}
                      type="button"
                      onClick={() => setDropImageUrl(art.url)}
                      className={`rounded-lg overflow-hidden border aspect-square ${
                        dropImageUrl === art.url
                          ? 'border-[#D4AF37] ring-1 ring-[#D4AF37]'
                          : 'border-white/10 opacity-75 hover:opacity-100'
                      }`}
                      title={art.label}
                    >
                      <img
                        src={art.url}
                        alt={art.label}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>

              {editingItemId && (
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dropActive}
                    onChange={(e) => setDropActive(e.target.checked)}
                    className="rounded border-white/20 bg-[#121827] text-[#D4AF37]"
                  />
                  <span>Visible to members in Item Shop</span>
                </label>
              )}

              {composerError && (
                <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200">
                  {composerError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setComposerOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#141C2F] text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={publishingDrop}
                  className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-slate-950 text-xs font-bold"
                >
                  {publishingDrop
                    ? 'Saving...'
                    : editingItemId
                      ? 'Save Drop Changes'
                      : 'Publish to Royal Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Edit Awaiting Vault Drop Modal */}
      {awaitingModalOpen && isAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Awaiting Vault Drop Showcase"
        >
          <div className="w-full max-w-lg bg-[#0A0E18] border border-[#D4AF37]/40 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold font-display text-white">
                  Edit Awaiting Vault Drop
                </h2>
                <p className="text-xs text-slate-400">
                  Customize the teaser showcase shown on the Royal Vault pedestal before drops go live.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAwaitingModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAwaitingVault} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Showcase Label / Kicker
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={awaitingKicker}
                  onChange={(e) => setAwaitingKicker(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Showcase Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={awaitingTitle}
                  onChange={(e) => setAwaitingTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-sm text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Description
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    {awaitingDesc.length}/300
                  </span>
                </div>
                <textarea
                  rows={3}
                  required
                  maxLength={300}
                  value={awaitingDesc}
                  onChange={(e) => setAwaitingDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  3D Pedestal Preview Avatar / Custom GLB
                </label>
                <select
                  value={awaitingAvatarId}
                  onChange={(e) => setAwaitingAvatarId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                >
                  {DEFAULT_AVATAR_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      Chassis: {p.name}
                    </option>
                  ))}
                  {riggedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      Custom Rig: {m.name} ({m.bones.length} bones)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Teaser Thumbnail (Optional)
                  </label>
                  <div className="flex items-center gap-2">
                    {awaitingImageUrl && (
                      <button
                        type="button"
                        onClick={() => setAwaitingImageUrl('')}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                    <label className="px-2.5 py-1 rounded-md bg-[#162340] hover:bg-[#1E3159] border border-[#3B82F6]/40 text-[11px] font-semibold text-[#93C5FD] cursor-pointer flex items-center gap-1">
                      <Upload className="w-3 h-3" />
                      <span>{uploadingAwaitingThumb ? 'Uploading...' : 'Upload Thumbnail'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={uploadingAwaitingThumb}
                        className="sr-only"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          setAwaitingError(null);
                          setUploadingAwaitingThumb(true);
                          try {
                            const endpoint = await uploadImageFile(file);
                            setAwaitingImageUrl(endpoint);
                          } catch (err) {
                            setAwaitingError(
                              err instanceof Error ? err.message : 'Thumbnail upload failed.',
                            );
                          } finally {
                            setUploadingAwaitingThumb(false);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                {awaitingImageUrl && (
                  <div className="h-24 rounded-xl overflow-hidden border border-white/10 bg-[#111829] mb-2">
                    <img
                      src={awaitingImageUrl}
                      alt="Awaiting Vault teaser"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <input
                  type="text"
                  maxLength={1024}
                  value={awaitingImageUrl}
                  onChange={(e) => setAwaitingImageUrl(e.target.value)}
                  placeholder="Optional teaser image URL or upload above..."
                  className="w-full px-3 py-2 rounded-lg bg-[#121827] border border-white/10 text-xs text-white"
                />
              </div>

              {awaitingError && (
                <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200">
                  {awaitingError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAwaitingModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#141C2F] text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAwaiting}
                  className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-slate-950 text-xs font-bold"
                >
                  {savingAwaiting ? 'Saving...' : 'Save Showcase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
