import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Globe, LayoutGrid,
  Clock, ExternalLink, ChevronUp, ChevronDown, Check, X
} from "lucide-react";

const adminKey = () => localStorage.getItem("adminKey") ?? "";

interface FeaturedDapp {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: string;
  color: string;
  sortOrder: number;
  comingSoon: boolean;
  createdAt: string;
}

const ICON_OPTIONS = [
  "globe-outline", "search-outline", "swap-horizontal-outline", "repeat-outline",
  "server-outline", "people-outline", "images-outline", "flash-outline",
  "diamond-outline", "wallet-outline", "bar-chart-outline", "shield-outline",
  "star-outline", "receipt-outline", "storefront-outline", "cube-outline",
];

const COLOR_PRESETS = [
  "#0EA5E9", "#8B5CF6", "#10B981", "#F59E0B",
  "#EF4444", "#EC4899", "#06B6D4", "#F97316",
];

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey(), ...options?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const emptyForm = { name: "", description: "", url: "", icon: "globe-outline", color: "#0EA5E9", sortOrder: 0, comingSoon: false };
type DappForm = typeof emptyForm;

function DappFormFields({ value, onChange }: { value: DappForm; onChange: (v: DappForm) => void }) {
  const set = (k: keyof DappForm, v: string | number | boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
          <input value={value.name} onChange={e => set("name", e.target.value)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="MChain Explorer" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">URL *</label>
          <input value={value.url} onChange={e => set("url", e.target.value)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="https://example.com" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
        <input value={value.description} onChange={e => set("description", e.target.value)}
          className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Browse blocks, transactions and addresses" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Icon</label>
          <select value={value.icon} onChange={e => set("icon", e.target.value)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
            {ICON_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Sort Order</label>
          <input type="number" value={value.sortOrder} onChange={e => set("sortOrder", parseInt(e.target.value) || 0)}
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Accent Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {COLOR_PRESETS.map(c => (
            <button key={c} type="button"
              onClick={() => set("color", c)}
              style={{ backgroundColor: c }}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-transform ${value.color === c ? "border-white scale-110" : "border-transparent"}`}>
              {value.color === c && <Check size={12} className="text-white" />}
            </button>
          ))}
          <input type="color" value={value.color} onChange={e => set("color", e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent p-0.5" title="Custom color" />
        </div>
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <div onClick={() => set("comingSoon", !value.comingSoon)}
          className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${value.comingSoon ? "bg-amber-500" : "bg-muted"}`}>
          <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${value.comingSoon ? "translate-x-4" : "translate-x-0"}`} />
        </div>
        <span className="text-sm text-foreground">Mark as Coming Soon</span>
        {value.comingSoon && <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">COMING SOON</span>}
      </label>
    </div>
  );
}

export default function DApps() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<DappForm>(emptyForm);

  const { data, isLoading } = useQuery<{ dapps: FeaturedDapp[] }>({
    queryKey: ["admin", "dapps"],
    queryFn: () => apiFetch("/api/admin/dapps"),
  });
  const dapps = data?.dapps ?? [];

  const createMut = useMutation({
    mutationFn: (body: DappForm) => apiFetch("/api/admin/dapps", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "dapps"] }); setShowAdd(false); setForm(emptyForm); toast({ title: "DApp added" }); },
    onError: () => toast({ title: "Error", description: "Failed to add DApp", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<DappForm> }) =>
      apiFetch(`/api/admin/dapps/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "dapps"] }); setEditId(null); toast({ title: "Saved" }); },
    onError: () => toast({ title: "Error", description: "Failed to save", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/dapps/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "dapps"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  function startEdit(d: FeaturedDapp) {
    setEditId(d.id);
    setForm({ name: d.name, description: d.description, url: d.url, icon: d.icon, color: d.color, sortOrder: d.sortOrder, comingSoon: d.comingSoon });
    setShowAdd(false);
  }

  function cancelEdit() { setEditId(null); setShowAdd(false); setForm(emptyForm); }

  function toggleComingSoon(d: FeaturedDapp) {
    updateMut.mutate({ id: d.id, body: { comingSoon: !d.comingSoon } });
  }

  function shiftOrder(d: FeaturedDapp, dir: -1 | 1) {
    updateMut.mutate({ id: d.id, body: { sortOrder: d.sortOrder + dir } });
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <LayoutGrid size={20} className="text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Featured DApps</h1>
          </div>
          <p className="text-sm text-muted-foreground">Manage the DApps shown in the wallet browser. Marking one as Coming Soon disables tapping in the app.</p>
        </div>
        {!showAdd && !editId && (
          <Button size="sm" onClick={() => { setShowAdd(true); setForm(emptyForm); }}>
            <Plus size={14} className="mr-1" /> Add DApp
          </Button>
        )}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">New DApp</h2>
          <DappFormFields value={form} onChange={setForm} />
          <div className="flex items-center gap-2 mt-4">
            <Button size="sm" disabled={createMut.isPending || !form.name || !form.url} onClick={() => createMut.mutate(form)}>
              {createMut.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Plus size={14} className="mr-1" />}
              Add DApp
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : dapps.length === 0 && !showAdd ? (
        <div className="text-center py-16 text-muted-foreground">
          <Globe size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No featured DApps yet.</p>
          <Button size="sm" className="mt-4" onClick={() => { setShowAdd(true); setForm(emptyForm); }}>
            <Plus size={14} className="mr-1" /> Add your first DApp
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {dapps.map((d) => (
            <div key={d.id} className="bg-card border border-border rounded-xl overflow-hidden">
              {editId === d.id ? (
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">Edit DApp</h3>
                  <DappFormFields value={form} onChange={setForm} />
                  <div className="flex items-center gap-2 mt-4">
                    <Button size="sm" disabled={updateMut.isPending || !form.name || !form.url}
                      onClick={() => updateMut.mutate({ id: d.id, body: form })}>
                      {updateMut.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit}><X size={14} className="mr-1" />Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-4">
                  {/* Color swatch */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: d.color + "20" }}>
                    <Globe size={18} style={{ color: d.color }} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground">{d.name}</span>
                      {d.comingSoon && (
                        <span className="text-xs font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock size={10} /> Coming Soon
                        </span>
                      )}
                    </div>
                    {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5 w-fit">
                      {d.url} <ExternalLink size={10} />
                    </a>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => shiftOrder(d, -1)} title="Move up"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => shiftOrder(d, 1)} title="Move down"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => toggleComingSoon(d)} title="Toggle coming soon"
                      className={`p-1.5 rounded-md transition-colors ${d.comingSoon ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"}`}>
                      <Clock size={15} />
                    </button>
                    <button onClick={() => startEdit(d)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete "${d.name}"?`)) deleteMut.mutate(d.id); }}
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
