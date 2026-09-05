import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Play, Zap, RefreshCw, CheckCircle2, AlertTriangle,
  TrendingUp, BarChart3, Layers, Clock,
} from "lucide-react";

const adminKey = () => localStorage.getItem("adminKey") ?? "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey(), ...options?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface MLStat {
  trades: number; wins: number; losses: number; winRate: number;
  grossPnl: number; maxDrawdown: number;
  trainAccuracy: number; testAccuracy: number;
  trainSamples: number; testTrades: number;
  threshold: number; overfit: boolean; feedbackCount: number;
}
interface BacktestRun {
  id: string; status: string; months: number;
  progress: number; message: string | null;
  results: {
    combined: {
      trades: number; wins: number; losses: number; winRate: number;
      grossPnl: number; maxDrawdown: number;
      ml: MLStat;
      enhanced: { trades: number; wins: number; losses: number; winRate: number; grossPnl: number; };
    };
    assets: Array<{ asset: string; ml: MLStat; }>;
  } | null;
  createdAt: string; finishedAt: string | null;
}

interface PretrainResponse {
  ok: boolean; summary: string; months: number;
  results: Array<{
    asset: string; candleCount: number; trainSamples: number;
    trainAccuracy: number; testAccuracy: number; threshold: number;
    feedbackCount: number; skipped: boolean; skipReason?: string;
  }>;
}

function Stat({ label, value, sub, color = "text-foreground" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-muted/40 rounded-lg p-3 flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function BotAI() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [months, setMonths] = useState(12);

  const { data: latest, isLoading } = useQuery<BacktestRun | null>({
    queryKey: ["backtest-latest"],
    queryFn: () => apiFetch("/api/bot/backtest/latest"),
    refetchInterval: (query) => query.state.data?.status === "running" ? 3000 : 30_000,
  });

  const backtestMut = useMutation({
    mutationFn: (m: number) =>
      apiFetch<{ runId: string }>("/api/bot/backtest/run", {
        method: "POST", body: JSON.stringify({ months: m }),
      }),
    onSuccess: () => {
      toast({ title: "Backtest started", description: `Running ${months}-month backtest…` });
      void qc.invalidateQueries({ queryKey: ["backtest-latest"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const pretrainMut = useMutation({
    mutationFn: () =>
      apiFetch<PretrainResponse>("/api/bot/pretrain", {
        method: "POST", body: JSON.stringify({ months: 12 }),
      }),
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "Model updated", description: data.summary });
      } else {
        toast({ title: "Pre-train failed", description: data.summary, variant: "destructive" });
      }
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const isRunning  = latest?.status === "running";
  const combined   = latest?.results?.combined;
  const ml         = combined?.ml;
  const ptResult   = pretrainMut.data;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Brain size={22} className="text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Bot AI — Model Training</h1>
          <p className="text-sm text-muted-foreground">
            Company-only controls. Train once, all users' bots use the same model automatically.
          </p>
        </div>
      </div>

      {/* ── Action cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Backtest */}
        <div className="border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" />
            <h2 className="font-semibold">Run Backtest + Retrain</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Downloads real candles, simulates all 3 strategies, trains the ML model on 70% of data,
            validates on held-out 30%, and saves new weights to the database.
          </p>

          <div className="flex gap-2 flex-wrap">
            {([3, 6, 12, 24, 60] as const).map(m => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors
                  ${months === m
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                  }`}
              >
                {m === 60 ? "5 yrs" : `${m}m`}
              </button>
            ))}
          </div>

          {months >= 48 && (
            <p className="text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 rounded-md p-2">
              ⚡ First 5-year run downloads ~500k candles and caches them. Subsequent runs only fetch new candles.
            </p>
          )}

          <button
            onClick={() => backtestMut.mutate(months)}
            disabled={isRunning || backtestMut.isPending}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground
              rounded-lg py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isRunning || backtestMut.isPending
              ? <><RefreshCw size={15} className="animate-spin" /> Running…</>
              : <><Play size={15} /> Run {months}m Backtest</>
            }
          </button>

          {isRunning && latest && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{latest.message ?? "Initialising…"}</span>
                <span>{latest.progress}%</span>
              </div>
              <ProgressBar pct={latest.progress} />
            </div>
          )}
        </div>

        {/* Pre-Train */}
        <div className="border rounded-xl p-5 space-y-4 border-cyan-500/30">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-cyan-500" />
            <h2 className="font-semibold">Historical Pre-Train</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Skips the simulation — trains the model directly on <strong>every cached candle</strong>
            (not just signal-fired ones). Uses already-downloaded data. Takes ~10 seconds.
            Best run after a 1-year+ backtest has cached the data.
          </p>
          <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Training data</span>
              <span className="text-foreground font-medium">~200k candles (GOLD + EUR)</span>
            </div>
            <div className="flex justify-between">
              <span>Method</span>
              <span className="text-foreground font-medium">All candles, 70/30 split</span>
            </div>
            <div className="flex justify-between">
              <span>Feedback boost</span>
              <span className="text-foreground font-medium">Wrong predictions × 3</span>
            </div>
          </div>

          <button
            onClick={() => pretrainMut.mutate()}
            disabled={pretrainMut.isPending}
            className="w-full flex items-center justify-center gap-2 bg-cyan-950 text-cyan-300 border border-cyan-700
              rounded-lg py-2.5 text-sm font-medium hover:bg-cyan-900 disabled:opacity-50 transition-colors"
          >
            {pretrainMut.isPending
              ? <><RefreshCw size={15} className="animate-spin" /> Training…</>
              : <><Zap size={15} /> Pre-Train on 1 Year Now</>
            }
          </button>

          {ptResult && (
            <div className={`rounded-lg p-3 text-sm space-y-2 border
              ${ptResult.ok ? "bg-emerald-950/30 border-emerald-800" : "bg-red-950/30 border-red-800"}`}>
              <div className="flex items-center gap-2">
                {ptResult.ok
                  ? <CheckCircle2 size={15} className="text-emerald-500" />
                  : <AlertTriangle size={15} className="text-red-500" />
                }
                <span className={ptResult.ok ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                  {ptResult.ok ? "Model updated" : "Failed"}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">{ptResult.summary}</p>
              {ptResult.ok && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {ptResult.results.map(r => (
                    <div key={r.asset} className="bg-muted/40 rounded-md p-2 text-xs space-y-1">
                      <p className="font-semibold text-foreground">
                        {r.asset === "GOLD" ? "🥇 GOLD" : "💶 EURUSD"}
                      </p>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Test Acc</span>
                        <span className="text-cyan-400 font-bold">{r.testAccuracy}%</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Samples</span>
                        <span className="text-foreground">{(r.trainSamples / 1000).toFixed(1)}k</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Candles</span>
                        <span className="text-foreground">{(r.candleCount / 1000).toFixed(1)}k</span>
                      </div>
                      {r.feedbackCount > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Live trades</span>
                          <span className="text-emerald-400">+{r.feedbackCount}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Latest model stats ── */}
      {ml && latest?.status === "done" && (
        <div className="border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              <h2 className="font-semibold">Latest Model — {latest.months}m Backtest</h2>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={12} />
              {latest.finishedAt
                ? new Date(latest.finishedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "—"}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Test Accuracy"
              value={`${ml.testAccuracy}%`}
              sub="held-out 30%"
              color={ml.testAccuracy >= 58 ? "text-emerald-500" : ml.testAccuracy >= 54 ? "text-amber-500" : "text-red-500"}
            />
            <Stat
              label="Train Accuracy"
              value={`${ml.trainAccuracy}%`}
              sub={ml.overfit ? "⚠ possible overfit" : "✓ stable"}
              color={ml.overfit ? "text-amber-500" : "text-foreground"}
            />
            <Stat
              label="Training Samples"
              value={`${(ml.trainSamples / 1000).toFixed(1)}k`}
              sub={`+${ml.feedbackCount} live trades`}
            />
            <Stat
              label="Threshold"
              value={`${(ml.threshold * 100).toFixed(0)}%`}
              sub="auto-optimised"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="ML Win Rate"
              value={`${ml.winRate}%`}
              color={ml.winRate >= 58 ? "text-emerald-500" : ml.winRate >= 54 ? "text-amber-500" : "text-red-500"}
            />
            <Stat
              label="ML Trades"
              value={ml.trades.toLocaleString()}
              sub="test set only"
            />
            <Stat
              label="ML P&L"
              value={`${ml.grossPnl >= 0 ? "+" : ""}$${ml.grossPnl.toFixed(0)}`}
              color={ml.grossPnl >= 0 ? "text-emerald-500" : "text-red-500"}
            />
            <Stat
              label="Max Drawdown"
              value={`-$${ml.maxDrawdown.toFixed(0)}`}
              color="text-red-400"
            />
          </div>

          {/* Per-asset breakdown */}
          {latest.results?.assets && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Per-asset</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {latest.results.assets.map(a => (
                  <div key={a.asset} className="bg-muted/30 rounded-lg p-3 flex items-center gap-4">
                    <span className="text-lg">{a.asset === "GOLD" ? "🥇" : "💶"}</span>
                    <div className="flex-1 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Test Acc</p>
                        <p className={`font-bold ${a.ml.testAccuracy >= 58 ? "text-emerald-500" : a.ml.testAccuracy >= 54 ? "text-amber-500" : "text-foreground"}`}>
                          {a.ml.testAccuracy}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">WR</p>
                        <p className={`font-bold ${a.ml.winRate >= 58 ? "text-emerald-500" : "text-foreground"}`}>
                          {a.ml.winRate}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">P&L</p>
                        <p className={`font-bold ${a.ml.grossPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {a.ml.grossPnl >= 0 ? "+" : ""}${a.ml.grossPnl.toFixed(0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Layers size={13} className="text-primary shrink-0 mt-0.5" />
            <span>
              16 features · logistic regression · L2 regularisation · 200 SGD epochs · threshold auto-search 50–70%.
              The bot on every user's device loads these weights automatically — no action needed from users.
            </span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-muted-foreground text-sm py-8">Loading…</div>
      )}

      {!isLoading && !latest && (
        <div className="border rounded-xl p-8 text-center text-muted-foreground space-y-2">
          <Brain size={32} className="mx-auto text-muted-foreground/40" />
          <p className="font-medium">No backtest run yet</p>
          <p className="text-sm">Run a backtest above to train the AI model for the first time.</p>
        </div>
      )}
    </div>
  );
}
