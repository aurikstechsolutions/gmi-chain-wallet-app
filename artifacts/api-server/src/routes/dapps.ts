import { Router, type Request, type Response, type NextFunction } from "express";
import { db, featuredDapps } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) { res.status(503).json({ error: "Admin secret not configured" }); return; }
  const key = req.headers["x-admin-key"];
  if (!key || key !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

const router = Router();

// ── Ensure table exists on startup ────────────────────────────────────────────
export async function ensureDappsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS featured_dapps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'globe-outline',
      color TEXT NOT NULL DEFAULT '#0EA5E9',
      sort_order INTEGER NOT NULL DEFAULT 0,
      coming_soon BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Public endpoint ────────────────────────────────────────────────────────────

router.get("/dapps", async (_req, res) => {
  const rows = await db.select().from(featuredDapps).orderBy(asc(featuredDapps.sortOrder), asc(featuredDapps.createdAt));
  res.json({ dapps: rows });
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────────

router.get("/admin/dapps", adminAuth, async (_req, res) => {
  const rows = await db.select().from(featuredDapps).orderBy(asc(featuredDapps.sortOrder), asc(featuredDapps.createdAt));
  res.json({ dapps: rows });
});

router.post("/admin/dapps", adminAuth, async (req, res) => {
  const { name, description, url, icon, color, sortOrder, comingSoon } = req.body as {
    name: string; description?: string; url: string;
    icon?: string; color?: string; sortOrder?: number; comingSoon?: boolean;
  };
  if (!name || !url) {
    res.status(400).json({ error: "name and url are required" });
    return;
  }
  const [row] = await db.insert(featuredDapps).values({
    name,
    description: description ?? "",
    url,
    icon: icon ?? "globe-outline",
    color: color ?? "#0EA5E9",
    sortOrder: sortOrder ?? 0,
    comingSoon: comingSoon ?? false,
  }).returning();
  res.status(201).json({ dapp: row });
});

router.put("/admin/dapps/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, description, url, icon, color, sortOrder, comingSoon } = req.body as {
    name?: string; description?: string; url?: string;
    icon?: string; color?: string; sortOrder?: number; comingSoon?: boolean;
  };
  const [row] = await db.update(featuredDapps)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(url !== undefined && { url }),
      ...(icon !== undefined && { icon }),
      ...(color !== undefined && { color }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(comingSoon !== undefined && { comingSoon }),
      updatedAt: new Date(),
    })
    .where(eq(featuredDapps.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ dapp: row });
});

router.delete("/admin/dapps/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  await db.delete(featuredDapps).where(eq(featuredDapps.id, id));
  res.json({ ok: true });
});

export default router;
