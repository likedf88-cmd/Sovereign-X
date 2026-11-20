import React, { useState } from 'react';
import { X, Crown, LogOut, Gift, Monitor, Smartphone, Gamepad2, MailCheck, ShieldCheck } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { PlatformMode, RiggedModelConfig, ShopItem, UserProfile } from '../types';
import { DEFAULT_AVATAR_PRESETS } from '../data/catalog';
import { resendVerificationEmail, signOutUser } from '../firebase';

interface AccountDrawerProps {
  open: boolean;
  onClose: () => void;
  firebaseUser: User | null;
  profile: UserProfile;
  ownedItemIds: string[];
  shopItems: ShopItem[];
  riggedModels?: RiggedModelConfig[];
  onSwitchPlatform: (p: PlatformMode) => void;
  onEquipAvatar: (avatarId: string) => void;
  onClaimDaily: () => Promise<boolean>;
  dailyClaimedToday: boolean;
  isAdmin: boolean;
  onOpenAdmin?: () => void;
}

export const AccountDrawer: React.FC<AccountDrawerProps> = ({
  open,
  onClose,
  firebaseUser,
  profile,
  ownedItemIds,
  shopItems,
  riggedModels = [],
  onSwitchPlatform,
  onEquipAvatar,
  onClaimDaily,
  dailyClaimedToday,
  isAdmin,
  onOpenAdmin,
}) => {
  const [claiming, setClaiming] = useState(false);
  const [verifSent, setVerifSent] = useState(false);

  if (!open) return null;

  const ownedShopAvatars = shopItems
    .filter(
      (item) =>
        (item.category === 'avatar' || item.category === 'bundle') &&
        (ownedItemIds.includes(item.id) || isAdmin),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      avatarKey: item.riggedModelId || item.presetKey || item.id,
      badge: item.riggedModelId ? 'Custom Rig' : 'Vault Drop',
    }));

  const customRigEntries = riggedModels.map((rm) => ({
    id: `rig_${rm.id}`,
    name: rm.name,
    avatarKey: rm.id,
    badge: rm.sourceType === 'glb-custom' ? 'Custom GLB' : 'Custom Rig',
  }));

  const starterAvatars = DEFAULT_AVATAR_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    avatarKey: p.id,
    badge: 'Chassis',
  }));

  const lockerMap = new Map<
    string,
    { id: string; name: string; avatarKey: string; badge: string }
  >();
  [...ownedShopAvatars, ...customRigEntries, ...starterAvatars].forEach((entry) => {
    if (!lockerMap.has(entry.avatarKey)) {
      lockerMap.set(entry.avatarKey, entry);
    }
  });
  const lockerEntries = Array.from(lockerMap.values());

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await onClaimDaily();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-label="Member Profile & Loyalty"
    >
      <div className="w-full max-w-md bg-[#090D16] border-l border-[#D4AF37]/25 h-full overflow-y-auto p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-white">{profile.displayName}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              @{profile.handle} · {profile.loyaltyRank} Rank
              {isAdmin ? <span className="text-[#D4AF37] font-semibold"> · Sovereign Highest Admin</span> : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account drawer"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {firebaseUser && !firebaseUser.emailVerified && (
          <div className="p-4 rounded-xl bg-amber-950/50 border border-amber-500/30 space-y-2">
            <div className="flex items-center gap-2 text-amber-200 text-xs font-semibold">
              <MailCheck className="w-4 h-4" />
              <span>Verify your email to post reels & comments</span>
            </div>
            <button
              type="button"
              onClick={async () => {
                await resendVerificationEmail(firebaseUser);
                setVerifSent(true);
              }}
              className="px-3 py-1.5 rounded-md bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors"
            >
              {verifSent ? 'Verification Email Sent' : 'Resend Verification Link'}
            </button>
          </div>
        )}

        <div className="p-4 rounded-xl bg-[#111829] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#D4AF37] text-sm font-semibold">
              <Crown className="w-4 h-4" />
              <span>Loyalty Crest · {profile.loyaltyRank}</span>
            </div>
            <span className="text-xs font-mono text-slate-300 tabular-nums">
              {profile.loyaltyXp} XP
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#2563EB] to-[#D4AF37]"
              style={{ width: `${Math.min(100, ((profile.loyaltyXp % 1000) / 1000) * 100 || 18)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300 pt-1">
            <span className="tabular-nums">{profile.credits.toLocaleString()} Credits</span>
            <span className="tabular-nums">{profile.streakDays} Day Streak</span>
          </div>
          <button
            type="button"
            disabled={dailyClaimedToday || claiming}
            onClick={handleClaim}
            className="w-full py-2.5 px-4 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:bg-slate-800 disabled:text-slate-400 text-slate-950 text-xs font-bold transition-colors flex items-center justify-center gap-2"
          >
            <Gift className="w-4 h-4" />
            <span>
              {dailyClaimedToday
                ? 'Daily Loyalty Reward Claimed'
                : claiming
                  ? 'Claiming...'
                  : 'Claim Daily Loyalty (+250 Credits · +100 XP)'}
            </span>
          </button>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-sm font-semibold text-white">Active Input Platform</h3>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'pc', label: 'PC', Icon: Monitor },
                { id: 'mobile', label: 'Mobile', Icon: Smartphone },
                { id: 'console', label: 'Console', Icon: Gamepad2 },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSwitchPlatform(id)}
                className={`py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  profile.platform === id
                    ? 'bg-[#2563EB] border-[#3B82F6] text-white'
                    : 'bg-[#121827] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Avatar Locker</h3>
            <span className="text-[11px] font-mono text-slate-400">
              {lockerEntries.length} rigs
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
            {lockerEntries.map((item) => {
              const isEquipped = profile.equippedAvatarId === item.avatarKey;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onEquipAvatar(item.avatarKey)}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    isEquipped
                      ? 'bg-[#17130B] border-[#D4AF37]'
                      : 'bg-[#111829] border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-semibold text-white truncate">{item.name}</span>
                    {item.badge === 'Custom GLB' && (
                      <span className="px-1.5 py-0.5 rounded bg-[#2563EB]/25 text-[#93C5FD] text-[9px] font-semibold shrink-0">
                        GLB
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] mt-1 ${isEquipped ? 'text-[#FDE68A]' : 'text-slate-400'}`}>
                    {isEquipped ? 'Equipped' : `${item.badge} · Tap to equip`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {isAdmin && onOpenAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdmin();
              onClose();
            }}
            className="py-2.5 px-4 rounded-lg bg-[#17130B] hover:bg-[#231C0F] border border-[#D4AF37]/50 text-[#FDE68A] text-xs font-bold transition-colors flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
            <span>Open Admin Command Center</span>
          </button>
        )}

        {firebaseUser && (
          <button
            type="button"
            onClick={async () => {
              await signOutUser();
              onClose();
            }}
            className="mt-auto py-2.5 px-4 rounded-lg border border-white/12 bg-[#121827] hover:bg-red-950/50 hover:border-red-500/40 text-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        )}
      </div>
    </div>
  );
};
