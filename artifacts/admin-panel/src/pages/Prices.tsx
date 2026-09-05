import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Save, FlaskConical, Loader2, RefreshCw, AlertCircle, CheckCircle2, Link } from "lucide-react";

const adminKey = () => localStorage.getItem("adminKey") ?? "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey(), ...options?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface PriceConfig {
  symbol: string;
  name: string;
  logoUrl: string;
  priceType: "fixed" | "auto";
  fixedPrice: number | null;
  apiUrl: string | null;
  priceField: string | null;
}

interface LivePrice {
  symbol: string;
  priceType: string;
  priceUsd: number;
  apiUrl: string | null;
  priceField: string | null;
}

function PriceRow({ config, onSaved }: { config: PriceConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [priceType, setPriceType] = useState<"fixed" | "auto">(config.priceType);
  const [fixedPrice, setFixedPrice] = useState(String(config.fixedPrice ?? ""));
  const [apiUrl, setApiUrl] = useState(config.apiUrl ?? "");
  const [priceField, setPriceField] = useState(config.priceField ?? "");
  const [testResult, setTestResult] = useState<{ ok: boolean; extracted?: number | null; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const save = useMutation({
    mutationFn: () => apiFetch(`/api/admin/prices/${config.symbol}`, {
      method: "PUT",
      body: JSON.stringify({
        priceType,
        fixedPrice: priceType === "fixed" ? parseFloat(fixedPrice) || 0 : null,
        apiUrl: priceType === "auto" ? apiUrl || null : null,
        priceField: priceType === "auto" ? priceField || null : null,
      }),
    }),
    onSuccess: () => {
      toast({ title: `${config.symbol} price saved` });
      qc.invalidateQueries({ queryKey: ["admin-prices"] });
      onSaved();
    },
    onError: (e) => toast({ title: "Save failed", description: String(e), variant: "destructive" }),
  });

  async function testUrl() {
    if (!apiUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ ok: boolean; extracted?: number | null; error?: string }>(
        "/api/admin/prices/test",
        { method: "POST", body: JSON.stringify({ apiUrl, priceField: priceField || undefined }) }
      );
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  const dirty =
    priceType !== config.priceType ||
    (priceType === "fixed" && parseFloat(fixedPrice) !== (config.fixedPrice ?? 0)) ||
    (priceType === "auto" && (apiUrl !== (config.apiUrl ?? "") || priceField !== (config.priceField ?? "")));

  return (
    <div className="border border-border rounded-xl p-5 bg-card space-y-4">
      <div className="flex items-center gap-3">
        {config.logoUrl ? (
          <img src={config.logoUrl} alt={config.symbol}
            className="w-10 h-10 rounded-full object-cover border border-border flex-shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary">{config.symbol.slice(0, 3)}</span>
          </div>
        )}
        <div>
          <div className="font-semibold text-foreground">{config.symbol}</div>
          <div className="text-xs text-muted-foreground">{config.name || config.symbol}</div>
        </div>
      </div>

      {/* Price type toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setPriceType("fixed")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            priceType === "fixed"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          Fixed Price
        </button>
        <button
          onClick={() => setPriceType("auto")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            priceType === "auto"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          Auto (API)
        </button>
      </div>

      {priceType === "fixed" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price (USDT)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              type="number"
              step="any"
              min="0"
              value={fixedPrice}
              onChange={e => setFixedPrice(e.target.value)}
              className="w-full pl-7 pr-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      {priceType === "auto" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price API URL</label>
            <div className="relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <input
                value={apiUrl}
                onChange={e => { setApiUrl(e.target.value); setTestResult(null); }}
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://api.example.com/price/mc"
              />
            </div>
            <p className="text-xs text-muted-foreground">The API must return JSON. The response is fetched live each time the price is requested.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price Field Path</label>
            <input
              value={priceField}
              onChange={e => { setPriceField(e.target.value); setTestResult(null); }}
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder='e.g. "price" or "data.usd" or "result.price_usd"'
            />
            <p className="text-xs text-muted-foreground">Dot-separated path to the numeric price in the JSON response. Leave blank if the response is a plain number.</p>
          </div>

          {/* Test button */}
          <Button
            variant="outline"
            size="sm"
            onClick={testUrl}
            disabled={testing || !apiUrl}
            className="gap-2"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            Test URL
          </Button>

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${
              testResult.ok
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}>
              {testResult.ok
                ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
              <span>
                {testResult.ok
                  ? testResult.extracted !== null && testResult.extracted !== undefined
                    ? `Extracted price: $${testResult.extracted}`
                    : "URL reachable but field not found — check the path"
                  : testResult.error}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending || !dirty}
          className="gap-2"
        >
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function Prices() {
  const qc = useQueryClient();
  const { data: adminData, isLoading: adminLoading } = useQuery({
    queryKey: ["admin-prices"],
    queryFn: () => apiFetch<{ prices: PriceConfig[] }>("/api/admin/prices"),
  });

  const { data: liveData, isLoading: liveLoading, refetch: refetchLive } = useQuery({
    queryKey: ["live-prices"],
    queryFn: () => apiFetch<{ prices: LivePrice[] }>("/api/prices"),
    staleTime: 30_000,
  });

  const configs = adminData?.prices ?? [];
  const livePrices = new Map((liveData?.prices ?? []).map(p => [p.symbol, p.priceUsd]));

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <DollarSign size={20} className="text-primary" />
            Coin Prices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set fixed prices or pull live rates from an external API for each coin
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchLive()} className="gap-2">
          <RefreshCw size={14} />
          Refresh Live
        </Button>
      </div>

      {/* Live price summary */}
      {!liveLoading && liveData && (
        <div className="flex flex-wrap gap-3">
          {liveData.prices.map(p => (
            <div key={p.symbol} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
              <span className="text-xs font-semibold text-muted-foreground">{p.symbol}</span>
              <span className="text-sm font-bold text-foreground">${p.priceUsd.toFixed(4)}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                p.priceType === "auto"
                  ? "bg-blue-500/15 text-blue-600"
                  : "bg-muted text-muted-foreground"
              }`}>{p.priceType}</span>
            </div>
          ))}
        </div>
      )}

      {adminLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      ) : configs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
          <p>No coins configured yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map(config => (
            <PriceRow
              key={config.symbol}
              config={config}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["admin-prices"] });
                qc.invalidateQueries({ queryKey: ["live-prices"] });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
