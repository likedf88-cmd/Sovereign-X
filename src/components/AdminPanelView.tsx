import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Crown,
  Users,
  Flag,
  MessageSquareWarning,
  ShoppingBag,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Search,
  CheckCircle2,
  Eye,
  EyeOff,
  Bone as BoneIcon,
  Wrench,
  Pencil,
  Upload,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { SHOP_KNIGHT_IMAGE } from '../data/catalog';
import { uploadImageFile } from '../utils/uploadImage';
import {
  exportGroupWithAnimations,
  extractPreservedBoundRig,
  importModelFiles,
} from '../three/modelImporter';
import { buildIntelligentHumanoidRig } from '../three/autoRigger';
import {
  bindSkeletonToModelGroup,
  computeHeatMapWeightsForMesh,
  normalizeModelToUnitHeight,
} from '../three/riggingEngine';
import { compileClipFromPreset } from '../three/animationSystem';
import type {
  AccountStatus,
  AdminRecord,
  AvatarEmote,
  BoneNode,
  ContentReport,
  LoyaltyRank,
  ReportStatus,
  RiggedModelConfig,
  ShopCategory,
  ShopItem,
  ShopRarity,
  ShopSection,
  SocialPost,
  UserProfile,
} from '../types';

interface AdminPanelViewProps {
  currentUid: string;
  currentEmail: string;
  isHighestAdmin: boolean;
  posts: SocialPost[];
  shopItems: ShopItem[];
  riggedModels: RiggedModelConfig[];
  onDeletePost: (postId: string) => Promise<void>;
  onUpdateShopItem?: (itemId: string, patch: Partial<ShopItem>) => Promise<void>;
  onDeleteShopItem: (itemId: string) => Promise<void>;
  onSaveRigToLibrary?: (input: {
    modelId: string;
    name: string;
    sourceType: 'procedural-knight' | 'procedural-vanguard' | 'glb-custom';
    glbBuffer: ArrayBuffer | null;
    bones: BoneNode[];
    weightConfig: { radius: number; falloff: number; symmetry: boolean };
    defaultAnimation: AvatarEmote;
  }) => Promise<void>;
  onNavigateToShop: () => void;
  onNavigateToStudio: () => void;
}

type AdminTab = 'members' | 'reports' | 'posts' | 'vault';

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  currentUid,
  currentEmail,
  isHighestAdmin,
  posts,
  shopItems,
  riggedModels,
  onDeletePost,
  onUpdateShopItem,
  onDeleteShopItem,
  onSaveRigToLibrary,
  onNavigateToShop,
  onNavigateToStudio,
}) => {
  const [tab, setTab] = useState<AdminTab>('members');

  // Live Firestore collections
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([]);
  const [allShopItems, setAllShopItems] = useState<ShopItem[]>(shopItems);
  const [reportsError, setReportsError] = useState<string | null>(null);

  // Member filter & inspection state
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState<'all' | AccountStatus>('all');
  const [editingMember, setEditingMember] = useState<UserProfile | null>(null);
  const [memberPrivateInfo, setMemberPrivateInfo] = useState<{
    email?: string;
    ownedCount?: number;
  } | null>(null);
  const [editCredits, setEditCredits] = useState(0);
  const [editXp, setEditXp] = useState(0);
  const [editRank, setEditRank] = useState<LoyaltyRank>('Squire');
  const [editStatus, setEditStatus] = useState<AccountStatus>('active');
  const [editNote, setEditNote] = useState('');
  const [savingMember, setSavingMember] = useState(false);

  // Reports filter & moderation state
  const [reportFilter, setReportFilter] = useState<'all' | ReportStatus>('all');
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [uploadingGlb, setUploadingGlb] = useState(false);
  const glbInputRef = useRef<HTMLInputElement | null>(null);

  // Posts search
  const [postSearch, setPostSearch] = useState('');

  // Edit Shop Item modal state
  const [editingShopItem, setEditingShopItem] = useState<ShopItem | null>(null);
  const [dropName, setDropName] = useState('');
  const [dropDesc, setDropDesc] = useState('');
  const [dropCategory, setDropCategory] = useState<ShopCategory>('avatar');
  const [dropSection, setDropSection] = useState<ShopSection>('featured');
  const [dropRarity, setDropRarity] = useState<ShopRarity>('mythic');
  const [dropPrice, setDropPrice] = useState(0);
  const [dropImageUrl, setDropImageUrl] = useState(SHOP_KNIGHT_IMAGE);
  const [dropActive, setDropActive] = useState(true);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [savingDrop, setSavingDrop] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    const getMillis = (ts: unknown): number =>
      (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

    const unsubUsers = onSnapshot(
      query(
        collection(db, 'users'),
        where('loyaltyRank', 'in', ['Squire', 'Sentinel', 'Vanguard', 'Sovereign']),
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as UserProfile)
          .sort((a, b) => getMillis(b.updatedAt) - getMillis(a.updatedAt));
        setMembers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users'),
    );

    const shopQ = isHighestAdmin
      ? query(collection(db, 'shopItems'))
      : query(collection(db, 'shopItems'), where('active', '==', true));
    const unsubAllShop = onSnapshot(
      shopQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as ShopItem)
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
        setAllShopItems(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'shopItems'),
    );

    let unsubAdmins = () => {};
    let unsubReports = () => {};

    if (isHighestAdmin) {
      unsubAdmins = onSnapshot(
        collection(db, 'admins'),
        (snap) => {
          setAdminRecords(snap.docs.map((d) => d.data() as AdminRecord));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'admins'),
      );

      unsubReports = onSnapshot(
        query(
          collection(db, 'reports'),
          where('status', 'in', ['open', 'reviewing', 'resolved', 'dismissed']),
        ),
        (snap) => {
          setReportsError(null);
          const list = snap.docs
            .map((d) => d.data() as ContentReport)
            .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
          setReports(list);
        },
        (err) => {
          setReportsError(err instanceof Error ? err.message : 'Unable to stream reports.');
        },
      );
    }

    return () => {
      unsubUsers();
      unsubAllShop();
      unsubAdmins();
      unsubReports();
    };
  }, [isHighestAdmin]);

  const adminUidSet = useMemo(() => new Set(adminRecords.map((a) => a.uid)), [adminRecords]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => {
      const status = m.accountStatus || 'active';
      if (memberStatusFilter !== 'all' && status !== memberStatusFilter) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.handle.toLowerCase().includes(q) ||
        m.uid.toLowerCase().includes(q)
      );
    });
  }, [members, memberSearch, memberStatusFilter]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => (reportFilter === 'all' ? true : r.status === reportFilter));
  }, [reports, reportFilter]);

  const filteredPosts = useMemo(() => {
    const q = postSearch.trim().toLowerCase();
    return posts.filter((p) => {
      if (!q) return true;
      return (
        p.authorName.toLowerCase().includes(q) ||
        p.authorHandle.toLowerCase().includes(q) ||
        p.caption.toLowerCase().includes(q)
      );
    });
  }, [posts, postSearch]);

  const openReportCount = useMemo(
    () => reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length,
    [reports],
  );
  const warnedCount = useMemo(
    () => members.filter((m) => m.accountStatus === 'warned').length,
    [members],
  );
  const suspendedCount = useMemo(
    () => members.filter((m) => m.accountStatus === 'suspended').length,
    [members],
  );

  const showToast = (msg: string) => {
    setActionToast(msg);
    window.setTimeout(() => setActionToast(null), 3500);
  };

  const openMemberInspector = async (member: UserProfile) => {
    setEditingMember(member);
    setEditCredits(member.credits);
    setEditXp(member.loyaltyXp);
    setEditRank(member.loyaltyRank);
    setEditStatus(member.accountStatus || 'active');
    setEditNote(member.adminNote || '');
    setMemberPrivateInfo(null);

    try {
      const privSnap = await getDoc(doc(db, 'users', member.uid, 'private', 'info'));
      if (privSnap.exists()) {
        const data = privSnap.data() as { email?: string; ownedItemIds?: string[] };
        setMemberPrivateInfo({
          email: data.email,
          ownedCount: data.ownedItemIds?.length ?? 0,
        });
      } else {
        setMemberPrivateInfo({ email: 'No private record', ownedCount: 0 });
      }
    } catch {
      setMemberPrivateInfo({ email: 'Restricted', ownedCount: 0 });
    }
  };

  const handleSaveMemberEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember || savingMember) return;
    setSavingMember(true);
    try {
      await updateDoc(doc(db, 'users', editingMember.uid), {
        credits: Math.max(0, Math.min(1000000, Math.round(editCredits))),
        loyaltyXp: Math.max(0, Math.round(editXp)),
        loyaltyRank: editRank,
        accountStatus: editStatus,
        adminNote: editNote.trim().slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      showToast(`Updated ${editingMember.displayName} (${editStatus}).`);
      setEditingMember(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${editingMember.uid}`);
    } finally {
      setSavingMember(false);
    }
  };

  const handleToggleDelegatedAdmin = async (member: UserProfile) => {
    if (!isHighestAdmin) return;
    const isCurrentlyAdmin = adminUidSet.has(member.uid);
    try {
      if (isCurrentlyAdmin) {
        await deleteDoc(doc(db, 'admins', member.uid));
        showToast(`Revoked Admin privileges from ${member.displayName}.`);
      } else {
        await setDoc(doc(db, 'admins', member.uid), {
          uid: member.uid,
          email: (memberPrivateInfo?.email || '').slice(0, 256),
          displayName: member.displayName.slice(0, 64),
          grantedBy: currentUid,
          createdAt: serverTimestamp(),
        });
        showToast(`Granted Sovereign Admin role to ${member.displayName}.`);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `admins/${member.uid}`);
    }
  };

  const handleUpdateReportStatus = async (report: ContentReport, nextStatus: ReportStatus) => {
    const notes = reportNotes[report.id] ?? report.adminNotes ?? '';
    try {
      await updateDoc(doc(db, 'reports', report.id), {
        status: nextStatus,
        adminNotes: notes.slice(0, 500),
        resolvedBy: currentUid,
        updatedAt: serverTimestamp(),
      });
      showToast(`Report marked ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reports/${report.id}`);
    }
  };

  const handleModerateTargetUser = async (
    targetUid: string | undefined,
    targetName: string,
    status: AccountStatus,
    note: string,
  ) => {
    if (!targetUid || targetUid.startsWith('guest')) {
      showToast('Guest session has no persistent Firestore user record.');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        accountStatus: status,
        adminNote: note.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      showToast(`${targetName} status set to ${status.toUpperCase()}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const handleToggleShopItemActive = async (item: ShopItem) => {
    try {
      await updateDoc(doc(db, 'shopItems', item.id), {
        active: !item.active,
        updatedAt: serverTimestamp(),
      });
      showToast(`${item.name} ${item.active ? 'hidden from' : 'restored to'} Item Shop.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shopItems/${item.id}`);
    }
  };

  const openShopItemEditor = (item: ShopItem) => {
    setEditingShopItem(item);
    setDropName(item.name);
    setDropDesc(item.description);
    setDropCategory(item.category);
    setDropSection(item.section);
    setDropRarity(item.rarity);
    setDropPrice(item.price);
    setDropImageUrl(item.imageUrl || SHOP_KNIGHT_IMAGE);
    setDropActive(item.active);
    setDropError(null);
  };

  const handleSaveShopItemEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShopItem || savingDrop) return;
    if (!dropName.trim()) {
      setDropError('Drop title is required.');
      return;
    }
    setDropError(null);
    setSavingDrop(true);
    try {
      const patch: Partial<ShopItem> = {
        name: dropName.trim().slice(0, 80),
        description:
          dropDesc.trim().slice(0, 300) ||
          'Bespoke Sovereign Obsidian & Champagne Gold release.',
        category: dropCategory,
        section: dropSection,
        rarity: dropRarity,
        price: Math.max(0, Math.min(50000, Math.round(dropPrice))),
        imageUrl: dropImageUrl.trim().slice(0, 1024) || SHOP_KNIGHT_IMAGE,
        active: dropActive,
      };
      if (onUpdateShopItem) {
        await onUpdateShopItem(editingShopItem.id, patch);
      } else {
        await updateDoc(doc(db, 'shopItems', editingShopItem.id), {
          ...patch,
          updatedAt: serverTimestamp(),
        });
      }
      showToast(`Saved changes to "${patch.name}".`);
      setEditingShopItem(null);
    } catch (err) {
      setDropError(err instanceof Error ? err.message : 'Could not update drop.');
    } finally {
      setSavingDrop(false);
    }
  };

  const handleDeleteRigModel = async (model: RiggedModelConfig) => {
    try {
      await deleteDoc(doc(db, 'riggedModels', model.id));
      showToast(`Removed rigged model "${model.name}".`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `riggedModels/${model.id}`);
    }
  };

  const handleAdminUploadCustomGLB = async (file: File) => {
    if (!onSaveRigToLibrary || uploadingGlb) return;
    setUploadingGlb(true);
    try {
      const imported = await importModelFiles([file]);
      if (Number(imported.group.userData?.__normalizedHeight) !== 1.9) {
        normalizeModelToUnitHeight(imported.group, 1.9, true);
      }

      const useNative = Boolean(
        imported.hasValidNativeRig &&
          imported.existingBones.length > 0 &&
          imported.preservedSkinnedScene,
      );
      const bones: BoneNode[] = useNative
        ? imported.existingBones
        : buildIntelligentHumanoidRig(imported.group, 'full-33');

      if (!useNative) {
        imported.group.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            computeHeatMapWeightsForMesh(c as THREE.Mesh, bones, 0.36, 2.2);
          }
        });
      }

      const bound =
        useNative && imported.preservedSkinnedScene
          ? extractPreservedBoundRig(imported.preservedSkinnedScene)
          : bindSkeletonToModelGroup(imported.group, bones);
      const clip = compileClipFromPreset(
        bound.bonesByName,
        bound.restPositions,
        bound.restRotations,
        'idle',
        2.0,
        20,
      );
      const res = await exportGroupWithAnimations(bound.skinnedGroup, [clip], true);
      if (!(res instanceof ArrayBuffer)) {
        throw new Error('Failed to encode custom GLB binary.');
      }

      const cleanName = file.name.replace(/\.(glb|gltf)$/i, '').slice(0, 72) || 'Custom GLB';
      const modelId = `rig_${Date.now().toString(36)}`;
      await onSaveRigToLibrary({
        modelId,
        name: cleanName,
        sourceType: 'glb-custom',
        glbBuffer: res,
        bones,
        weightConfig: { radius: 0.36, falloff: 2.2, symmetry: true },
        defaultAnimation: 'idle',
      });
      showToast(`Uploaded & auto-rigged "${cleanName}" (${bones.length} bones) to Character Library!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Custom GLB upload failed.');
    } finally {
      setUploadingGlb(false);
    }
  };

  return (
    <section className="max-w-[1360px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#D4AF37]/25">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#D4AF37] uppercase tracking-wider">
            <Crown className="w-4 h-4" />
            <span>
              {isHighestAdmin ? 'Highest Sovereign Command' : 'Sovereign Admin Console'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-white mt-1">
            Platform Governance & Moderation
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Manage signed-up accounts, review message & content reports, moderate Media Pulse, and oversee Item Shop drops & custom rigs.
          </p>
        </div>

        {actionToast && (
          <div className="px-4 py-2 rounded-lg bg-[#161209] border border-[#D4AF37]/50 text-xs font-medium text-[#FDE68A] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
            <span>{actionToast}</span>
          </div>
        )}
      </div>

      {/* Live KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#0B101D] border border-white/10">
          <div className="text-xs text-slate-400">Signed-Up Members</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
            {members.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
            {warnedCount} warned · {suspendedCount} suspended
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0B101D] border border-white/10">
          <div className="text-xs text-slate-400">Open Reports</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#FDE68A] mt-1">
            {openReportCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
            {reports.length} total filed
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0B101D] border border-white/10">
          <div className="text-xs text-slate-400">Published Posts</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
            {posts.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Reels · Feed · 24h Snaps
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0B101D] border border-white/10">
          <div className="text-xs text-slate-400">Vault Drops & Rigs</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#60A5FA] mt-1">
            {allShopItems.length} / {riggedModels.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Shop Items · Custom Skeletons
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        {(
          [
            { id: 'members', label: `Signed-Up Members (${members.length})`, Icon: Users },
            { id: 'reports', label: `Message & Reports (${openReportCount})`, Icon: Flag },
            { id: 'posts', label: `Posts & Feed (${posts.length})`, Icon: MessageSquareWarning },
            { id: 'vault', label: `Shop & Rigs (${allShopItems.length})`, Icon: ShoppingBag },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
              tab === id
                ? 'bg-[#D4AF37] text-slate-950'
                : 'bg-[#0F1627] text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: SIGNED-UP MEMBERS */}
      {tab === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search display name, @handle, or UID..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0B101D] border border-white/12 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
              />
            </div>

            <div className="flex items-center gap-1.5">
              {(['all', 'active', 'warned', 'suspended'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setMemberStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                    memberStatusFilter === st
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#0F1627] text-slate-300 border border-white/10'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#0B101D] border border-white/10 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="py-3 px-4 font-semibold">Member</th>
                  <th className="py-3 px-4 font-semibold">Loyalty Rank</th>
                  <th className="py-3 px-4 font-semibold">Credits · XP</th>
                  <th className="py-3 px-4 font-semibold">Platform</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {filteredMembers.map((m) => {
                  const status = m.accountStatus || 'active';
                  const isDelegated = adminUidSet.has(m.uid);
                  return (
                    <tr key={m.uid} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">
                          {m.displayName}{' '}
                          {isDelegated && (
                            <span className="text-[#D4AF37] font-normal">· Admin</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          @{m.handle} · {m.uid.slice(0, 10)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-200">{m.loyaltyRank}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-200">
                        {m.credits.toLocaleString()} cr · {m.loyaltyXp} XP
                      </td>
                      <td className="py-3 px-4 uppercase text-slate-300">{m.platform}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold capitalize ${
                            status === 'suspended'
                              ? 'text-red-400'
                              : status === 'warned'
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => void openMemberInspector(m)}
                          className="px-3 py-1.5 rounded-md bg-[#162038] hover:bg-[#223154] text-white font-semibold transition-colors"
                        >
                          Inspect & Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MESSAGE & CONTENT REPORTS */}
      {tab === 'reports' && (
        <div className="space-y-4">
          {!isHighestAdmin ? (
            <div className="p-6 rounded-2xl bg-[#0B101D] border border-amber-500/30 text-sm text-amber-200">
              Global report queue listing is restricted to Highest Admins (likedf88@gmail.com and cmoney20262626@gmail.com).
            </div>
          ) : reportsError ? (
            <div className="p-6 rounded-2xl bg-[#0B101D] border border-red-500/30 text-sm text-red-300">
              {reportsError}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'open', 'reviewing', 'resolved', 'dismissed'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setReportFilter(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                      reportFilter === st
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#0F1627] text-slate-300 border border-white/10'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {filteredReports.length === 0 ? (
                <div className="p-10 rounded-2xl bg-[#0B101D] border border-white/10 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-[#D4AF37] mx-auto" />
                  <div className="text-base font-bold text-white">No Reports in Queue</div>
                  <p className="text-xs text-slate-400">
                    All Lounge chat reports, Media Pulse post reports, and user flags appear here live.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReports.map((r) => (
                    <article
                      key={r.id}
                      className="p-4 rounded-2xl bg-[#0B101D] border border-white/12 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-[#FDE68A] font-semibold uppercase tracking-wider">
                            {r.targetType.replace(/-/g, ' ')} · Reason: {r.reason} · Status: {r.status}
                          </div>
                          <div className="text-sm font-semibold text-white mt-1">
                            Target: {r.targetAuthorName}
                            <span className="text-xs font-normal text-slate-400 ml-2">
                              Reported by {r.reporterName}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleUpdateReportStatus(r, 'reviewing')}
                            className="px-2.5 py-1 rounded bg-[#18223A] hover:bg-[#223154] text-xs text-slate-200"
                          >
                            Reviewing
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdateReportStatus(r, 'resolved')}
                            className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs text-white font-semibold"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdateReportStatus(r, 'dismissed')}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteDoc(doc(db, 'reports', r.id));
                              showToast('Deleted report entry.');
                            }}
                            title="Delete report"
                            className="p-1.5 rounded bg-[#151B2C] hover:bg-red-950/70 text-slate-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {r.targetExcerpt && (
                        <blockquote className="p-3 rounded-xl bg-[#111829] border border-white/10 text-xs text-slate-200">
                          “{r.targetExcerpt}”
                        </blockquote>
                      )}

                      {r.details && (
                        <p className="text-xs text-slate-400">Reporter details: {r.details}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/8">
                        <input
                          type="text"
                          value={reportNotes[r.id] ?? r.adminNotes ?? ''}
                          onChange={(e) =>
                            setReportNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          placeholder="Add moderator action note..."
                          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                        />

                        {r.targetAuthorId && !r.targetAuthorId.startsWith('guest') && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void handleModerateTargetUser(
                                  r.targetAuthorId,
                                  r.targetAuthorName,
                                  'warned',
                                  `Warned regarding ${r.reason} report.`,
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-amber-900/60 hover:bg-amber-800/80 border border-amber-500/40 text-xs font-semibold text-amber-200"
                            >
                              Warn User
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleModerateTargetUser(
                                  r.targetAuthorId,
                                  r.targetAuthorName,
                                  'suspended',
                                  `Suspended for ${r.reason} violation.`,
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800/80 border border-red-500/40 text-xs font-semibold text-red-200 flex items-center gap-1"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Suspend User</span>
                            </button>
                          </>
                        )}

                        {r.targetType === 'post' && r.targetId && (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeletePost(r.targetId);
                              await handleUpdateReportStatus(r, 'resolved');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-semibold text-white"
                          >
                            Delete Offending Post
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: POSTS & SOCIAL FEED */}
      {tab === 'posts' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              placeholder="Filter posts by author or caption..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0B101D] border border-white/12 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPosts.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-2xl bg-[#0B101D] border border-white/10 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">
                      {p.authorName}{' '}
                      <span className="text-slate-400 font-normal">@{p.authorHandle}</span>
                    </span>
                    <span className="uppercase text-[11px] text-[#60A5FA]">{p.kind}</span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-3">{p.caption}</p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/8 text-xs">
                  <span className="text-slate-400 font-mono tabular-nums">
                    {p.likesCount} likes · {p.commentsCount} comments
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeletePost(p.id);
                      showToast(`Deleted post by ${p.authorName}.`);
                    }}
                    className="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-800/80 text-red-200 text-xs font-semibold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: SHOP DROPS & CUSTOM RIGS */}
      {tab === 'vault' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-[#0B101D] border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#D4AF37]" />
                <span>Item Shop Drops ({allShopItems.length})</span>
              </h2>
              <button
                type="button"
                onClick={onNavigateToShop}
                className="px-3 py-1.5 rounded-lg bg-[#D4AF37] text-slate-950 text-xs font-bold"
              >
                Open Item Shop
              </button>
            </div>

            {allShopItems.length === 0 ? (
              <p className="text-xs text-slate-400">
                No drops posted yet. Open Item Shop or Rigging Studio to publish your first drop.
              </p>
            ) : (
              <div className="space-y-2.5">
                {allShopItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-[#111829] border border-white/10 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={item.imageUrl || SHOP_KNIGHT_IMAGE}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          {item.name} ·{' '}
                          <span className="text-[#FDE68A] font-mono tabular-nums">
                            {item.price.toLocaleString()} cr
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 capitalize truncate">
                          {item.rarity} · {item.category} · {item.active ? 'Live' : 'Hidden'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openShopItemEditor(item)}
                        title="Edit drop details & thumbnail"
                        className="px-2.5 py-1 rounded bg-[#1D2844] hover:bg-[#27365B] text-xs text-white flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleShopItemActive(item)}
                        className="px-2.5 py-1 rounded bg-[#18223A] text-xs text-slate-200 flex items-center gap-1"
                      >
                        {item.active ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        <span>{item.active ? 'Hide' : 'Show'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteShopItem(item.id);
                          showToast(`Deleted "${item.name}" from Shop.`);
                        }}
                        className="p-1.5 rounded bg-red-950/60 hover:bg-red-800/80 text-red-200"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-[#0B101D] border border-white/10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <BoneIcon className="w-4 h-4 text-[#60A5FA]" />
                <span>Rigged Skeleton Models ({riggedModels.length})</span>
              </h2>
              <div className="flex items-center gap-2">
                {onSaveRigToLibrary && (
                  <>
                    <input
                      ref={glbInputRef}
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleAdminUploadCustomGLB(file);
                        e.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploadingGlb}
                      onClick={() => glbInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#e5c24c] text-slate-950 text-xs font-semibold flex items-center gap-1 disabled:opacity-60"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingGlb ? 'Uploading GLB...' : 'Upload Custom GLB'}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onNavigateToStudio}
                  className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold flex items-center gap-1"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Open Rigging Studio</span>
                </button>
              </div>
            </div>

            {riggedModels.length === 0 ? (
              <p className="text-xs text-slate-400">
                No custom rigged models saved in Firestore yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {riggedModels.map((rm) => (
                  <div
                    key={rm.id}
                    className="p-3 rounded-xl bg-[#111829] border border-white/10 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{rm.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {rm.bones.length} bones · {rm.sourceType} · {rm.defaultAnimation}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRigModel(rm)}
                      className="p-1.5 rounded bg-red-950/60 hover:bg-red-800/80 text-red-200"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Member Edit / Moderation Modal */}
      {editingMember && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[#0B101D] border border-[#D4AF37]/35 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold font-display text-white">
                  {editingMember.displayName}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  @{editingMember.handle} · {memberPrivateInfo?.email || 'Loading email...'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            {memberPrivateInfo && (
              <div className="text-xs text-slate-300 bg-[#111829] px-3 py-2 rounded-lg border border-white/10 font-mono tabular-nums">
                Owned Vault Items: {memberPrivateInfo.ownedCount} · UID: {editingMember.uid}
              </div>
            )}

            <form onSubmit={handleSaveMemberEdit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Credits</label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={editCredits}
                    onChange={(e) => setEditCredits(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Loyalty XP</label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={editXp}
                    onChange={(e) => setEditXp(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Loyalty Rank</label>
                  <select
                    value={editRank}
                    onChange={(e) => setEditRank(e.target.value as LoyaltyRank)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  >
                    <option value="Squire">Squire</option>
                    <option value="Sentinel">Sentinel</option>
                    <option value="Vanguard">Vanguard</option>
                    <option value="Sovereign">Sovereign</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Account Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as AccountStatus)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  >
                    <option value="active">Active</option>
                    <option value="warned">Warned</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Moderator Note</label>
                <input
                  type="text"
                  maxLength={300}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Optional reason or internal note..."
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                />
              </div>

              {isHighestAdmin && editingMember.uid !== currentUid && (
                <button
                  type="button"
                  onClick={() => void handleToggleDelegatedAdmin(editingMember)}
                  className={`w-full py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                    adminUidSet.has(editingMember.uid)
                      ? 'bg-red-950/60 border-red-500/40 text-red-200 hover:bg-red-900/70'
                      : 'bg-[#17130B] border-[#D4AF37]/50 text-[#FDE68A] hover:bg-[#231D10]'
                  }`}
                >
                  {adminUidSet.has(editingMember.uid)
                    ? 'Revoke Delegated Admin Role'
                    : 'Grant Delegated Admin Role'}
                </button>
              )}

              <button
                type="submit"
                disabled={savingMember}
                className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold transition-colors"
              >
                {savingMember ? 'Saving...' : 'Save Member Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Edit Shop Drop Modal */}
      {editingShopItem && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Shop Drop"
        >
          <div className="w-full max-w-lg bg-[#0B101D] border border-[#D4AF37]/40 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold font-display text-white">Edit Vault Drop</h3>
                <p className="text-xs text-slate-400">
                  Update title, description, pricing, visibility, or thumbnail.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingShopItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveShopItemEdit} className="space-y-3.5">
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Drop Title</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={dropName}
                  onChange={(e) => setDropName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] text-slate-300">Description</label>
                  <span className="text-[10px] font-mono text-slate-500">
                    {dropDesc.length}/300
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={300}
                  value={dropDesc}
                  onChange={(e) => setDropDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Category</label>
                  <select
                    value={dropCategory}
                    onChange={(e) => setDropCategory(e.target.value as ShopCategory)}
                    className="w-full px-2 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  >
                    <option value="avatar">Avatar</option>
                    <option value="bundle">Bundle</option>
                    <option value="emote">Emote</option>
                    <option value="aura">Aura</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Section</label>
                  <select
                    value={dropSection}
                    onChange={(e) => setDropSection(e.target.value as ShopSection)}
                    className="w-full px-2 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  >
                    <option value="featured">Featured</option>
                    <option value="daily">Daily</option>
                    <option value="royal-vault">Royal Vault</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Rarity</label>
                  <select
                    value={dropRarity}
                    onChange={(e) => setDropRarity(e.target.value as ShopRarity)}
                    className="w-full px-2 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  >
                    <option value="mythic">Mythic</option>
                    <option value="legendary">Legendary</option>
                    <option value="epic">Epic</option>
                    <option value="rare">Rare</option>
                    <option value="uncommon">Uncommon</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Price (Cr)</label>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    step={50}
                    value={dropPrice}
                    onChange={(e) => setDropPrice(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] text-slate-300">Thumbnail Image</label>
                  <label className="px-2.5 py-1 rounded-md bg-[#162340] hover:bg-[#1E3159] border border-[#3B82F6]/40 text-[11px] font-semibold text-[#93C5FD] cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    <span>{uploadingThumb ? 'Uploading...' : 'Upload Thumbnail'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      disabled={uploadingThumb}
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setDropError(null);
                        setUploadingThumb(true);
                        try {
                          const endpoint = await uploadImageFile(file);
                          setDropImageUrl(endpoint);
                        } catch (err) {
                          setDropError(
                            err instanceof Error ? err.message : 'Thumbnail upload failed.',
                          );
                        } finally {
                          setUploadingThumb(false);
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <img
                    src={dropImageUrl || SHOP_KNIGHT_IMAGE}
                    alt={dropName}
                    className="w-16 h-16 rounded-lg object-cover border border-white/10 bg-[#111829] shrink-0"
                  />
                  <input
                    type="text"
                    maxLength={1024}
                    value={dropImageUrl}
                    onChange={(e) => setDropImageUrl(e.target.value)}
                    placeholder="Thumbnail URL or upload above..."
                    className="flex-1 px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dropActive}
                  onChange={(e) => setDropActive(e.target.checked)}
                  className="rounded border-white/20 bg-[#12192B] text-[#D4AF37]"
                />
                <span>Live in Item Shop storefront</span>
              </label>

              {dropError && (
                <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200">
                  {dropError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingShopItem(null)}
                  className="px-4 py-2 rounded-lg bg-[#141C2F] text-xs text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDrop}
                  className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-slate-950 text-xs font-bold"
                >
                  {savingDrop ? 'Saving...' : 'Save Drop Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
