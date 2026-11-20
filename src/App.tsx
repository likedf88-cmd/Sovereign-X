import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  increment,
} from 'firebase/firestore';
import {
  ADMIN_EMAILS,
  auth,
  db,
  handleFirestoreError,
  isUserAdmin,
  OperationType,
} from './firebase';
import { INITIAL_POSTS, SHOP_KNIGHT_IMAGE } from './data/catalog';
import { Volume2, VolumeX } from 'lucide-react';
import { uploadDataUrlImage } from './utils/uploadImage';
import { GlobalAudioProvider, useGlobalAudio } from './utils/audioEngine';
import type {
  AppSection,
  AvatarEmote,
  BoneNode,
  LoyaltyRank,
  PlatformMode,
  PostComment,
  PostKind,
  ReportReason,
  ReportTargetType,
  RiggedModelConfig,
  ShopCategory,
  ShopItem,
  ShopRarity,
  ShopSection,
  SocialPost,
  UserProfile,
  VaultShowcaseConfig,
  VideoPlatform,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthModal } from './components/AuthModal';
import { AccountDrawer } from './components/AccountDrawer';
import { CoverHub } from './components/CoverHub';
import { LoungeView } from './components/LoungeView';
import { MediaPulseView } from './components/MediaPulseView';
import { ItemShopView } from './components/ItemShopView';
import { RiggingStudioView } from './components/RiggingStudioView';
import { AdminPanelView } from './components/AdminPanelView';

function detectInitialPlatform(): PlatformMode {
  if (typeof window === 'undefined') return 'pc';
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  if (nav.maxTouchPoints && nav.maxTouchPoints > 0 && window.innerWidth < 900) {
    return 'mobile';
  }
  return 'pc';
}

function computeLoyaltyRank(xp: number): LoyaltyRank {
  if (xp >= 3500) return 'Sovereign';
  if (xp >= 1500) return 'Vanguard';
  if (xp >= 500) return 'Sentinel';
  return 'Squire';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const GUEST_DEFAULT_PROFILE: UserProfile = {
  uid: 'guest-vanguard',
  displayName: 'Vanguard Guest',
  handle: 'vanguard.guest',
  loyaltyRank: 'Vanguard',
  loyaltyXp: 1650,
  streakDays: 3,
  credits: 2500,
  equippedAvatarId: 'avatar-sovereign-knight',
  equippedEmote: 'hero',
  platform: detectInitialPlatform(),
};

const DEFAULT_AWAITING_VAULT: VaultShowcaseConfig = {
  kicker: 'Sovereign Pedestal · Active Chassis Preview',
  title: 'Awaiting Vault Drop',
  description:
    'Select any drop card to inspect its 3D avatar, rig stats, and purchase or equip it into the Sanctuary Lounge.',
  previewAvatarId: 'avatar-sovereign-knight',
};

function MainApp() {
  const { isMuted, toggleMute, playUiSfx } = useGlobalAudio();
  const [initialPulsePostId, setInitialPulsePostId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('pulse');
  });
  const [section, setSection] = useState<AppSection>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pulse')) {
      return 'media';
    }
    return 'cover';
  });
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [profile, setProfile] = useState<UserProfile>(GUEST_DEFAULT_PROFILE);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>(['shop-sovereign-knight']);
  const [lastDailyClaimDay, setLastDailyClaimDay] = useState<string | undefined>(undefined);

  const [cloudPosts, setCloudPosts] = useState<SocialPost[]>([]);
  const [cloudShopItems, setCloudShopItems] = useState<ShopItem[]>([]);
  const [riggedModels, setRiggedModels] = useState<RiggedModelConfig[]>([]);
  const [sandboxModels, setSandboxModels] = useState<RiggedModelConfig[]>([]);
  const [awaitingVault, setAwaitingVault] = useState<VaultShowcaseConfig>(DEFAULT_AWAITING_VAULT);
  const [likedPostIds, setLikedPostIds] = useState<string[]>([]);
  const [repostedPostIds, setRepostedPostIds] = useState<string[]>([]);
  const [localStatDeltas, setLocalStatDeltas] = useState<
    Record<string, { likes?: number; reposts?: number; shares?: number; comments?: number }>
  >({});

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [prefilledSnapshot, setPrefilledSnapshot] = useState<string | null>(null);
  const [isDelegatedAdmin, setIsDelegatedAdmin] = useState(false);

  const isHighestAdmin = useMemo(() => isUserAdmin(firebaseUser), [firebaseUser]);
  const isAdmin = isHighestAdmin || isDelegatedAdmin;
  const isSuspended = profile.accountStatus === 'suspended';
  const isUnverifiedAdminEmail = useMemo(() => {
    if (!firebaseUser?.email) return false;
    return ADMIN_EMAILS.includes(firebaseUser.email.toLowerCase()) && !firebaseUser.emailVerified;
  }, [firebaseUser]);
  const dailyClaimedToday = lastDailyClaimDay === todayKey();

  // Item Shop stays empty until an admin posts drops into Firestore
  const allShopItems = useMemo(() => {
    return [...cloudShopItems].sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [cloudShopItems]);

  const allPosts = useMemo(() => {
    const sortedCloud = [...cloudPosts].sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });
    const map = new Map<string, SocialPost>();
    sortedCloud.forEach((p) => map.set(p.id, p));
    INITIAL_POSTS.forEach((p) => {
      if (!map.has(p.id)) map.set(p.id, p);
    });
    return Array.from(map.values()).map((post) => {
      const delta = localStatDeltas[post.id];
      if (!delta) return post;
      return {
        ...post,
        likesCount: Math.max(0, (post.likesCount || 0) + (delta.likes || 0)),
        commentsCount: Math.max(0, (post.commentsCount || 0) + (delta.comments || 0)),
        repostsCount: Math.max(0, (post.repostsCount || 0) + (delta.reposts || 0)),
        sharesCount: Math.max(0, (post.sharesCount || 0) + (delta.shares || 0)),
      };
    });
  }, [cloudPosts, localStatDeltas]);

  const allRiggedModels = useMemo(() => {
    const sortedCloud = [...riggedModels].sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });
    return [...sortedCloud, ...sandboxModels];
  }, [riggedModels, sandboxModels]);

  // Firebase Auth listener & automatic user profile provisioning
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setProfile(GUEST_DEFAULT_PROFILE);
        setOwnedItemIds(['shop-sovereign-knight']);
        setLastDailyClaimDay(undefined);
        setLikedPostIds([]);
        setIsDelegatedAdmin(false);
        return;
      }

      const publicRef = doc(db, 'users', user.uid);
      const privateRef = doc(db, 'users', user.uid, 'private', 'info');
      const verifiedAdmin = isUserAdmin(user);

      let pendingOp: OperationType = OperationType.GET;
      let pendingPath = `users/${user.uid}`;
      try {
        const snap = await getDoc(publicRef);
        if (!snap.exists()) {
          pendingOp = OperationType.WRITE;
          const cleanName = (user.displayName || user.email?.split('@')[0] || 'Vanguard Member').slice(0, 64);
          const rawHandle = (user.email?.split('@')[0] || user.uid.slice(0, 8))
            .replace(/[^a-zA-Z0-9_.]/g, '')
            .slice(0, 28);
          const handle = rawHandle.length >= 2 ? rawHandle : `user_${user.uid.slice(0, 6)}`;

          const initialProfile: UserProfile = {
            uid: user.uid,
            displayName: cleanName,
            handle,
            ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
            loyaltyRank: verifiedAdmin ? 'Sovereign' : 'Squire',
            loyaltyXp: verifiedAdmin ? 10000 : 100,
            streakDays: verifiedAdmin ? 30 : 1,
            credits: verifiedAdmin ? 100000 : 2500,
            equippedAvatarId: 'avatar-sovereign-knight',
            equippedEmote: 'hero',
            platform: detectInitialPlatform(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(publicRef, initialProfile);
        } else if (verifiedAdmin) {
          const existing = snap.data() as UserProfile;
          if (
            existing.loyaltyRank !== 'Sovereign' ||
            existing.loyaltyXp < 10000 ||
            existing.credits < 100000
          ) {
            pendingOp = OperationType.UPDATE;
            await updateDoc(publicRef, {
              loyaltyRank: 'Sovereign',
              loyaltyXp: Math.max(existing.loyaltyXp || 0, 10000),
              credits: Math.max(existing.credits || 0, 100000),
              streakDays: Math.max(existing.streakDays || 0, 30),
              updatedAt: serverTimestamp(),
            });
          }
        }

        pendingOp = OperationType.GET;
        pendingPath = `users/${user.uid}/private/info`;
        const privSnap = await getDoc(privateRef);
        if (!privSnap.exists()) {
          pendingOp = OperationType.WRITE;
          await setDoc(privateRef, {
            uid: user.uid,
            ...(user.email ? { email: user.email.slice(0, 256) } : {}),
            ownedItemIds: ['shop-sovereign-knight'],
            updatedAt: serverTimestamp(),
          });
        }

        // Check delegated admin assignment in /admins/{uid}
        try {
          const adminSnap = await getDoc(doc(db, 'admins', user.uid));
          setIsDelegatedAdmin(adminSnap.exists());
        } catch {
          setIsDelegatedAdmin(false);
        }
      } catch (err) {
        handleFirestoreError(err, pendingOp, pendingPath);
      }
    });

    return () => unsub();
  }, []);

  // Subscribe to user's own public & private Firestore docs when signed in
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const unsubPublic = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`),
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'users', firebaseUser.uid, 'private', 'info'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as { ownedItemIds?: string[]; lastDailyClaimDay?: string };
          setOwnedItemIds(data.ownedItemIds || ['shop-sovereign-knight']);
          setLastDailyClaimDay(data.lastDailyClaimDay);
        }
      },
      (err) =>
        handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}/private/info`),
    );

    return () => {
      unsubPublic();
      unsubPrivate();
    };
  }, [authReady, firebaseUser]);

  // Public Marketplace, Rigged Models, Vault Showcase & Social Feed Firestore Streams
  useEffect(() => {
    const shopQuery =
      isHighestAdmin && authReady
        ? query(collection(db, 'shopItems'))
        : query(collection(db, 'shopItems'), where('active', '==', true));
    const unsubShop = onSnapshot(
      shopQuery,
      (snap) => {
        setCloudShopItems(snap.docs.map((d) => d.data() as ShopItem));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'shopItems'),
    );

    const modelsQuery = query(
      collection(db, 'riggedModels'),
      where('sourceType', 'in', ['procedural-knight', 'procedural-vanguard', 'glb-custom']),
    );
    const unsubModels = onSnapshot(
      modelsQuery,
      (snap) => {
        setRiggedModels(snap.docs.map((d) => d.data() as RiggedModelConfig));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'riggedModels'),
    );

    const postsQuery = query(
      collection(db, 'posts'),
      where('kind', 'in', ['reel', 'photo', 'story']),
    );
    const unsubPosts = onSnapshot(
      postsQuery,
      (snap) => {
        setCloudPosts(snap.docs.map((d) => d.data() as SocialPost));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'posts'),
    );

    const unsubVault = onSnapshot(
      doc(db, 'siteSettings', 'awaitingVault'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<VaultShowcaseConfig>;
          setAwaitingVault({
            kicker: data.kicker || DEFAULT_AWAITING_VAULT.kicker,
            title: data.title || DEFAULT_AWAITING_VAULT.title,
            description: data.description || DEFAULT_AWAITING_VAULT.description,
            previewAvatarId: data.previewAvatarId || DEFAULT_AWAITING_VAULT.previewAvatarId,
            ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
            updatedAt: data.updatedAt,
          });
        } else {
          setAwaitingVault(DEFAULT_AWAITING_VAULT);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'siteSettings/awaitingVault'),
    );

    return () => {
      unsubShop();
      unsubModels();
      unsubPosts();
      unsubVault();
    };
  }, [isHighestAdmin, authReady]);

  const updateUserField = async (patch: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
    if (!firebaseUser) return;
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const handleClaimDaily = async (): Promise<boolean> => {
    if (dailyClaimedToday) return false;
    const nextCredits = Math.min(1000000, profile.credits + 250);
    const nextXp = profile.loyaltyXp + 100;
    const nextRank = computeLoyaltyRank(nextXp);
    const nextStreak = profile.streakDays + 1;
    const day = todayKey();

    setProfile((prev) => ({
      ...prev,
      credits: nextCredits,
      loyaltyXp: nextXp,
      loyaltyRank: nextRank,
      streakDays: nextStreak,
    }));
    setLastDailyClaimDay(day);

    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          credits: nextCredits,
          loyaltyXp: nextXp,
          loyaltyRank: nextRank,
          streakDays: nextStreak,
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'info'), {
          lastDailyClaimDay: day,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
    return true;
  };

  const handlePurchaseItem = async (
    item: ShopItem,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (isSuspended) {
      return { ok: false, error: 'Account is suspended from marketplace purchases.' };
    }
    if (ownedItemIds.includes(item.id)) return { ok: true };
    if (profile.credits < item.price) {
      return { ok: false, error: 'Insufficient Sovereign Credits. Claim daily loyalty or post reels to earn more.' };
    }

    const nextCredits = profile.credits - item.price;
    const nextXp = profile.loyaltyXp + 150;
    const nextRank = computeLoyaltyRank(nextXp);
    const nextOwned = [...ownedItemIds, item.id].slice(0, 100);

    setProfile((prev) => ({
      ...prev,
      credits: nextCredits,
      loyaltyXp: nextXp,
      loyaltyRank: nextRank,
    }));
    setOwnedItemIds(nextOwned);

    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          credits: nextCredits,
          loyaltyXp: nextXp,
          loyaltyRank: nextRank,
          streakDays: profile.streakDays,
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'info'), {
          ownedItemIds: nextOwned,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }

    await handleEquipItem(item);
    return { ok: true };
  };

  const handleEquipItem = async (item: ShopItem) => {
    if (item.category === 'emote' && item.presetKey) {
      await updateUserField({ equippedEmote: item.presetKey as AvatarEmote });
      return;
    }
    const avatarTarget = item.riggedModelId || item.presetKey || item.id;
    await updateUserField({ equippedAvatarId: avatarTarget });
  };

  const handleToggleLike = async (post: SocialPost) => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    const alreadyLiked = likedPostIds.includes(post.id);
    setLikedPostIds((prev) =>
      alreadyLiked ? prev.filter((id) => id !== post.id) : [...prev, post.id],
    );
    playUiSfx('like');

    // If post is a seeded initial post, update local optimistic delta cleanly
    const isCloudPost = cloudPosts.some((p) => p.id === post.id);
    if (!isCloudPost) {
      setLocalStatDeltas((prev) => {
        const cur = prev[post.id] || {};
        return {
          ...prev,
          [post.id]: { ...cur, likes: (cur.likes || 0) + (alreadyLiked ? -1 : 1) },
        };
      });
      return;
    }

    const likeRef = doc(db, 'posts', post.id, 'likes', firebaseUser.uid);
    const postRef = doc(db, 'posts', post.id);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, {
          likesCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(likeRef, {
          uid: firebaseUser.uid,
          postId: post.id,
          createdAt: serverTimestamp(),
        });
        await updateDoc(postRef, {
          likesCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `posts/${post.id}/likes/${firebaseUser.uid}`);
    }
  };

  const handleCreatePost = async (input: {
    kind: PostKind;
    caption: string;
    mediaUrl?: string;
    videoPlatform?: VideoPlatform;
    sourceUrl?: string;
    embedUrl?: string;
    repostedFromPostId?: string;
    repostedFromAuthor?: string;
    avatarId?: string;
    emote?: AvatarEmote;
  }) => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    if (isSuspended) return;
    const postId = `post_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    let mediaStr: string | undefined;
    if (input.mediaUrl) {
      if (input.mediaUrl.startsWith('data:image/')) {
        try {
          mediaStr = (await uploadDataUrlImage(input.mediaUrl)).slice(0, 1024);
        } catch {
          mediaStr = undefined;
        }
      } else if (!input.mediaUrl.startsWith('data:')) {
        mediaStr = input.mediaUrl.slice(0, 1024);
      }
    }

    try {
      await setDoc(doc(db, 'posts', postId), {
        id: postId,
        authorId: firebaseUser.uid,
        authorName: profile.displayName.slice(0, 64),
        authorHandle: profile.handle.slice(0, 32),
        kind: input.kind,
        caption: input.caption.slice(0, 500),
        ...(mediaStr ? { mediaUrl: mediaStr } : {}),
        ...(input.videoPlatform ? { videoPlatform: input.videoPlatform } : {}),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl.slice(0, 1024) } : {}),
        ...(input.embedUrl ? { embedUrl: input.embedUrl.slice(0, 1024) } : {}),
        ...(input.repostedFromPostId
          ? { repostedFromPostId: input.repostedFromPostId.slice(0, 128) }
          : {}),
        ...(input.repostedFromAuthor
          ? { repostedFromAuthor: input.repostedFromAuthor.slice(0, 64) }
          : {}),
        ...(input.avatarId ? { avatarId: input.avatarId.slice(0, 128) } : {}),
        ...(input.emote ? { emote: input.emote.slice(0, 64) } : {}),
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        sharesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      playUiSfx(input.kind === 'story' ? 'story' : 'post');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `posts/${postId}`);
    }
  };

  const handleRepostPost = async (post: SocialPost) => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    if (isSuspended) return;
    if (!repostedPostIds.includes(post.id)) {
      setRepostedPostIds((prev) => [...prev, post.id]);
    }
    playUiSfx('repost');

    await handleCreatePost({
      kind: post.kind === 'photo' ? 'photo' : 'reel',
      caption: post.caption.slice(0, 500),
      mediaUrl: post.mediaUrl,
      videoPlatform: post.videoPlatform,
      sourceUrl: post.sourceUrl,
      embedUrl: post.embedUrl,
      repostedFromPostId: post.id,
      repostedFromAuthor: post.authorName.slice(0, 64),
      avatarId: post.avatarId,
      emote: post.emote,
    });

    const isCloudPost = cloudPosts.some((p) => p.id === post.id);
    if (!isCloudPost) {
      setLocalStatDeltas((prev) => {
        const cur = prev[post.id] || {};
        return { ...prev, [post.id]: { ...cur, reposts: (cur.reposts || 0) + 1 } };
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        repostsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${post.id}`);
    }
  };

  const handleSharePost = async (post: SocialPost) => {
    playUiSfx('share');
    if (typeof window !== 'undefined' && navigator.clipboard?.writeText) {
      const shareUrl = `${window.location.origin}/?pulse=${encodeURIComponent(post.id)}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        // clipboard may be blocked in un-focused frames
      }
    }

    const isCloudPost = cloudPosts.some((p) => p.id === post.id);
    if (!firebaseUser || !isCloudPost) {
      setLocalStatDeltas((prev) => {
        const cur = prev[post.id] || {};
        return { ...prev, [post.id]: { ...cur, shares: (cur.shares || 0) + 1 } };
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        sharesCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${post.id}`);
    }
  };

  const handleAddToStory = async (post: SocialPost) => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    if (isSuspended) return;
    await handleCreatePost({
      kind: 'story',
      caption: post.caption.slice(0, 500),
      mediaUrl: post.mediaUrl,
      videoPlatform: post.videoPlatform,
      sourceUrl: post.sourceUrl,
      embedUrl: post.embedUrl,
      repostedFromPostId: post.id,
      repostedFromAuthor: post.authorName.slice(0, 64),
      avatarId: post.avatarId,
      emote: post.emote,
    });
  };

  const handleDeletePost = async (postId: string) => {
    if (!firebaseUser || !isAdmin) return;
    try {
      await deleteDoc(doc(db, 'posts', postId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `posts/${postId}`);
    }
  };

  const handleCreateReport = async (input: {
    targetType: ReportTargetType;
    targetId: string;
    targetAuthorId?: string;
    targetAuthorName: string;
    targetExcerpt: string;
    reason: ReportReason;
    details?: string;
  }) => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    const reportId = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporterId: firebaseUser.uid,
        reporterName: profile.displayName.slice(0, 64),
        targetType: input.targetType,
        targetId: input.targetId.slice(0, 128),
        ...(input.targetAuthorId ? { targetAuthorId: input.targetAuthorId.slice(0, 128) } : {}),
        targetAuthorName: input.targetAuthorName.slice(0, 64),
        targetExcerpt: input.targetExcerpt.slice(0, 300),
        reason: input.reason,
        ...(input.details ? { details: input.details.slice(0, 400) } : {}),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
    }
  };

  const handleLoadComments = async (postId: string): Promise<PostComment[]> => {
    const isCloudPost = cloudPosts.some((p) => p.id === postId);
    if (!isCloudPost) return [];
    try {
      const snap = await getDocs(
        query(collection(db, 'posts', postId, 'comments'), where('postId', '==', postId)),
      );
      return snap.docs
        .map((d) => d.data() as PostComment)
        .sort((a, b) => {
          const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          return ta - tb;
        });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `posts/${postId}/comments`);
    }
  };

  const handleAddComment = async (postId: string, text: string): Promise<PostComment | null> => {
    if (!firebaseUser || isSuspended) return null;
    const isCloudPost = cloudPosts.some((p) => p.id === postId);
    const commentId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const newComment: PostComment = {
      id: commentId,
      postId,
      authorId: firebaseUser.uid,
      authorName: profile.displayName.slice(0, 64),
      text: text.slice(0, 300),
      createdAt: serverTimestamp(),
    };
    if (!isCloudPost) {
      setLocalStatDeltas((prev) => {
        const cur = prev[postId] || {};
        return { ...prev, [postId]: { ...cur, comments: (cur.comments || 0) + 1 } };
      });
      return newComment;
    }

    try {
      await setDoc(doc(db, 'posts', postId, 'comments', commentId), newComment);
      await updateDoc(doc(db, 'posts', postId), {
        commentsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      return newComment;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `posts/${postId}/comments/${commentId}`);
    }
  };

  const handlePublishRiggedAsset = async (input: {
    modelId: string;
    name: string;
    description?: string;
    section?: ShopSection;
    imageUrl?: string;
    sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
    glbBuffer: ArrayBuffer | null;
    bones: BoneNode[];
    weightConfig: { radius: number; falloff: number; symmetry: boolean };
    defaultAnimation: AvatarEmote;
    price: number;
    rarity: ShopRarity;
  }) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Admin account required to publish global storefront assets.');
    }

    let modelEndpoint: string | undefined;
    if (input.sourceType === 'glb-custom' && input.glbBuffer) {
      const resp = await fetch(`/api/models/${input.modelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.glbBuffer,
      });
      if (!resp.ok) {
        throw new Error('Failed to upload GLB binary to asset host.');
      }
      modelEndpoint = `/api/models/${input.modelId}`;
    }

    let resolvedImageUrl = SHOP_KNIGHT_IMAGE;
    if (input.imageUrl) {
      if (input.imageUrl.startsWith('data:image/')) {
        resolvedImageUrl = (await uploadDataUrlImage(input.imageUrl)).slice(0, 1024);
      } else {
        resolvedImageUrl = input.imageUrl.trim().slice(0, 1024) || SHOP_KNIGHT_IMAGE;
      }
    }

    const sanitizedBones = input.bones.slice(0, 80).map((b) => ({
      name: b.name.slice(0, 40),
      parent: b.parent ? b.parent.slice(0, 40) : null,
      position: b.position,
      ...(b.rotation ? { rotation: b.rotation } : {}),
      ...(b.scale ? { scale: b.scale } : {}),
      ...(b.roll !== undefined ? { roll: b.roll } : {}),
      ...(b.connected !== undefined ? { connected: b.connected } : {}),
      ...(b.weightScale !== undefined ? { weightScale: b.weightScale } : {}),
    }));

    const cleanDescription =
      input.description?.trim().slice(0, 300) ||
      `Admin-rigged 3D skeleton (${sanitizedBones.length} bones) ready for cross-platform Lounge motion.`;

    try {
      await setDoc(doc(db, 'riggedModels', input.modelId), {
        id: input.modelId,
        name: input.name.slice(0, 80),
        creatorId: firebaseUser.uid,
        sourceType: input.sourceType,
        ...(modelEndpoint ? { modelEndpoint } : {}),
        bones: sanitizedBones,
        weightConfig: input.weightConfig,
        defaultAnimation: input.defaultAnimation,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const shopItemId = `item_${input.modelId}`;
      await setDoc(doc(db, 'shopItems', shopItemId), {
        id: shopItemId,
        name: input.name.slice(0, 80),
        description: cleanDescription,
        category: 'avatar',
        section: input.section || 'featured',
        rarity: input.rarity,
        price: Math.max(0, Math.min(50000, Math.round(input.price))),
        imageUrl: resolvedImageUrl,
        riggedModelId: input.modelId,
        creatorId: firebaseUser.uid,
        creatorName: profile.displayName.slice(0, 64),
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `riggedModels/${input.modelId}`);
    }
  };

  const handleSaveRigToLibrary = async (input: {
    modelId: string;
    name: string;
    sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
    glbBuffer: ArrayBuffer | null;
    bones: BoneNode[];
    weightConfig: { radius: number; falloff: number; symmetry: boolean };
    defaultAnimation: AvatarEmote;
  }) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Admin account required to save models to the Character Library.');
    }

    let modelEndpoint: string | undefined;
    if (input.sourceType === 'glb-custom' && input.glbBuffer) {
      const resp = await fetch(`/api/models/${input.modelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.glbBuffer,
      });
      if (!resp.ok) {
        throw new Error('Failed to upload GLB binary to asset host.');
      }
      modelEndpoint = `/api/models/${input.modelId}`;
    }

    const sanitizedBones = input.bones.slice(0, 80).map((b) => ({
      name: b.name.slice(0, 40),
      parent: b.parent ? b.parent.slice(0, 40) : null,
      position: b.position,
      ...(b.rotation ? { rotation: b.rotation } : {}),
      ...(b.scale ? { scale: b.scale } : {}),
      ...(b.roll !== undefined ? { roll: b.roll } : {}),
      ...(b.connected !== undefined ? { connected: b.connected } : {}),
      ...(b.weightScale !== undefined ? { weightScale: b.weightScale } : {}),
    }));

    try {
      await setDoc(doc(db, 'riggedModels', input.modelId), {
        id: input.modelId,
        name: input.name.slice(0, 80),
        creatorId: firebaseUser.uid,
        sourceType: input.sourceType,
        ...(modelEndpoint ? { modelEndpoint } : {}),
        bones: sanitizedBones,
        weightConfig: input.weightConfig,
        defaultAnimation: input.defaultAnimation,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `riggedModels/${input.modelId}`);
    }
  };

  const handleCreateShopItem = async (input: {
    name: string;
    description: string;
    category: ShopCategory;
    section: ShopSection;
    rarity: ShopRarity;
    price: number;
    imageUrl: string;
    presetKey?: string;
    riggedModelId?: string;
  }) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Highest Admin account required to post Item Shop drops.');
    }
    const itemId = `drop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'shopItems', itemId), {
        id: itemId,
        name: input.name.trim().slice(0, 80),
        description: input.description.trim().slice(0, 300),
        category: input.category,
        section: input.section,
        rarity: input.rarity,
        price: Math.max(0, Math.min(50000, Math.round(input.price))),
        imageUrl: input.imageUrl.slice(0, 1024),
        ...(input.presetKey ? { presetKey: input.presetKey.slice(0, 64) } : {}),
        ...(input.riggedModelId ? { riggedModelId: input.riggedModelId.slice(0, 128) } : {}),
        creatorId: firebaseUser.uid,
        creatorName: profile.displayName.slice(0, 64),
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `shopItems/${itemId}`);
    }
  };

  const handleUpdateShopItem = async (itemId: string, patch: Partial<ShopItem>) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Admin account required to edit Item Shop drops.');
    }
    const sanitizedPatch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof patch.name === 'string') {
      sanitizedPatch.name = patch.name.trim().slice(0, 80) || 'Sovereign Drop';
    }
    if (typeof patch.description === 'string') {
      sanitizedPatch.description =
        patch.description.trim().slice(0, 300) ||
        'Bespoke Sovereign Obsidian & Champagne Gold release.';
    }
    if (patch.category) sanitizedPatch.category = patch.category;
    if (patch.section) sanitizedPatch.section = patch.section;
    if (patch.rarity) sanitizedPatch.rarity = patch.rarity;
    if (typeof patch.price === 'number' && Number.isFinite(patch.price)) {
      sanitizedPatch.price = Math.max(0, Math.min(50000, Math.round(patch.price)));
    }
    if (typeof patch.imageUrl === 'string') {
      sanitizedPatch.imageUrl = patch.imageUrl.trim().slice(0, 1024);
    }
    if (typeof patch.presetKey === 'string') {
      sanitizedPatch.presetKey = patch.presetKey.slice(0, 64);
    }
    if (typeof patch.riggedModelId === 'string') {
      sanitizedPatch.riggedModelId = patch.riggedModelId.slice(0, 128);
    }
    if (typeof patch.active === 'boolean') {
      sanitizedPatch.active = patch.active;
    }

    try {
      await updateDoc(doc(db, 'shopItems', itemId), sanitizedPatch);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shopItems/${itemId}`);
    }
  };

  const handleUpdateAwaitingVault = async (config: VaultShowcaseConfig) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Admin account required to update Awaiting Vault Drop.');
    }
    const cleanImageUrl = config.imageUrl?.trim().slice(0, 1024);
    const payload: Record<string, unknown> = {
      kicker: config.kicker.trim().slice(0, 80) || DEFAULT_AWAITING_VAULT.kicker,
      title: config.title.trim().slice(0, 80) || DEFAULT_AWAITING_VAULT.title,
      description: config.description.trim().slice(0, 300) || DEFAULT_AWAITING_VAULT.description,
      previewAvatarId:
        config.previewAvatarId.trim().slice(0, 128) || DEFAULT_AWAITING_VAULT.previewAvatarId,
      ...(cleanImageUrl ? { imageUrl: cleanImageUrl } : {}),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'siteSettings', 'awaitingVault'), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'siteSettings/awaitingVault');
    }
  };

  const handleEarnArenaReward = async (creditsDelta: number, xpDelta: number) => {
    if (isSuspended) return;
    const safeCredits = Math.max(0, Math.min(500, Math.round(creditsDelta)));
    const safeXp = Math.max(0, Math.min(500, Math.round(xpDelta)));
    const nextCredits = Math.min(1000000, profile.credits + safeCredits);
    const nextXp = Math.min(10000000, profile.loyaltyXp + safeXp);
    const nextRank = computeLoyaltyRank(nextXp);

    setProfile((prev) => ({
      ...prev,
      credits: nextCredits,
      loyaltyXp: nextXp,
      loyaltyRank: nextRank,
    }));

    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          credits: nextCredits,
          loyaltyXp: nextXp,
          loyaltyRank: nextRank,
          streakDays: profile.streakDays,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const handleDeleteShopItem = async (itemId: string) => {
    if (!firebaseUser || !isAdmin) {
      throw new Error('Verified Highest Admin account required to remove Item Shop drops.');
    }
    try {
      await deleteDoc(doc(db, 'shopItems', itemId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `shopItems/${itemId}`);
    }
  };

  const navLinks: Array<{ id: AppSection; label: string }> = [
    { id: 'cover', label: 'Cover Hub' },
    { id: 'lounge', label: '3D Lounge' },
    { id: 'media', label: 'Media Pulse' },
    { id: 'shop', label: 'Item Shop' },
    { id: 'studio', label: 'Rigging Studio' },
    ...(isAdmin ? [{ id: 'admin' as AppSection, label: 'Admin' }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#06080E] text-[#F1F5F9] flex flex-col">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="h-16 px-4 sm:px-6 border-b border-[#D4AF37]/20 bg-[#05070D] flex items-center justify-between gap-8 sticky top-0 z-40">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => {
            playUiSfx('nav');
            setSection('cover');
          }}
          className="text-lg font-bold font-display tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Sovereign <span className="text-[#D4AF37]">X</span>
        </button>

        {/* Zone 2: 5 concise single-line nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navLinks.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => {
                playUiSfx('nav');
                setSection(link.id);
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                section === link.id
                  ? 'text-white border-[#D4AF37]'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              {link.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Global Mute toggle + Primary Account Action */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute Sovereign X audio' : 'Mute Sovereign X audio'}
            title={isMuted ? 'Sound Off — Click to enable ambient & SFX' : 'Sound On — Click to mute audio'}
            data-testid="global-mute-button"
            className={`h-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              isMuted
                ? 'bg-[#111624] border-white/12 text-slate-400 hover:text-white hover:border-white/25'
                : 'bg-[#17130B] border-[#D4AF37]/50 text-[#FDE68A] hover:bg-[#221B0F]'
            }`}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isMuted ? 'Muted' : 'Audio'}</span>
          </button>

          {firebaseUser ? (
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className={`px-4 py-2 rounded-lg text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 max-w-[190px] truncate border ${
                isAdmin
                  ? 'bg-[#17130B] hover:bg-[#231C0F] border-[#D4AF37]/60 text-[#FDE68A]'
                  : 'bg-[#141C2F] hover:bg-[#1D2842] border-white/12'
              }`}
            >
              {isAdmin ? `Sovereign · ${profile.displayName}` : profile.displayName}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {isUnverifiedAdminEmail && (
        <div className="bg-[#1A1308] border-b border-[#D4AF37]/30 px-4 py-2 text-center text-xs text-[#FDE68A]">
          Highest Admin email detected. Verify your email or sign in via Google OAuth to activate Sovereign Admin publishing permissions.
        </div>
      )}

      {isSuspended && (
        <div className="bg-red-950/90 border-b border-red-500/40 px-4 py-2 text-center text-xs text-red-200">
          Your account is currently suspended{profile.adminNote ? `: ${profile.adminNote}` : '.'} Social posting is restricted.
        </div>
      )}

      {/* Compact Mobile Navigation Strip (visible < md) */}
      <div className="md:hidden border-b border-white/10 bg-[#090D18] px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {navLinks.map((link) => (
          <button
            key={link.id}
            type="button"
            onClick={() => setSection(link.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 ${
              section === link.id ? 'bg-[#2563EB] text-white' : 'bg-[#12192B] text-slate-300'
            }`}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* Active Experience Viewport */}
      <main className="flex-1">
        {section === 'cover' && (
          <CoverHub
            profile={profile}
            riggedModels={allRiggedModels}
            onNavigate={setSection}
            onChangeEmote={(emote) => void updateUserField({ equippedEmote: emote })}
            onSwitchPlatform={(platform) => void updateUserField({ platform })}
            onClaimDaily={handleClaimDaily}
            dailyClaimedToday={dailyClaimedToday}
            onCaptureToFeed={(dataUrl) => {
              setPrefilledSnapshot(dataUrl);
              setSection('media');
            }}
          />
        )}

        {section === 'lounge' && (
          <LoungeView
            profile={profile}
            riggedModels={allRiggedModels}
            onSwitchPlatform={(platform) => void updateUserField({ platform })}
            onChangeEmote={(emote) => void updateUserField({ equippedEmote: emote })}
            onEquipAvatar={(avatarId) => void updateUserField({ equippedAvatarId: avatarId })}
            onEarnArenaReward={handleEarnArenaReward}
            onCreateReport={handleCreateReport}
          />
        )}

        {section === 'media' && (
          <MediaPulseView
            firebaseUser={firebaseUser}
            profile={profile}
            isAdmin={isAdmin}
            posts={allPosts}
            likedPostIds={likedPostIds}
            repostedPostIds={repostedPostIds}
            initialPostId={initialPulsePostId}
            onClearInitialPostId={() => setInitialPulsePostId(null)}
            onToggleLike={handleToggleLike}
            onRepostPost={handleRepostPost}
            onSharePost={handleSharePost}
            onAddToStory={handleAddToStory}
            onCreatePost={handleCreatePost}
            onDeletePost={handleDeletePost}
            onCreateReport={handleCreateReport}
            onLoadComments={handleLoadComments}
            onAddComment={handleAddComment}
            onEquipFromPost={(avatarId, emote) => {
              void updateUserField({
                ...(avatarId ? { equippedAvatarId: avatarId } : {}),
                ...(emote ? { equippedEmote: emote } : {}),
              });
              setSection('lounge');
            }}
            onOpenAuth={() => setAuthModalOpen(true)}
            prefilledSnapshotUrl={prefilledSnapshot}
            onClearPrefilledSnapshot={() => setPrefilledSnapshot(null)}
          />
        )}

        {section === 'shop' && (
          <ItemShopView
            profile={profile}
            isAdmin={isAdmin}
            shopItems={allShopItems}
            ownedItemIds={ownedItemIds}
            riggedModels={allRiggedModels}
            awaitingVault={awaitingVault}
            onUpdateAwaitingVault={handleUpdateAwaitingVault}
            onPurchaseItem={handlePurchaseItem}
            onEquipItem={handleEquipItem}
            onCreateShopItem={handleCreateShopItem}
            onUpdateShopItem={handleUpdateShopItem}
            onDeleteShopItem={handleDeleteShopItem}
            onNavigateToStudio={() => setSection('studio')}
          />
        )}

        {section === 'studio' && (
          <RiggingStudioView
            isAdmin={isAdmin}
            userId={profile.uid}
            userName={profile.displayName}
            onPublishRiggedAsset={handlePublishRiggedAsset}
            onSaveToLibrary={handleSaveRigToLibrary}
            onTestLocallyInLounge={(config) => {
              setSandboxModels((prev) => [config, ...prev.filter((m) => m.id !== config.id)]);
              void updateUserField({
                equippedAvatarId: config.id,
                equippedEmote: config.defaultAnimation,
              });
              setSection('lounge');
            }}
          />
        )}

        {section === 'admin' && isAdmin && firebaseUser && (
          <AdminPanelView
            currentUid={firebaseUser.uid}
            currentEmail={firebaseUser.email || ''}
            isHighestAdmin={isHighestAdmin}
            posts={cloudPosts}
            shopItems={allShopItems}
            riggedModels={riggedModels}
            onDeletePost={handleDeletePost}
            onUpdateShopItem={handleUpdateShopItem}
            onDeleteShopItem={handleDeleteShopItem}
            onSaveRigToLibrary={handleSaveRigToLibrary}
            onNavigateToShop={() => setSection('shop')}
            onNavigateToStudio={() => setSection('studio')}
          />
        )}
      </main>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      <AccountDrawer
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        firebaseUser={firebaseUser}
        profile={profile}
        ownedItemIds={ownedItemIds}
        shopItems={allShopItems}
        riggedModels={allRiggedModels}
        onSwitchPlatform={(platform) => void updateUserField({ platform })}
        onEquipAvatar={(avatarId) => void updateUserField({ equippedAvatarId: avatarId })}
        onClaimDaily={handleClaimDaily}
        dailyClaimedToday={dailyClaimedToday}
        isAdmin={isAdmin}
        onOpenAdmin={() => setSection('admin')}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalAudioProvider>
        <MainApp />
      </GlobalAudioProvider>
    </ErrorBoundary>
  );
}
