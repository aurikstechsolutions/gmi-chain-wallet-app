import { Router, type Request, type Response, type NextFunction } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";

const execAsync = promisify(exec);
const router = Router();

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) { res.status(503).json({ error: "Admin secret not configured" }); return; }
  if (req.headers["x-admin-key"] !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

async function run(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 8000 });
    return stdout.trim();
  } catch (e) {
    return (e as { stderr?: string; stdout?: string }).stdout?.trim() ?? "";
  }
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

router.get("/admin/vps-status", adminAuth, async (_req, res) => {
  const [pm2Raw, redisRaw, redisMemRaw, dfRaw, errLogRaw] = await Promise.all([
    run("pm2 jlist"),
    run("redis-cli ping"),
    run("redis-cli info memory"),
    run("df -BM /"),
    readFile("/var/log/mchain-api/error-0.log", "utf8").catch(() => ""),
  ]);

  // ── System ─────────────────────────────────────────────────────────────────
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem  = Math.round(os.freemem()  / 1024 / 1024);
  const usedMem  = totalMem - freeMem;
  const load = os.loadavg();

  // Parse df
  const dfLine = dfRaw.split("\n")[1] ?? "";
  const dfParts = dfLine.trim().split(/\s+/);
  const diskTotal = parseInt(dfParts[1] ?? "0");
  const diskUsed  = parseInt(dfParts[2] ?? "0");
  const diskFree  = parseInt(dfParts[3] ?? "0");
  const diskPct   = parseInt((dfParts[4] ?? "0%").replace("%", ""));

  // ── PM2 ────────────────────────────────────────────────────────────────────
  let pm2 = { status: "unknown", uptime: "—", restarts: 0, memory: 0, cpu: 0, pid: 0 };
  try {
    const list = JSON.parse(pm2Raw) as Array<{
      name: string; pm2_env: { status: string; pm_uptime: number; restart_time: number; pm_id: number };
      monit: { memory: number; cpu: number }; pid: number;
    }>;
    const proc = list.find(p => p.name === "mchain-api") ?? list[0];
    if (proc) {
      const uptimeSecs = Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000);
      pm2 = {
        status: proc.pm2_env.status,
        uptime: fmtUptime(uptimeSecs),
        restarts: proc.pm2_env.restart_time,
        memory: Math.round(proc.monit.memory / 1024 / 1024),
        cpu: proc.monit.cpu,
        pid: proc.pid,
      };
    }
  } catch { /* ignore parse error */ }

  // ── Redis ──────────────────────────────────────────────────────────────────
  const redisOk = redisRaw.trim() === "PONG";
  const redisMemMatch = redisMemRaw.match(/used_memory_human:(.+)/);
  const redisMem = redisMemMatch?.[1]?.trim() ?? "—";

  // ── Error log ──────────────────────────────────────────────────────────────
  const allLines = errLogRaw.split("\n").filter(Boolean);
  const recentErrors = allLines.slice(-20).reverse();

  // ── Health suggestions ─────────────────────────────────────────────────────
  const suggestions: Array<{ level: "ok" | "warn" | "error"; message: string; action?: string }> = [];

  if (pm2.status !== "online") {
    suggestions.push({ level: "error", message: `PM2 process is ${pm2.status}`, action: "restart_pm2" });
  } else {
    suggestions.push({ level: "ok", message: "PM2 process is online" });
  }

  if (!redisOk) {
    suggestions.push({ level: "error", message: "Redis is not responding", action: "restart_redis" });
  } else {
    suggestions.push({ level: "ok", message: "Redis is healthy" });
  }

  if (pm2.restarts > 10) {
    suggestions.push({ level: "warn", message: `Process restarted ${pm2.restarts} times — check error logs`, action: "view_logs" });
  }

  if (pm2.memory > 400) {
    suggestions.push({ level: "warn", message: `High memory usage: ${pm2.memory} MB`, action: "restart_pm2" });
  }

  if (load[0] > 2) {
    suggestions.push({ level: "warn", message: `High CPU load: ${load[0].toFixed(2)}` });
  }

  if (diskPct > 85) {
    suggestions.push({ level: "error", message: `Disk almost full: ${diskPct}% used` });
  }

  if (usedMem / totalMem > 0.9) {
    suggestions.push({ level: "warn", message: `Low free memory: ${freeMem} MB remaining` });
  }

  res.json({
    system: {
      uptime: fmtUptime(os.uptime()),
      loadAvg: load.map(v => parseFloat(v.toFixed(2))),
      memory: { totalMb: totalMem, usedMb: usedMem, freeMb: freeMem, pct: Math.round((usedMem / totalMem) * 100) },
      disk: { totalMb: diskTotal, usedMb: diskUsed, freeMb: diskFree, pct: diskPct },
    },
    pm2,
    redis: { ok: redisOk, memory: redisMem },
    recentErrors,
    suggestions,
    ts: Date.now(),
  });
});

router.post("/admin/vps-action", adminAuth, async (req, res) => {
  const { action } = req.body as { action?: string };

  switch (action) {
    case "restart_pm2": {
      await run("pm2 restart mchain-api");
      res.json({ ok: true, message: "PM2 restart triggered" });
      break;
    }
    case "restart_redis": {
      await run("systemctl restart redis-server");
      res.json({ ok: true, message: "Redis restart triggered" });
      break;
    }
    case "clear_logs": {
      await run("pm2 flush mchain-api");
      res.json({ ok: true, message: "PM2 logs cleared" });
      break;
    }
    default:
      res.status(400).json({ error: "Unknown action" });
  }
});

export default router;
