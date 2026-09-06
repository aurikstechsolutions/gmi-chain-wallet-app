import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { appSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const TERMS_KEY = "legal_terms";
const PRIVACY_KEY = "legal_privacy";

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) { res.status(503).json({ error: "Admin secret not configured" }); return; }
  const key = req.headers["x-admin-key"];
  if (!key || key !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? "";
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

router.get("/legal/content", async (_req, res) => {
  const [terms, privacy] = await Promise.all([getSetting(TERMS_KEY), getSetting(PRIVACY_KEY)]);
  res.json({ terms, privacy });
});

router.post("/legal/content", adminAuth, async (req, res) => {
  const body = req.body as { terms?: string; privacy?: string };
  if (body.terms !== undefined) await setSetting(TERMS_KEY, body.terms);
  if (body.privacy !== undefined) await setSetting(PRIVACY_KEY, body.privacy);
  const [terms, privacy] = await Promise.all([getSetting(TERMS_KEY), getSetting(PRIVACY_KEY)]);
  res.json({ ok: true, terms, privacy });
});

export default router;
