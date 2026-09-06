import { Router } from "express";
import { z } from "zod";
import {
  calculateBridgeQuote,
  getBridgeCheck,
  getBridgePublicConfig,
  getBridgeRuntimeConfig,
  getBridgeTransferStatus,
  notifyBridgeTransfer,
  recoverBridgeTransfer,
  type BridgeChain,
} from "../lib/bridge";

const router = Router();

const chainSchema = z.enum(["bsc", "gmi"]);
const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash");

function isBridgeChain(value: unknown): value is BridgeChain {
  return value === "bsc" || value === "gmi";
}

function operatorAuthorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env["GMI_BRIDGE_OPERATOR_KEY"];
  if (!expected) return false;
  const supplied = req.headers["x-bridge-operator-key"];
  return typeof supplied === "string" && supplied === expected;
}

router.get("/bridge/config", (_req, res) => {
  res.json(getBridgePublicConfig());
});

router.post("/bridge/quote", (req, res) => {
  const parsed = z.object({
    sourceChain: chainSchema,
    amount: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bridge quote request", details: parsed.error.issues });
    return;
  }

  try {
    const quote = calculateBridgeQuote(
      parsed.data.amount,
      parsed.data.sourceChain,
      getBridgeRuntimeConfig(),
    );
    res.json({
      sourceChain: parsed.data.sourceChain,
      destinationChain: parsed.data.sourceChain === "bsc" ? "gmi" : "bsc",
      ...quote,
      estimatedSeconds: 180,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to calculate quote" });
  }
});

router.post("/bridge/check", async (req, res) => {
  const parsed = z.object({
    sourceChain: chainSchema,
    address: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bridge balance request", details: parsed.error.issues });
    return;
  }

  try {
    res.json(await getBridgeCheck(parsed.data.sourceChain, parsed.data.address));
  } catch (err) {
    req.log.error({ err }, "bridge/check failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to fetch bridge balances" });
  }
});

router.post("/bridge/notify", async (req, res) => {
  const parsed = z.object({
    sourceChain: chainSchema,
    txHash: txHashSchema,
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bridge notification", details: parsed.error.issues });
    return;
  }

  try {
    res.status(202).json(await notifyBridgeTransfer(parsed.data.sourceChain, parsed.data.txHash));
  } catch (err) {
    req.log.error({ err }, "bridge/notify failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to queue bridge transfer" });
  }
});

router.get("/bridge/status/:txHash", async (req, res) => {
  const sourceChain = req.query["sourceChain"];
  if (!isBridgeChain(sourceChain) || !txHashSchema.safeParse(req.params.txHash).success) {
    res.status(400).json({ error: "sourceChain and txHash are required" });
    return;
  }

  try {
    const record = await getBridgeTransferStatus(sourceChain, req.params.txHash);
    if (!record) {
      res.status(404).json({ error: "Bridge transfer not found" });
      return;
    }
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to fetch bridge status" });
  }
});

router.post("/bridge/recover", async (req, res) => {
  if (!operatorAuthorized(req)) {
    res.status(401).json({ error: "Bridge operator authorization required" });
    return;
  }

  const parsed = z.object({
    sourceChain: chainSchema,
    txHash: txHashSchema,
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bridge recovery request", details: parsed.error.issues });
    return;
  }

  try {
    res.json(await recoverBridgeTransfer(parsed.data.sourceChain, parsed.data.txHash));
  } catch (err) {
    req.log.error({ err }, "bridge/recover failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Unable to recover bridge transfer" });
  }
});

export default router;