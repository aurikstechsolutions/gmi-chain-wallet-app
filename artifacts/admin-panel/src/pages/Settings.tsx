import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, put, type VolumeTiers, type PlatformSettings, type TradeSettings, type KycSettings } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon, Globe, ArrowRightLeft, Trophy, ShieldCheck,
  Save, RotateCcw, AlertTriangle, CheckCircle2, Info, Zap, Clock,
  TrendingUp, Users, DollarSign, Scale, BadgeCheck, UserX, Medal,
  KeyRound, Eye, EyeOff, Trash2, Plus,
} from "lucide-react";

function Toggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}

const NAV = [
  { id: "platform", label: "Platform",      icon: Globe,           desc: "General platform configuration" },
  { id: "trading",  label: "Trading Rules", icon: ArrowRightLeft,  desc: "Order limits & dispute settings" },
  { id: "tiers",    label: "Volume Tiers",  icon: Trophy,          desc: "Trader badge thresholds" },
  { id: "kyc",      label: "KYC & Trust",   icon: ShieldCheck,     desc: "Verification requirements" },
  { id: "apikeys",  label: "API Keys",       icon: KeyRound,        desc: "Third-party service credentials" },
] as const;

type SectionId = (typeof NAV)[number]["id"];

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionCard({
  title, icon: Icon, description, dirty, saving, error,
  onSave, onReset, children,
}: {
  title: string; icon: React.ElementType; description: string;
  dirty: boolean; saving: boolean; error?: string | null;
  onSave: () => void; onReset: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-card-border bg-card/60">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 mt-0.5 shrink-0">
            <Icon size={15} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {dirty && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              Unsaved
            </span>
          )}
          {dirty && (
            <button onClick={onReset} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors">
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <button
            onClick={onSave}
            disabled={!dirty || saving || !!error}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={11} />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
      {/* Rows */}
      <div className="divide-y divide-card-border">{children}</div>
    </div>
  );
}

function SettingRow({
  label, description, children, danger, icon: Icon,
}: {
  label: string; description?: string; children: React.ReactNode;
  danger?: boolean; icon?: React.ElementType;
}) {
  return (
    <div className={`flex items-center gap-6 px-6 py-4 ${danger ? "bg-red-500/5" : "hover:bg-muted/20"} transition-colors`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {Icon && <Icon size={14} className={`mt-0.5 shrink-0 ${danger ? "text-red-400" : "text-muted-foreground"}`} />}
        <div className="min-w-0">
          <div className={`text-sm font-medium ${danger ? "text-red-400" : "text-foreground"}`}>{label}</div>
          {description && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, min, max, unit, width = "w-28" }: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; unit?: string; width?: string;
}) {
  return (
    <div className="relative flex items-center">
      <input
        type="number" min={min} max={max} value={value}
        onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange(v); }}
        className={`${width} bg-background border border-border rounded-lg px-3 py-2 text-sm font-medium text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${unit ? "pr-10" : ""}`}
      />
      {unit && <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none">{unit}</span>}
    </div>
  );
}

// ── Platform Section ──────────────────────────────────────────────────────────

const DEFAULT_PLATFORM: PlatformSettings = { platformName: "MChain P2P", maintenanceMode: false, tradingEnabled: true };

function PlatformSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PlatformSettings>({ queryKey: ["settings", "platform"], queryFn: () => get<PlatformSettings>("/settings/platform") });
  const [form, setForm] = useState<PlatformSettings>(DEFAULT_PLATFORM);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setForm(data); setDirty(false); } }, [data]);
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const mut = useMutation({
    mutationFn: (v: PlatformSettings) => put<PlatformSettings>("/settings/platform", v),
    onSuccess: saved => { qc.setQueryData(["settings", "platform"], saved); setDirty(false); toast({ title: "Platform settings saved" }); },
    onError: e => toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });
  if (isLoading) return <SectionSkeleton />;
  return (
    <SectionCard title="Platform" icon={Globe} description="General platform identity and availability controls"
      dirty={dirty} saving={mut.isPending} onSave={() => mut.mutate(form)} onReset={() => { setForm(data ?? DEFAULT_PLATFORM); setDirty(false); }}>
      <SettingRow label="Platform Name" description="Displayed in the app and communication templates" icon={Globe}>
        <input
          value={form.platformName} onChange={e => set("platformName", e.target.value)}
          maxLength={80}
          className="w-48 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="MChain P2P"
        />
      </SettingRow>
      <SettingRow label="Trading Enabled" description="Allow buyers and sellers to place new orders on the platform" icon={Zap}>
        <Toggle checked={form.tradingEnabled} onCheckedChange={v => set("tradingEnabled", v)} />
      </SettingRow>
      <SettingRow label="Maintenance Mode" description="Immediately suspends all trading activity and shows a maintenance notice to users" icon={AlertTriangle} danger={form.maintenanceMode}>
        <div className="flex items-center gap-3">
          {form.maintenanceMode && (
            <Badge variant="destructive" className="text-xs">ACTIVE</Badge>
          )}
          <Toggle checked={form.maintenanceMode} onCheckedChange={v => set("maintenanceMode", v)} />
        </div>
      </SettingRow>
    </SectionCard>
  );
}

// ── Trading Rules Section ─────────────────────────────────────────────────────

const DEFAULT_TRADE: TradeSettings = { maxOpenOrdersPerUser: 5, disputePeriodHours: 24, minTradeAmountUsd: 1, maxTradeAmountUsd: 10000 };

function TradingSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<TradeSettings>({ queryKey: ["settings", "trade"], queryFn: () => get<TradeSettings>("/settings/trade") });
  const [form, setForm] = useState<TradeSettings>(DEFAULT_TRADE);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setForm(data); setDirty(false); } }, [data]);
  const set = <K extends keyof TradeSettings>(k: K, v: TradeSettings[K]) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const rangeError = form.minTradeAmountUsd >= form.maxTradeAmountUsd ? "Min must be less than max trade amount" : null;
  const mut = useMutation({
    mutationFn: (v: TradeSettings) => put<TradeSettings>("/settings/trade", v),
    onSuccess: saved => { qc.setQueryData(["settings", "trade"], saved); setDirty(false); toast({ title: "Trading settings saved" }); },
    onError: e => toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });
  if (isLoading) return <SectionSkeleton />;
  return (
    <SectionCard title="Trading Rules" icon={ArrowRightLeft} description="Limits, windows, and enforcement rules for P2P orders"
      dirty={dirty} saving={mut.isPending} error={rangeError} onSave={() => mut.mutate(form)} onReset={() => { setForm(data ?? DEFAULT_TRADE); setDirty(false); }}>
      <SettingRow label="Max Open Orders Per User" description="Maximum number of simultaneously active orders a single user can hold" icon={Users}>
        <NumInput value={form.maxOpenOrdersPerUser} onChange={v => set("maxOpenOrdersPerUser", v)} min={1} max={50} unit="orders" width="w-32" />
      </SettingRow>
      <SettingRow label="Dispute Resolution Period" description="Time allotted to admins to resolve a dispute before it escalates" icon={Scale}>
        <NumInput value={form.disputePeriodHours} onChange={v => set("disputePeriodHours", v)} min={1} max={168} unit="hours" width="w-28" />
      </SettingRow>
      <SettingRow label="Minimum Trade Amount" description="Smallest permitted order size in USD equivalent" icon={DollarSign}>
        <NumInput value={form.minTradeAmountUsd} onChange={v => set("minTradeAmountUsd", v)} min={1} unit="USD" width="w-28" />
      </SettingRow>
      <SettingRow label="Maximum Trade Amount" description="Largest permitted order size in USD equivalent" icon={TrendingUp}>
        <NumInput value={form.maxTradeAmountUsd} onChange={v => set("maxTradeAmountUsd", v)} min={100} unit="USD" width="w-32" />
      </SettingRow>
      {/* Live preview */}
      <div className="mx-6 my-4 grid grid-cols-2 gap-3">
        {[
          { label: "Trade range", value: `$${form.minTradeAmountUsd.toLocaleString()} – $${form.maxTradeAmountUsd.toLocaleString()}` },
          { label: "Max concurrent", value: `${form.maxOpenOrdersPerUser} orders/user` },
          { label: "Dispute window", value: `${form.disputePeriodHours}h (${(form.disputePeriodHours / 24).toFixed(1)} days)` },
          { label: "Status", value: "Active", badge: true },
        ].map(({ label, value, badge }) => (
          <div key={label} className="flex items-center justify-between bg-background rounded-lg px-4 py-3 border border-border">
            <span className="text-xs text-muted-foreground">{label}</span>
            {badge
              ? <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/40">{value}</Badge>
              : <span className="text-xs font-semibold text-foreground">{value}</span>}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Volume Tiers Section ──────────────────────────────────────────────────────

const TIER_META = [
  { key: "bronze"   as const, emoji: "🥉", label: "Bronze",   color: "text-amber-500",  bar: "bg-amber-500/60",  glow: "from-amber-500/20" },
  { key: "silver"   as const, emoji: "🥈", label: "Silver",   color: "text-slate-300",  bar: "bg-slate-300/60",  glow: "from-slate-300/20" },
  { key: "gold"     as const, emoji: "🥇", label: "Gold",     color: "text-yellow-300", bar: "bg-yellow-300/60", glow: "from-yellow-300/20" },
  { key: "platinum" as const, emoji: "💎", label: "Platinum", color: "text-cyan-300",   bar: "bg-cyan-300/60",   glow: "from-cyan-300/20" },
];
const DEFAULT_TIERS: VolumeTiers = { bronze: 10, silver: 50, gold: 100, platinum: 500 };

function TiersSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<VolumeTiers>({ queryKey: ["settings", "volume-tiers"], queryFn: () => get<VolumeTiers>("/settings/volume-tiers") });
  const [tiers, setTiers] = useState<VolumeTiers>(DEFAULT_TIERS);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setTiers(data); setDirty(false); } }, [data]);
  const setTier = (k: keyof VolumeTiers, raw: string) => {
    const v = parseInt(raw, 10);
    if (!isNaN(v)) { setTiers(p => ({ ...p, [k]: v })); setDirty(true); }
  };
  const validationError = (() => {
    if (tiers.bronze < 1) return "Bronze must be ≥ 1";
    if (tiers.silver <= tiers.bronze) return "Silver must be > Bronze";
    if (tiers.gold <= tiers.silver) return "Gold must be > Silver";
    if (tiers.platinum <= tiers.gold) return "Platinum must be > Gold";
    return null;
  })();
  const mut = useMutation({
    mutationFn: (v: VolumeTiers) => put<VolumeTiers>("/settings/volume-tiers", v),
    onSuccess: saved => { qc.setQueryData(["settings", "volume-tiers"], saved); setDirty(false); toast({ title: "Volume tiers saved" }); },
    onError: e => toast({ title: "Invalid thresholds", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });
  if (isLoading) return <SectionSkeleton />;
  const maxVal = Math.max(tiers.platinum, 500);
  return (
    <SectionCard title="Volume Tiers" icon={Trophy} description="Minimum completed trades required to earn each badge tier"
      dirty={dirty} saving={mut.isPending} error={validationError} onSave={() => mut.mutate(tiers)} onReset={() => { setTiers(data ?? DEFAULT_TIERS); setDirty(false); }}>
      {TIER_META.map(({ key, emoji, label, color, bar, glow }) => (
        <div key={key} className="px-6 py-4 hover:bg-muted/20 transition-colors">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-32 flex items-center gap-2 shrink-0">
              <span className="text-lg">{emoji}</span>
              <span className={`text-sm font-semibold ${color}`}>{label}</span>
            </div>
            <div className="flex-1 relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full ${bar} rounded-full transition-all duration-300`}
                style={{ width: `${Math.min(100, (tiers[key] / maxVal) * 100)}%` }}
              />
            </div>
            <div className="w-40 shrink-0">
              <div className="relative">
                <input
                  type="number" min={1} value={tiers[key]} onChange={e => setTier(key, e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-16 text-sm font-medium text-right text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">trades</span>
              </div>
            </div>
          </div>
          <div className="ml-32 pl-4">
            <div className={`h-px bg-gradient-to-r ${glow} to-transparent`} />
            <p className="text-xs text-muted-foreground mt-1.5">
              Traders with ≥ <span className={`font-semibold ${color}`}>{tiers[key]}</span> completed trades earn the {label} badge.
            </p>
          </div>
        </div>
      ))}
      {/* Tier ladder preview */}
      <div className="mx-6 my-4 bg-background rounded-xl border border-border p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Tier Ladder Preview</p>
        <div className="flex items-end gap-2 h-20">
          {TIER_META.map(({ key, bar, label, color }, i) => (
            <div key={key} className="flex-1 flex flex-col items-center gap-1.5">
              <span className={`text-xs font-bold ${color}`}>{tiers[key]}</span>
              <div
                className={`w-full ${bar} rounded-t-md transition-all duration-500`}
                style={{ height: `${Math.max(12, (tiers[key] / Math.max(tiers.platinum, 500)) * 64)}px` }}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

// ── KYC & Trust Section ───────────────────────────────────────────────────────

const DEFAULT_KYC: KycSettings = { kycRequiredForAds: false, kycRequiredForOrders: false, autoRejectAfterDays: 30, allowMerchantWithoutKyc: false };

function KycSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<KycSettings>({ queryKey: ["settings", "kyc"], queryFn: () => get<KycSettings>("/settings/kyc") });
  const [form, setForm] = useState<KycSettings>(DEFAULT_KYC);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setForm(data); setDirty(false); } }, [data]);
  const set = <K extends keyof KycSettings>(k: K, v: KycSettings[K]) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const mut = useMutation({
    mutationFn: (v: KycSettings) => put<KycSettings>("/settings/kyc", v),
    onSuccess: saved => { qc.setQueryData(["settings", "kyc"], saved); setDirty(false); toast({ title: "KYC settings saved" }); },
    onError: e => toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });
  if (isLoading) return <SectionSkeleton />;
  return (
    <SectionCard title="KYC & Trust" icon={ShieldCheck} description="Identity verification and trust requirements for platform participation"
      dirty={dirty} saving={mut.isPending} onSave={() => mut.mutate(form)} onReset={() => { setForm(data ?? DEFAULT_KYC); setDirty(false); }}>
      <SettingRow label="KYC Required to Post Ads" description="Users must pass KYC verification before listing buy or sell advertisements" icon={BadgeCheck}>
        <Toggle checked={form.kycRequiredForAds} onCheckedChange={v => set("kycRequiredForAds", v)} />
      </SettingRow>
      <SettingRow label="KYC Required to Place Orders" description="Buyers must be KYC-verified before they can initiate any trade" icon={CheckCircle2}>
        <Toggle checked={form.kycRequiredForOrders} onCheckedChange={v => set("kycRequiredForOrders", v)} />
      </SettingRow>
      <SettingRow label="Allow Merchant Status Without KYC" description="Permit admins to grant merchant badges to unverified users" icon={Medal}>
        <Toggle checked={form.allowMerchantWithoutKyc} onCheckedChange={v => set("allowMerchantWithoutKyc", v)} />
      </SettingRow>
      <SettingRow label="Auto-reject Idle Applications" description="Automatically reject KYC submissions that have not been reviewed within this many days" icon={UserX}>
        <NumInput value={form.autoRejectAfterDays} onChange={v => set("autoRejectAfterDays", v)} min={1} max={365} unit="days" width="w-24" />
      </SettingRow>
      {/* Status overview */}
      <div className="mx-6 my-4 grid grid-cols-2 gap-2">
        {[
          { label: "Ads require KYC",    active: form.kycRequiredForAds },
          { label: "Orders require KYC", active: form.kycRequiredForOrders },
          { label: "Merchant bypass",    active: form.allowMerchantWithoutKyc },
          { label: `Auto-reject after ${form.autoRejectAfterDays}d`, active: true, info: true },
        ].map(({ label, active, info }) => (
          <div key={label} className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-xs font-medium ${info ? "border-primary/20 bg-primary/5 text-primary" : active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-border text-muted-foreground"}`}>
            {info ? <Info size={12} /> : active ? <CheckCircle2 size={12} /> : <Clock size={12} />}
            {label}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── API Keys Section ──────────────────────────────────────────────────────────

interface ApiKeyEntry {
  name: string;
  label: string;
  hint: string;
  configured: boolean;
  masked: string | null;
  updated_at: string | null;
}

function ApiKeyRow({ entry, onSave, onDelete }: {
  entry: ApiKeyEntry;
  onSave: (name: string, value: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!value.trim() || value.trim().length < 8) return;
    setSaving(true);
    try {
      await onSave(entry.name, value.trim());
      setValue("");
      setEditing(false);
      setShow(false);
      toast({ title: `${entry.label} saved` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${entry.label}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete(entry.name);
      toast({ title: `${entry.label} removed` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="px-6 py-5 hover:bg-muted/10 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-0.5 p-1.5 rounded-lg ${entry.configured ? "bg-emerald-500/10" : "bg-muted/40"}`}>
            <KeyRound size={13} className={entry.configured ? "text-emerald-400" : "text-muted-foreground"} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{entry.label}</span>
              {entry.configured
                ? <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={10} /> Configured
                  </span>
                : <span className="text-xs text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded-full">
                    Not set
                  </span>
              }
            </div>
            <p className="text-xs text-muted-foreground mt-1">{entry.hint}</p>
            {entry.configured && entry.masked && !editing && (
              <div className="mt-2 flex items-center gap-2">
                <code className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1 rounded border border-border">
                  {entry.masked}
                </code>
                {entry.updated_at && (
                  <span className="text-xs text-muted-foreground">
                    · Updated {new Date(entry.updated_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <Plus size={11} />
                {entry.configured ? "Update" : "Add Key"}
              </button>
              {entry.configured && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 ml-9 space-y-3">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={entry.hint}
              autoFocus
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 pr-10 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:font-sans placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {value.length > 0 && value.length < 8 && (
            <p className="text-xs text-red-400">Key must be at least 8 characters</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || value.trim().length < 8}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={11} />
              {saving ? "Saving…" : "Save Key"}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(""); setShow(false); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<{ keys: ApiKeyEntry[] }>({
    queryKey: ["admin-api-keys"],
    queryFn: () => get<{ keys: ApiKeyEntry[] }>("/api-keys"),
  });

  async function handleSave(name: string, value: string) {
    await fetch(`/api/admin/api-keys/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-key": localStorage.getItem("adminKey") ?? "" },
      body: JSON.stringify({ value }),
    }).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {error?: string}).error ?? `HTTP ${r.status}`); }
    });
    qc.invalidateQueries({ queryKey: ["admin-api-keys"] });
  }

  async function handleDelete(name: string) {
    await fetch(`/api/admin/api-keys/${name}`, {
      method: "DELETE",
      headers: { "x-admin-key": localStorage.getItem("adminKey") ?? "" },
    }).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {error?: string}).error ?? `HTTP ${r.status}`); }
    });
    qc.invalidateQueries({ queryKey: ["admin-api-keys"] });
  }

  if (isLoading) return <SectionSkeleton />;
  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
      Failed to load API keys.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-start gap-3">
        <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-300">Keys are stored securely in the database</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Keys are encrypted at rest and never exposed in plaintext after saving. Only the last 4 characters are shown for verification. Do not share your admin credentials with anyone.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-card-border bg-card/60 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <KeyRound size={14} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Third-Party API Credentials</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Manage keys for payment providers, card issuers, and other services</p>
          </div>
        </div>
        <div className="divide-y divide-card-border">
          {(data?.keys ?? []).map(entry => (
            <ApiKeyRow
              key={entry.name}
              entry={entry}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden animate-pulse">
      <div className="h-[72px] bg-muted/40 border-b border-card-border" />
      {[1, 2, 3].map(i => <div key={i} className="h-16 border-b border-card-border bg-muted/20" />)}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const [active, setActive] = useState<SectionId>("platform");

  return (
    <div className="flex gap-6 p-8 min-h-full">
      {/* Sidebar nav */}
      <div className="w-52 shrink-0">
        <div className="sticky top-6">
          <div className="flex items-center gap-2 mb-5 px-1">
            <SettingsIcon size={16} className="text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Settings</h1>
          </div>
          <nav className="bg-card border border-card-border rounded-xl p-1.5 space-y-0.5">
            {NAV.map(({ id, label, icon: Icon, desc }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                  active === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                }`}
                title={desc}
              >
                <Icon size={14} className="shrink-0" />
                <span className="text-sm font-medium">{label}</span>
                {active === id && <span className="ml-auto w-1 h-1 bg-primary rounded-full" />}
              </button>
            ))}
          </nav>

          {/* Info card */}
          <div className="mt-4 bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info size={13} className="text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Note</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Settings take effect immediately after saving. No restart required.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 max-w-3xl">
        <div className="mb-5 pb-4 border-b border-card-border">
          {(() => {
            const s = NAV.find(n => n.id === active)!;
            return (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <s.icon size={16} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">{s.label}</h2>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            );
          })()}
        </div>

        {active === "platform" && <PlatformSection />}
        {active === "trading"  && <TradingSection />}
        {active === "tiers"    && <TiersSection />}
        {active === "kyc"      && <KycSection />}
        {active === "apikeys"  && <ApiKeysSection />}
      </div>
    </div>
  );
}
