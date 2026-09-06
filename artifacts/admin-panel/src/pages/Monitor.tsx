import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw, Server, Cpu, HardDrive, Database, Activity,
  CheckCircle2, AlertTriangle, XCircle, RotateCcw, Trash2, Zap
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

interface VpsStatus {
  system: {
    uptime: string;
    loadAvg: number[];
    memory: { totalMb: number; usedMb: number; freeMb: number; pct: number };
    disk: { totalMb: number; usedMb: number; freeMb: number; pct: number };
  };
  pm2: { status: string; uptime: string; restarts: number; memory: number; cpu: number; pid: number };
  redis: { ok: boolean; memory: string };
  recentErrors: string[];
  suggestions: Array<{ level: "ok" | "warn" | "error"; message: string; action?: string }>;
  ts: number;
}

function Bar({ pct, warn = 70, danger = 90 }: { pct: number; warn?: number; danger?: number }) {
  const color = pct >= danger ? "bg-red-500" : pct >= warn ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function SuggestionIcon({ level }: { level: "ok" | "warn" | "error" }) {
  if (level === "ok") return <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />;
  if (level === "warn") return <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />;
  return <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />;
}

export default function Monitor() {
  const { toast } = useToast();

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<VpsStatus>({
    queryKey: ["vps-status"],
    queryFn: () => apiFetch("/api/admin/vps-status"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const actionMut = useMutation({
    mutationFn: (action: string) =>
      apiFetch<{ ok: boolean; message: string }>("/api/admin/vps-action", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: (d) => {
      toast({ title: d.message });
      setTimeout(() => void refetch(), 2000);
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw size={18} className="animate-spin" />
        Connecting to VPS…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <XCircle size={32} className="mx-auto mb-3 text-destructive" />
        <p className="font-medium text-foreground">Cannot reach VPS monitor</p>
        <p className="text-sm mt-1">The API server may be down or unreachable.</p>
        <button onClick={() => void refetch()} className="mt-4 px-4 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const { system, pm2, redis, recentErrors, suggestions } = data;
  const hasError = suggestions.some(s => s.level === "error");
  const hasWarn  = suggestions.some(s => s.level === "warn");
  const overallStatus = hasError ? "error" : hasWarn ? "warn" : "ok";

  const statusColors = { ok: "text-emerald-500", warn: "text-amber-500", error: "text-red-500" };
  const statusBg     = { ok: "bg-emerald-500/10 border-emerald-500/20", warn: "bg-amber-500/10 border-amber-500/20", error: "bg-red-500/10 border-red-500/20" };
  const statusLabel  = { ok: "All Systems Healthy", warn: "Warning", error: "Action Required" };

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Server size={20} className="text-primary" />
            VPS Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Last updated: {lastUpdate}</p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Overall status banner ── */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${statusBg[overallStatus]}`}>
        <SuggestionIcon level={overallStatus} />
        <span className={`font-semibold text-sm ${statusColors[overallStatus]}`}>{statusLabel[overallStatus]}</span>
        <span className="text-sm text-muted-foreground">· Uptime {system.uptime}</span>
      </div>

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* CPU / Load */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Cpu size={15} />CPU Load
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{system.loadAvg[0].toFixed(2)}</span>
            <span className="text-sm text-muted-foreground pb-0.5">1m avg</span>
          </div>
          <Bar pct={(system.loadAvg[0] / 4) * 100} warn={50} danger={75} />
          <div className="text-xs text-muted-foreground">5m: {system.loadAvg[1].toFixed(2)} · 15m: {system.loadAvg[2].toFixed(2)}</div>
        </div>

        {/* Memory */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity size={15} />Memory
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{system.memory.pct}%</span>
            <span className="text-sm text-muted-foreground pb-0.5">{system.memory.usedMb} MB used</span>
          </div>
          <Bar pct={system.memory.pct} />
          <div className="text-xs text-muted-foreground">{system.memory.freeMb} MB free of {system.memory.totalMb} MB</div>
        </div>

        {/* Disk */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <HardDrive size={15} />Disk
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{system.disk.pct}%</span>
            <span className="text-sm text-muted-foreground pb-0.5">{Math.round(system.disk.usedMb / 1024)} GB used</span>
          </div>
          <Bar pct={system.disk.pct} />
          <div className="text-xs text-muted-foreground">{Math.round(system.disk.freeMb / 1024)} GB free of {Math.round(system.disk.totalMb / 1024)} GB</div>
        </div>

        {/* Redis */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Database size={15} />Redis
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${redis.ok ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="text-2xl font-bold">{redis.ok ? "Online" : "Down"}</span>
          </div>
          <div className="text-xs text-muted-foreground">Memory: {redis.memory}</div>
          {!redis.ok && (
            <button
              onClick={() => actionMut.mutate("restart_redis")}
              disabled={actionMut.isPending}
              className="text-xs px-2.5 py-1.5 rounded-md bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              Restart Redis
            </button>
          )}
        </div>
      </div>

      {/* ── PM2 Process ── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Zap size={15} className="text-primary" />
            PM2 · mchain-api
          </h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pm2.status === "online" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
              {pm2.status}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground text-xs mb-1">Uptime</div><div className="font-medium">{pm2.uptime}</div></div>
          <div><div className="text-muted-foreground text-xs mb-1">Restarts</div><div className={`font-medium ${pm2.restarts > 10 ? "text-amber-500" : ""}`}>{pm2.restarts}</div></div>
          <div><div className="text-muted-foreground text-xs mb-1">Memory</div><div className={`font-medium ${pm2.memory > 400 ? "text-amber-500" : ""}`}>{pm2.memory} MB</div></div>
          <div><div className="text-muted-foreground text-xs mb-1">CPU</div><div className="font-medium">{pm2.cpu}%</div></div>
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t border-border">
          <button
            onClick={() => actionMut.mutate("restart_pm2")}
            disabled={actionMut.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={12} />
            Restart PM2
          </button>
          <button
            onClick={() => actionMut.mutate("clear_logs")}
            disabled={actionMut.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-muted text-muted-foreground border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} />
            Clear Logs
          </button>
          <button
            onClick={() => actionMut.mutate("restart_redis")}
            disabled={actionMut.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-muted text-muted-foreground border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Database size={12} />
            Restart Redis
          </button>
        </div>
      </div>

      {/* ── Health suggestions ── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-primary" />
          Health Checks
        </h2>
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm">
              <SuggestionIcon level={s.level} />
              <div className="flex-1">
                <span className={s.level === "ok" ? "text-foreground" : s.level === "warn" ? "text-amber-500" : "text-red-500"}>
                  {s.message}
                </span>
                {s.action && s.action !== "view_logs" && (
                  <button
                    onClick={() => actionMut.mutate(s.action!)}
                    disabled={actionMut.isPending}
                    className="ml-2 text-xs underline text-primary hover:opacity-70 transition-opacity"
                  >
                    Fix now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Error log ── */}
      {recentErrors.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" />
            Recent Error Log <span className="text-muted-foreground font-normal">(last 20 lines)</span>
          </h2>
          <div className="bg-background rounded-lg p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
            {recentErrors.map((line, i) => (
              <div key={i} className={`leading-relaxed ${line.includes("error") || line.includes("Error") ? "text-red-400" : "text-muted-foreground"}`}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {recentErrors.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <CheckCircle2 size={16} className="text-emerald-500" />
          No errors in log — everything looks clean
        </div>
      )}
    </div>
  );
}
