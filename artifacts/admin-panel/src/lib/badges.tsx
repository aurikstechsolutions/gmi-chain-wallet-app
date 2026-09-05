import { BadgeCheck, Store, Trophy } from "lucide-react";

// ── Volume tier ───────────────────────────────────────────────────────────────

export type VolumeTier = "bronze" | "silver" | "gold" | "platinum" | null;

export function getVolumeTier(completedTrades: number): VolumeTier {
  if (completedTrades >= 500) return "platinum";
  if (completedTrades >= 100) return "gold";
  if (completedTrades >= 50) return "silver";
  if (completedTrades >= 10) return "bronze";
  return null;
}

const TIER_META: Record<NonNullable<VolumeTier>, { label: string; className: string }> = {
  bronze:   { label: "🥉 Bronze",   className: "bg-amber-700/20 text-amber-500 border-amber-600/30" },
  silver:   { label: "🥈 Silver",   className: "bg-slate-400/15 text-slate-300 border-slate-400/30" },
  gold:     { label: "🥇 Gold",     className: "bg-yellow-400/15 text-yellow-300 border-yellow-400/30" },
  platinum: { label: "💎 Platinum", className: "bg-cyan-400/15 text-cyan-300 border-cyan-400/30" },
};

// ── Badge components ──────────────────────────────────────────────────────────

export function KycBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
      <BadgeCheck size={11} />
      KYC Verified
    </span>
  );
}

export function MerchantBadge({ isVerifiedMerchant }: { isVerifiedMerchant: boolean }) {
  return isVerifiedMerchant ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-primary/15 text-primary border-primary/30">
      <Store size={11} />
      Trusted Merchant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-400 border-amber-500/25">
      <Store size={11} />
      Merchant
    </span>
  );
}

export function VolumeBadge({ completedTrades }: { completedTrades: number }) {
  const tier = getVolumeTier(completedTrades);
  if (!tier) return null;
  const meta = TIER_META[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export function BadgeRow({ kycVerified, isMerchant, completedTrades }: {
  kycVerified: boolean;
  isMerchant: boolean;
  completedTrades: number;
}) {
  const hasBadges = kycVerified || isMerchant || getVolumeTier(completedTrades);
  if (!hasBadges) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1">
      {kycVerified && <KycBadge />}
      {isMerchant && <MerchantBadge isVerifiedMerchant={kycVerified && isMerchant} />}
      <VolumeBadge completedTrades={completedTrades} />
    </div>
  );
}
