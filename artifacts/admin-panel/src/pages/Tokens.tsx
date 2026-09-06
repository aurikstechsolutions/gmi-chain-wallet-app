import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Coins,
  ChevronUp, ChevronDown, Check, X, Eye, EyeOff, ExternalLink
} from "lucide-react";

const adminKey = () => localStorage.getItem("adminKey") ?? "";

interface VerifiedToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  coingeckoId: string;
  contractAddress: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey(), ...options?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const emptyForm = {
  symbol: "",
  name: "",
  decimals: 18,
  logoUrl: "",
  coingeckoId: "",
  contractAddress: "",
  sortOrder: 0,
  active: true,
};
type TokenForm = typeof emptyForm;

function TokenFormFields({ value, onChange }: { value: TokenForm; onChange: (v: TokenForm) => void }) {
  const set = (k: keyof TokenForm, v: string | number | boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Symbol *</label>
          <input
            value={value.symbol}
            onChange={e => set("symbol", e.target.value.toUpperCase())}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary uppercase"
            placeholder="USDT"
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
          <input
            value={value.name}
            onChange={e => set("name", e.target.value)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Tether USD"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Decimals</label>
          <input
            type="number"
            value={value.decimals}
            min={0}
            max={18}
            onChange={e => set("decimals", parseInt(e.target.value) || 18)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Sort Order</label>
          <input
            type="number"
            value={value.sortOrder}
            onChange={e => set("sortOrder", parseInt(e.target.value) || 0)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Contract Address on MChain</label>
        <input
          value={value.contractAddress}
          onChange={e => set("contractAddress", e.target.value.trim())}
          className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
          placeholder="0x… (leave blank if not yet deployed)"
        />
        <p className="text-xs text-muted-foreground mt-1">If filled, the wallet will add this token in one tap. Leave blank to prompt the user for the address.</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Logo URL</label>
        <div className="flex items-center gap-2">
          {value.logoUrl && (
            <img src={value.logoUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <input
            value={value.logoUrl}
            onChange={e => set("logoUrl", e.target.value.trim())}
            className="flex-1 text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="https://assets.coingecko.com/…"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">CoinGecko ID</label>
        <input
          value={value.coingeckoId}
          onChange={e => set("coingeckoId", e.target.value.trim())}
          className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="tether"
        />
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <div
          onClick={() => set("active", !value.active)}
          className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${value.active ? "bg-primary" : "bg-muted"}`}
        >
          <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${value.active ? "translate-x-4" : "translate-x-0"}`} />
        </div>
        <span className="text-sm text-foreground">Visible in wallet</span>
        {!value.active && <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">HIDDEN</span>}
      </label>
    </div>
  );
}

export default function Tokens() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<TokenForm>(emptyForm);

  const { data, isLoading } = useQuery<{ tokens: VerifiedToken[] }>({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiFetch("/api/admin/tokens"),
  });
  const tokens = data?.tokens ?? [];

  const createMut = useMutation({
    mutationFn: (body: TokenForm) => apiFetch("/api/admin/tokens", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tokens"] });
      setShowAdd(false);
      setForm(emptyForm);
      toast({ title: "Token added" });
    },
    onError: () => toast({ title: "Error", description: "Failed to add token", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TokenForm> }) =>
      apiFetch(`/api/admin/tokens/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tokens"] });
      setEditId(null);
      toast({ title: "Saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "tokens"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  function startEdit(t: VerifiedToken) {
    setEditId(t.id);
    setForm({
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoUrl: t.logoUrl,
      coingeckoId: t.coingeckoId,
      contractAddress: t.contractAddress,
      sortOrder: t.sortOrder,
      active: t.active,
    });
    setShowAdd(false);
  }

  function cancelEdit() { setEditId(null); setShowAdd(false); setForm(emptyForm); }

  function toggleActive(t: VerifiedToken) {
    updateMut.mutate({ id: t.id, body: { active: !t.active } });
  }

  function shiftOrder(t: VerifiedToken, dir: -1 | 1) {
    updateMut.mutate({ id: t.id, body: { sortOrder: t.sortOrder + dir } });
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Coins size={20} className="text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Verified Tokens</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage the token list shown in the wallet's "Add Token" screen. Tokens marked as visible appear under "Popular".
          </p>
        </div>
        {!showAdd && !editId && (
          <Button size="sm" onClick={() => { setShowAdd(true); setForm(emptyForm); }}>
            <Plus size={14} className="mr-1" /> Add Token
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">New Token</h2>
          <TokenFormFields value={form} onChange={setForm} />
          <div className="flex items-center gap-2 mt-4">
            <Button
              size="sm"
              disabled={createMut.isPending || !form.symbol || !form.name}
              onClick={() => createMut.mutate(form)}
            >
              {createMut.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Plus size={14} className="mr-1" />}
              Add Token
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : tokens.length === 0 && !showAdd ? (
        <div className="text-center py-16 text-muted-foreground">
          <Coins size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No verified tokens yet.</p>
          <Button size="sm" className="mt-4" onClick={() => { setShowAdd(true); setForm(emptyForm); }}>
            <Plus size={14} className="mr-1" /> Add your first token
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map((t) => (
            <div key={t.id} className={`bg-card border rounded-xl overflow-hidden transition-opacity ${t.active ? "border-border" : "border-border opacity-60"}`}>
              {editId === t.id ? (
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">Edit Token</h3>
                  <TokenFormFields value={form} onChange={setForm} />
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      disabled={updateMut.isPending || !form.symbol || !form.name}
                      onClick={() => updateMut.mutate({ id: t.id, body: form })}
                    >
                      {updateMut.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit}><X size={14} className="mr-1" />Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-4">
                  {t.logoUrl ? (
                    <img
                      src={t.logoUrl}
                      alt={t.symbol}
                      className="w-10 h-10 rounded-full object-cover border border-border flex-shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-primary">{t.symbol.slice(0, 3)}</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{t.symbol}</span>
                      <span className="text-xs text-muted-foreground">{t.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{t.decimals} dec</span>
                      {!t.active && (
                        <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full flex items-center gap-1">
                          <EyeOff size={9} /> Hidden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {t.contractAddress && (
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">{t.contractAddress}</span>
                      )}
                      {t.coingeckoId && (
                        <a
                          href={`https://www.coingecko.com/en/coins/${t.coingeckoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                        >
                          CoinGecko <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => shiftOrder(t, -1)} title="Move up"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => shiftOrder(t, 1)} title="Move down"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => toggleActive(t)} title={t.active ? "Hide from wallet" : "Show in wallet"}
                      className={`p-1.5 rounded-md transition-colors ${t.active ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}>
                      {t.active ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button onClick={() => startEdit(t)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete "${t.symbol}"?`)) deleteMut.mutate(t.id); }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
