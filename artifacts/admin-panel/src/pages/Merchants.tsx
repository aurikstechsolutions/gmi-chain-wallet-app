import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, type Profile, type PagedProfiles } from "@/lib/api";
import { Store, User, Clock, Search, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { BadgeRow } from "@/lib/badges";
import { Paginator } from "@/components/Paginator";

function shortAddr(addr: string) {
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

export default function Merchants() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PagedProfiles>({
    queryKey: ["admin", "profiles", page],
    queryFn: () => get<PagedProfiles>(`/profiles?page=${page}`),
  });

  const toggleMut = useMutation({
    mutationFn: (address: string) => post<Profile>(`/merchant/${address}/verify`),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast({
        title: updated.isMerchant ? "Merchant status granted" : "Merchant status removed",
        description: updated.displayName,
      });
    },
    onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });

  const pinMut = useMutation({
    mutationFn: (address: string) => post<Profile>(`/merchant/${address}/pin`),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast({
        title: updated.isPinned ? "Merchant pinned" : "Merchant unpinned",
        description: `${updated.displayName} will ${updated.isPinned ? "now appear at the top of the ads list" : "no longer be pinned to the top"}.`,
      });
    },
    onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }),
  });

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
  }

  const profiles = (data?.profiles ?? []).filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.displayName.toLowerCase().includes(q) || p.mxcAddress.toLowerCase().includes(q);
  });

  const merchants = profiles
    .filter(p => p.isMerchant)
    .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
  const nonMerchants = profiles.filter(p => !p.isMerchant);

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <Store size={20} className="text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Merchants</h1>
          {data && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {data.total} total
            </span>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name or address…"
            className="pl-8 pr-4 py-2 bg-card border border-card-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-64"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Clock size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="space-y-8">
            <Section
              title={`Verified Merchants (${merchants.length}${search ? " on this page" : ""})`}
              profiles={merchants}
              onToggle={addr => toggleMut.mutate(addr)}
              onPin={addr => pinMut.mutate(addr)}
              pending={toggleMut.isPending || pinMut.isPending}
              emptyMsg="No verified merchants on this page"
              showPin
            />
            <Section
              title={`Other Users (${nonMerchants.length}${search ? " on this page" : ""})`}
              profiles={nonMerchants}
              onToggle={addr => toggleMut.mutate(addr)}
              onPin={addr => pinMut.mutate(addr)}
              pending={toggleMut.isPending || pinMut.isPending}
              emptyMsg="No users found"
            />
          </div>

          {data && !search && (
            <Paginator
              page={data.page}
              total={data.total}
              limit={data.limit}
              onChange={p => setPage(p)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, profiles, onToggle, onPin, pending, emptyMsg, showPin }: {
  title: string;
  profiles: Profile[];
  onToggle: (addr: string) => void;
  onPin: (addr: string) => void;
  pending: boolean;
  emptyMsg: string;
  showPin?: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {profiles.map(profile => (
            <div key={profile.id} className={`bg-card border rounded-xl px-5 py-4 flex items-center justify-between gap-4 ${profile.isPinned ? "border-amber-500/40 ring-1 ring-amber-500/20" : "border-card-border"}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 relative">
                  <User size={16} className="text-primary" />
                  {profile.isPinned && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                      <Pin size={8} className="text-white" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground text-sm">{profile.displayName}</span>
                    {profile.isPinned && (
                      <span className="text-xs text-amber-500 font-semibold">Pinned</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mb-0.5">{shortAddr(profile.mxcAddress)}</p>
                  <BadgeRow
                    kycVerified={profile.kycStatus === "verified"}
                    isMerchant={profile.isMerchant}
                    completedTrades={profile.completedTrades}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-muted-foreground">Trades</p>
                  <p className="text-sm text-foreground">{profile.completedTrades}/{profile.totalTrades}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-muted-foreground">Rating</p>
                  <p className="text-sm text-foreground">{Number(profile.avgRating).toFixed(1)} ★</p>
                </div>

                {showPin && (
                  <button
                    onClick={() => onPin(profile.mxcAddress)}
                    disabled={pending}
                    title={profile.isPinned ? "Unpin merchant" : "Pin to top of ads"}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50
                      ${profile.isPinned
                        ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                  >
                    {profile.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                    {profile.isPinned ? "Unpin" : "Pin"}
                  </button>
                )}

                <button
                  onClick={() => onToggle(profile.mxcAddress)}
                  disabled={pending}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50
                    ${profile.isMerchant
                      ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                      : "bg-primary/15 text-primary hover:bg-primary/25"
                    }`}
                >
                  <Store size={13} />
                  {profile.isMerchant ? "Remove" : "Grant"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
